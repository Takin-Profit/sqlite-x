// Copyright 2025 Takin Profit. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

import { test, describe, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { DB } from "#database"

let db: DB

beforeEach(() => {
	db = new DB({ location: ":memory:" })

	db.exec(`
    CREATE TABLE test_table (
      id INTEGER PRIMARY KEY,
      name TEXT,
      age INTEGER,
      email TEXT UNIQUE,
      metadata TEXT,
      settings TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `)
})

afterEach(() => {
	db.close()
})

describe("SQL Context Generation", () => {
	test("combines SELECT with WHERE, ORDER BY, and LIMIT", () => {
		const stmt = db.prepare<{ minAge: number }>(
			(ctx) => ctx.sql`
   SELECT * FROM test_table
   ${
			{
				where: "age > $minAge",
				orderBy: { name: "ASC" },
				limit: 10,
				// biome-ignore lint/suspicious/noExplicitAny: <explanation>
			} as any
		}
 `
		)

		assert.equal(
			stmt.sourceSQL({ minAge: 18 }).trim(),
			"SELECT * FROM test_table\n   WHERE age > $minAge\nORDER BY name ASC\nLIMIT 10"
		)
	})

	test("combines INSERT with VALUES and RETURNING", () => {
		type TestRow = { name: string; age: number; metadata: object }

		const stmt = db.prepare<TestRow>(
			(ctx) => ctx.sql`
   INSERT INTO test_table
   ${{
			values: ["$name", "$age", "$metadata->json"],
			// biome-ignore lint/suspicious/noExplicitAny: <explanation>
			returning: ["id", "created_at"] as any,
		}}
 `
		)

		assert.equal(
			stmt
				.sourceSQL({
					name: "test",
					age: 25,
					metadata: { tags: ["test"] },
				})
				.trim(),
			"INSERT INTO test_table\n   (name, age, metadata)\nVALUES ($name, $age, jsonb($metadata))\nRETURNING id, created_at"
		)
	})

	test("combines UPDATE with SET, WHERE and RETURNING", () => {
		type UpdateRow = { id: number; name: string; metadata: object }

		const stmt = db.prepare<UpdateRow>(
			(ctx) => ctx.sql`
   UPDATE test_table
   ${{
			set: ["$name", "$metadata->json"],
			where: "id = $id",
			returning: "*",
		}}
 `
		)

		assert.equal(
			stmt
				.sourceSQL({
					id: 1,
					name: "updated",
					metadata: { updated: true },
				})
				.trim(),
			"UPDATE test_table\n   SET name = $name,\n  metadata = jsonb($metadata)\nWHERE id = $id\nRETURNING *"
		)
	})

	test("combines complex WHERE conditions with ORDER BY and LIMIT/OFFSET", () => {
		type QueryRow = { minAge: number; pattern: string }

		const stmt = db.prepare<QueryRow>(
			(ctx) => ctx.sql`
   SELECT * FROM test_table
   ${{
			// biome-ignore lint/suspicious/noExplicitAny: <explanation>
			where: ["age > $minAge", "AND", "name LIKE $pattern"] as any,
			// biome-ignore lint/suspicious/noExplicitAny: <explanation>
			orderBy: { age: "DESC", name: "ASC" } as any,
			limit: 20,
			offset: 40,
		}}
 `
		)

		assert.equal(
			stmt.sourceSQL({ minAge: 18, pattern: "test%" }).trim(),
			"SELECT * FROM test_table\n   WHERE age > $minAge AND name LIKE $pattern\nORDER BY age DESC, name ASC\nLIMIT 20\nOFFSET 40"
		)
	})

	test("combines INSERT with complex JSON values and column constraints", () => {
		type InsertRow = {
			name: string
			metadata: { tags: string[] }
			settings: { theme: string }
		}

		const stmt = db.prepare<InsertRow>(
			(ctx) => ctx.sql`
    INSERT INTO test_table
    ${{
			values: ["$name", "$metadata->json", "$settings->json"],
			// biome-ignore lint/suspicious/noExplicitAny: <explanation>
			returning: ["id", "created_at"] as any,
		}}
  `
		)

		assert.equal(
			stmt
				.sourceSQL({
					name: "test",
					metadata: { tags: ["a", "b"] },
					settings: { theme: "dark" },
				})
				.trim(),
			"INSERT INTO test_table\n    (name, metadata, settings)\nVALUES ($name, jsonb($metadata), jsonb($settings))\nRETURNING id, created_at"
		)
	})
})
