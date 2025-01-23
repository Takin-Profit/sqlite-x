// Copyright 2025 Takin Profit. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

import { test, describe } from "node:test"
import assert from "node:assert/strict"
import { validateWhereClause, type WhereClause } from "./where"

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
