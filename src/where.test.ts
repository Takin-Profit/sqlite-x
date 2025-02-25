// Copyright 2025 Takin Profit. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

import { test, describe, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { buildWhereStatement, validateWhereClause } from "#where"
import { DB } from "#database"
import { raw } from "#sql.js"
import type { WhereClause } from "#types.js"

interface TestUser {
	id: number
	name: string
	active: boolean
	metadata: object
}

describe("validateWhereClause", () => {
	test("validates single conditions", () => {
		const validCases: WhereClause<TestUser>[] = [
			"id = $id",
			"name LIKE $name",
			"active != $active",
			"metadata IS NULL",
			"metadata IS NOT NULL",
		]

		for (const condition of validCases) {
			const errors = validateWhereClause(condition)
			assert.equal(errors.length, 0, `Expected no errors for: ${condition}`)
		}
	})

	test("validates compound conditions", () => {
		const validCases: WhereClause<TestUser>[] = [
			["id > $id", "AND", "active = $active"],
			["name LIKE $name", "OR", "metadata IS NULL", "AND", "active != $active"],
			[
				"id < $id",
				"AND",
				"name = $name",
				"OR",
				"active = $active",
				"AND",
				"metadata IS NOT NULL",
			],
		]

		for (const condition of validCases) {
			const errors = validateWhereClause(condition)
			assert.equal(
				errors.length,
				0,
				`Expected no errors for: ${JSON.stringify(condition)}`
			)
		}
	})

	test("rejects invalid single conditions", () => {
		// biome-ignore lint/suspicious/noExplicitAny: <explanation>
		const invalidCases: any = [
			"id ==== $id", // Invalid operator
			"name LIKES $name", // Invalid operator
			"active <> $active", // Invalid operator
			"id = id", // Missing $ prefix
			"metadata >> $id", // Invalid operator
		]

		for (const condition of invalidCases) {
			const errors = validateWhereClause(condition)
			assert.ok(errors.length > 0, `Expected errors for: ${condition}`)
		}
	})

	test("rejects invalid compound conditions", () => {
		// biome-ignore lint/suspicious/noExplicitAny: <explanation>
		const invalidCases: any = [
			[],
			["single_condition"],
			["id = $id", "INVALID_OP", "name = $name"],
			["id = $id", "AND", "name = $name", "OR"], // Missing final condition
			["AND", "id = $id", "OR", "name = $name"], // Starts with operator
			["id = $id", "AND", "invalid condition", "OR", "name = $name"],
		]

		for (const condition of invalidCases) {
			const errors = validateWhereClause(condition)
			assert.ok(
				errors.length > 0,
				`Expected errors for: ${JSON.stringify(condition)}`
			)
		}
	})

	test("validates operator alternation", () => {
		const errors = validateWhereClause([
			"id = $id",
			"AND",
			"name = $name",
			"AND",
			"name = $name",
			"OR",
			"active = $active",
			"AND",
			"metadata IS NULL",
		])
		assert.equal(errors.length, 0)

		const invalidErrors = validateWhereClause([
			"id = $id",
			"AND",
			"OR", // Two operators in sequence
			"name = $name",
			// biome-ignore lint/suspicious/noExplicitAny: <explanation>
		] as any)
		assert.ok(invalidErrors.length > 0)
	})

	test("validates length constraints", () => {
		// Test minimum length
		// biome-ignore lint/suspicious/noExplicitAny: <explanation>
		const tooShort = validateWhereClause(["id = $id"] as any)
		assert.ok(tooShort.length > 0)

		// Test even length rejection
		const evenLength = validateWhereClause([
			"id = $id",
			"AND",
			"name = $name",
			"AND",
			// biome-ignore lint/suspicious/noExplicitAny: <explanation>
		] as any)
		assert.ok(evenLength.length > 0)
	})
})

describe("buildWhereStatement", () => {
	test("builds single condition with each comparison operator", () => {
		// biome-ignore lint/suspicious/noExplicitAny: <explanation>
		const conditions: any = [
			"id = $id",
			"name != $name",
			"age > $min_age",
			"age < $max_age",
			"age >= $min_age",
			"age <= $max_age",
			"name LIKE $pattern",
			"email NOT LIKE $pattern",
			"id IN $ids",
			"id NOT IN $ids",
			"metadata IS NULL",
			"metadata IS NOT NULL",
		]

		for (const condition of conditions) {
			const result = buildWhereStatement(condition)
			assert.equal(result.sql, `WHERE ${condition}`)
		}
	})

	test("builds compound conditions with AND", () => {
		const result = buildWhereStatement([
			"id > $min_id",
			"AND",
			"id < $max_id",
			"AND",
			"active = $active",
		])
		assert.equal(
			result.sql,
			"WHERE id > $min_id AND id < $max_id AND active = $active"
		)
	})

	test("builds compound conditions with OR", () => {
		const result = buildWhereStatement([
			"name LIKE $pattern1",
			"OR",
			"name LIKE $pattern2",
			"OR",
			"email LIKE $pattern3",
		])
		assert.equal(
			result.sql,
			"WHERE name LIKE $pattern1 OR name LIKE $pattern2 OR email LIKE $pattern3"
		)
	})

	test("builds mixed AND/OR conditions", () => {
		const result = buildWhereStatement([
			"active = $active",
			"AND",
			"age > $min_age",
			"OR",
			"name LIKE $pattern",
		])
		assert.equal(
			result.sql,
			"WHERE active = $active AND age > $min_age OR name LIKE $pattern"
		)
	})

	test("builds complex nested conditions", () => {
		const result = buildWhereStatement([
			"id > $min_id",
			"AND",
			"id < $max_id",
			"AND",
			"active = $active",
			"OR",
			"metadata IS NULL",
			"AND",
			"created_at < $date",
		])
		assert.equal(
			result.sql,
			"WHERE id > $min_id AND id < $max_id AND active = $active OR metadata IS NULL AND created_at < $date"
		)
	})

	test("handles null checks with other conditions", () => {
		const result = buildWhereStatement([
			"metadata IS NULL",
			"OR",
			"metadata IS NOT NULL",
			"AND",
			"active = $active",
		])
		assert.equal(
			result.sql,
			"WHERE metadata IS NULL OR metadata IS NOT NULL AND active = $active"
		)
	})

	test("handles multiple IN conditions", () => {
		const result = buildWhereStatement([
			"id IN $ids",
			"AND",
			"age IN $ages",
			"OR",
			"name NOT IN $names",
		])
		assert.equal(
			result.sql,
			"WHERE id IN $ids AND age IN $ages OR name NOT IN $names"
		)
	})

	test("handles LIKE conditions with mixed operators", () => {
		const result = buildWhereStatement([
			"name LIKE $pattern",
			"AND",
			"email NOT LIKE $pattern",
			"OR",
			"age > $min_age",
			"AND",
			"active = $active",
		])
		assert.equal(
			result.sql,
			"WHERE name LIKE $pattern AND email NOT LIKE $pattern OR age > $min_age AND active = $active"
		)
	})

	test("handles maximum supported condition length", () => {
		const result = buildWhereStatement([
			"id = $id1",
			"AND",
			"id = $id2",
			"AND",
			"id = $id3",
			"AND",
			"id = $id4",
			"AND",
			"id = $id5",
			"AND",
			"id = $id6",
			"AND",
			"id = $id7",
			"AND",
			"id = $id8",
			"AND",
			"id = $id9",
			"AND",
			"id = $id10",
		])
		assert.equal(
			result.sql,
			"WHERE id = $id1 AND id = $id2 AND id = $id3 AND id = $id4 AND id = $id5 AND id = $id6 AND id = $id7 AND id = $id8 AND id = $id9 AND id = $id10"
		)
	})
})

describe("Where Context SQL Generation", () => {
	let db: DB

	beforeEach(() => {
		db = new DB({
			location: ":memory:",
			environment: "testing",
		})
		db.exec(`
     CREATE TABLE test_data (
       id INTEGER PRIMARY KEY,
       name TEXT,
       age INTEGER,
       active BOOLEAN,
       metadata TEXT,
       created_at TEXT,
       email TEXT,
       settings TEXT
     );
   `)
	})

	afterEach(() => {
		db.close()
	})

	test("generates basic where condition", () => {
		const stmt = db.sql<{
			id: number
		}>`SELECT * FROM test_data ${{ where: "id = $id" }}`

		assert.equal(
			stmt
				.sourceSQL({
					id: 1,
				})
				.trim(),
			"SELECT *\nFROM test_data\nWHERE id = $id"
		)
	})

	test("generates where with AND conditions", () => {
		type QueryParams = { min_age: number; active: boolean }
		const stmt = db.sql<QueryParams>`SELECT * FROM test_data ${{
			// biome-ignore lint/suspicious/noExplicitAny: <explanation>
			where: ["age > $min_age", "AND", "active = $active"] as any,
		}}`

		assert.equal(
			stmt
				.sourceSQL({
					min_age: 18,
					active: true,
				})
				.trim(),
			"SELECT *\nFROM test_data\nWHERE age > $min_age\n  AND active = $active"
		)
	})

	test("generates where with complex conditions", () => {
		type QueryParams = {
			min_age: number
			pattern: string
			active: boolean
		}
		const stmt = db.sql<QueryParams>`SELECT * FROM test_data ${{
			where: [
				"age > $min_age",
				"AND",
				"name LIKE $pattern",
				"OR",
				"active = $active",
				// biome-ignore lint/suspicious/noExplicitAny: <explanation>
			] as any,
		}}`

		assert.equal(
			stmt
				.sourceSQL({
					min_age: 18,
					pattern: "test%",
					active: true,
				})
				.trim(),
			"SELECT *\nFROM test_data\nWHERE age > $min_age\n  AND name LIKE $pattern\n  OR active = $active"
		)
	})

	test("generates where with IS NULL", () => {
		const stmt = db.sql<
			Record<string, never>
		>`SELECT * FROM test_data ${{ where: "metadata IS NULL" }}`

		assert.equal(
			stmt.sourceSQL().trim(),
			"SELECT *\nFROM test_data\nWHERE metadata IS NULL"
		)
	})

	test("generates where with complex JSON conditions", () => {
		type QueryParams = {
			min_age: number
			settings: { theme: string }
		}
		const stmt = db.sql<QueryParams>`SELECT * FROM test_data ${{
			// biome-ignore lint/suspicious/noExplicitAny: <explanation>
			where: ["age > $min_age", "AND", "settings = $settings->json"] as any,
		}}`

		assert.equal(
			stmt
				.sourceSQL({
					min_age: 18,
					settings: {
						theme: "dark",
					},
				})
				.trim(),
			"SELECT *\nFROM test_data\nWHERE age > $min_age\n  AND settings = jsonb($settings)"
		)
	})

	test("validates raw value conditions", () => {
		const validCases: WhereClause<TestUser>[] = [
			["id", "=", raw`(SELECT max_id FROM config)`],
			// biome-ignore lint/suspicious/noExplicitAny: <explanation>
			["created_at", ">", raw`CURRENT_TIMESTAMP`] as any,
			["updated_at", "<", raw`datetime('now', '-7 days')`],
		]

		for (const condition of validCases) {
			const errors = validateWhereClause(condition)
			assert.equal(
				errors.length,
				0,
				`Expected no errors for: ${JSON.stringify(condition)}`
			)
		}
	})

	test("validates raw values in compound conditions", () => {
		const validCases: WhereClause<TestUser>[] = [
			[
				["id", ">", raw`(SELECT min_id FROM ranges)`],
				"AND",
				"active = $active",
			],
			["name LIKE $pattern", "OR", ["created_at", ">", raw`CURRENT_TIMESTAMP`]],
			[
				["id", "=", raw`(SELECT ref_id FROM related)`],
				"AND",
				"metadata IS NOT NULL",
				"OR",
				["updated_at", "<", raw`datetime('now', '-1 hour')`],
			],
			// biome-ignore lint/suspicious/noExplicitAny: <explanation>
		] as any

		for (const condition of validCases) {
			const errors = validateWhereClause(condition)
			assert.equal(
				errors.length,
				0,
				`Expected no errors for: ${JSON.stringify(condition)}`
			)
		}
	})

	test("rejects invalid raw value conditions", () => {
		const invalidCases = [
			["id", "INVALID", raw`something`], // Invalid operator
			["id", "=", "not a raw value"], // Missing raw value
			["id", "="], // Missing raw value
			[123, "=", raw`value`], // Invalid column name
		]

		for (const condition of invalidCases) {
			const errors = validateWhereClause(condition as WhereClause<TestUser>)
			assert.ok(
				errors.length > 0,
				`Expected errors for: ${JSON.stringify(condition)}`
			)
		}
	})

	// Add these tests inside the "buildWhereStatement" describe block:

	test("builds single condition with raw value", () => {
		const result = buildWhereStatement([
			"id",
			">",
			raw`(SELECT max_id FROM ranges)`,
		])
		assert.equal(result.sql, "WHERE id > (SELECT max_id FROM ranges)")
		assert.deepEqual(result.parameterOperators, [])
	})

	test("builds conditions mixing raw values and parameters", () => {
		const result = buildWhereStatement([
			["created_at", ">", raw`CURRENT_TIMESTAMP`],
			"AND",
			"name LIKE $pattern",
			"OR",
			["updated_at", "<", raw`datetime('now', '-1 day')`],
		])
		assert.equal(
			result.sql,
			"WHERE created_at > CURRENT_TIMESTAMP AND name LIKE $pattern OR updated_at < datetime('now', '-1 day')"
		)
		assert.deepEqual(result.parameterOperators, ["$pattern"])
	})

	// Add this test inside the "Where Context SQL Generation" describe block:

	test("generates where with raw value conditions", () => {
		type QueryParams = {
			pattern: string
		}
		const stmt = db.sql<QueryParams>`SELECT * FROM test_data ${{
			where: [
				["created_at", ">", raw`datetime('now', '-7 days')`],
				"AND",
				"name LIKE $pattern",
				// biome-ignore lint/suspicious/noExplicitAny: <explanation>
			] as any,
		}}`

		assert.equal(
			stmt
				.sourceSQL({
					pattern: "test%",
				})
				.trim(),
			"SELECT *\nFROM test_data\nWHERE created_at > datetime('now', '-7 days')\n  AND name LIKE $pattern"
		)
	})
})
