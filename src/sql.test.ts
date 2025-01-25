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
		const stmt = db.sql<{ minAge: number }>`
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

		assert.equal(
			stmt
				.sourceSQL({
					minAge: 18,
				})
				.trim(),
			"SELECT *\nFROM test_table\nWHERE age > $minAge\nORDER BY name ASC\nLIMIT 10"
		)
	})

	test("combines INSERT with VALUES and RETURNING", () => {
		type TestRow = { name: string; age: number; metadata: object }

		const stmt = db.sql<TestRow>`
   INSERT INTO test_table
   ${{
			values: ["$name", "$age", "$metadata->json"],
			// biome-ignore lint/suspicious/noExplicitAny: <explanation>
			returning: ["id", "created_at"] as any,
		}}
 `

		assert.equal(
			stmt
				.sourceSQL({
					name: "test",
					age: 25,
					metadata: {
						tags: ["test"],
					},
				})
				.trim(),
			"INSERT INTO test_table (name, age, metadata)\nVALUES ($name, $age, jsonb($metadata))\nRETURNING id,\n  created_at"
		)
	})

	test("combines UPDATE with SET, WHERE and RETURNING", () => {
		type UpdateRow = { id: number; name: string; metadata: object }

		const stmt = db.sql<UpdateRow>`
   UPDATE test_table
   ${{
			set: ["$name", "$metadata->json"],
			where: "id = $id",
			returning: "*",
		}}
 `

		assert.equal(
			stmt
				.sourceSQL({
					id: 1,
					name: "updated",
					metadata: {
						updated: true,
					},
				})
				.trim(),
			"UPDATE test_table\nSET name = $name,\n  metadata = jsonb($metadata)\nWHERE id = $id\nRETURNING *"
		)
	})

	test("combines complex WHERE conditions with ORDER BY and LIMIT/OFFSET", () => {
		type QueryRow = { minAge: number; pattern: string }

		const stmt = db.sql<QueryRow>`
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

		assert.equal(
			stmt
				.sourceSQL({
					minAge: 18,
					pattern: "test%",
				})
				.trim(),
			"SELECT *\nFROM test_table\nWHERE age > $minAge\n  AND name LIKE $pattern\nORDER BY age DESC,\n  name ASC\nLIMIT 20 OFFSET 40"
		)
	})

	test("combines INSERT with complex JSON values and column constraints", () => {
		type InsertRow = {
			name: string
			metadata: { tags: string[] }
			settings: { theme: string }
		}

		const stmt = db.sql<InsertRow>`
    INSERT INTO test_table
    ${{
			values: ["$name", "$metadata->json", "$settings->json"],
			// biome-ignore lint/suspicious/noExplicitAny: <explanation>
			returning: ["id", "created_at"] as any,
		}}
  `

		assert.equal(
			stmt
				.sourceSQL({
					name: "test",
					metadata: {
						tags: ["a", "b"],
					},
					settings: {
						theme: "dark",
					},
				})
				.trim(),
			"INSERT INTO test_table (name, metadata, settings)\nVALUES ($name, jsonb($metadata), jsonb($settings))\nRETURNING id,\n  created_at"
		)
	})
})

describe("Statement Iterator", () => {
	beforeEach(() => {
		// Insert test data
		db.exec(`
     INSERT INTO test_table (name, age, email, metadata, settings) VALUES
       ('Alice', 25, 'alice@test.com', '{"tags":["a","b"]}', '{"theme":"dark"}'),
       ('Bob', 30, 'bob@test.com', '{"tags":["c"]}', '{"theme":"light"}'),
       ('Carol', 35, 'carol@test.com', '{"tags":["d","e","f"]}', '{"theme":"dark"}')
   `)
	})

	test("iterates over basic query results", () => {
		const query = db.sql`SELECT name, age FROM test_table ORDER BY age`
		const iterator = query.iter<{ name: string; age: number }>()

		let result = iterator.next()
		const expected1 = Object.create(null)
		expected1.name = "Alice"
		expected1.age = 25
		assert.deepEqual(result.value, expected1)
		assert.equal(result.done, false)

		result = iterator.next()
		const expected2 = Object.create(null)
		expected2.name = "Bob"
		expected2.age = 30
		assert.deepEqual(result.value, expected2)
		assert.equal(result.done, false)

		result = iterator.next()
		const expected3 = Object.create(null)
		expected3.name = "Carol"
		expected3.age = 35
		assert.deepEqual(result.value, expected3)
		assert.equal(result.done, false)

		result = iterator.next()
		assert.equal(result.done, true)
		assert.equal(result.value, undefined)
	})

	test("handles JSON column deserialization", () => {
		const query = db.sql`SELECT name, json_extract(metadata, '$') as meta FROM test_table WHERE name = 'Alice'`
		const iterator = query.iter<{ name: string; meta: { tags: string[] } }>()

		const row = iterator.next().value
		assert.deepEqual(row.meta.tags, ["a", "b"])
	})

	test("returns empty iterator for no results", () => {
		const query = db.sql`SELECT * FROM test_table WHERE age > 100`
		const iterator = query.iter()
		assert.deepEqual(iterator.next(), { done: true, value: undefined })
	})

	test("iterates with parameterized query", () => {
		const query = db.sql<{ minAge: number }>`
    SELECT name, age FROM test_table
    WHERE age > ${"$minAge"}
    ORDER BY age
  `
		const iterator = query.iter<{ name: string; age: number }>({
			minAge: 27,
		})

		let result = iterator.next()
		const expected1 = Object.create(null)
		expected1.name = "Bob"
		expected1.age = 30
		assert.deepEqual(result.value, expected1)
		assert.equal(result.done, false)

		result = iterator.next()
		const expected2 = Object.create(null)
		expected2.name = "Carol"
		expected2.age = 35
		assert.deepEqual(result.value, expected2)
		assert.equal(result.done, false)

		result = iterator.next()
		assert.equal(result.done, true)
		assert.equal(result.value, undefined)
	})

	test("handles multiple JSON columns per row", () => {
		const query = db.sql`
     SELECT name,
            json_extract(metadata, '$') as meta,
            json_extract(settings, '$') as config
     FROM test_table
     WHERE name = 'Alice'
   `
		const iterator = query.iter<{
			name: string
			meta: { tags: string[] }
			config: { theme: string }
		}>()

		const row = iterator.next().value
		assert.deepEqual(row, {
			name: "Alice",
			meta: { tags: ["a", "b"] },
			config: { theme: "dark" },
		})
	})

	test("supports for...of iteration over basic results", () => {
		const query = db.sql`SELECT name, age FROM test_table ORDER BY age`
		const iterator = query.iter<{ name: string; age: number }>()

		const expected = [
			{ name: "Alice", age: 25 },
			{ name: "Bob", age: 30 },
			{ name: "Carol", age: 35 },
		].map(obj => Object.assign(Object.create(null), obj))

		let i = 0
		for (const row of iterator) {
			assert.deepEqual(row, expected[i])
			i++
		}
		assert.equal(i, 3)
	})

	test("supports for...of with parameterized query", () => {
		const query = db.sql<{ minAge: number }>`
   SELECT name, age FROM test_table
   WHERE age > ${"$minAge"}
   ORDER BY age
 `
		const iterator = query.iter<{ name: string; age: number }>({
			minAge: 27,
		})

		const expected = [
			{ name: "Bob", age: 30 },
			{ name: "Carol", age: 35 },
		].map(obj => Object.assign(Object.create(null), obj))

		let i = 0
		for (const row of iterator) {
			assert.deepEqual(row, expected[i])
			i++
		}
		assert.equal(i, 2)
	})

	test("supports for...of with JSON columns", () => {
		const query = db.sql`
    SELECT name,
           json_extract(metadata, '$') as meta,
           json_extract(settings, '$') as config
    FROM test_table WHERE name = 'Alice'
  `

		let count = 0
		// biome-ignore lint/suspicious/noExplicitAny: <explanation>
		for (const row of query.iter<any>()) {
			assert.equal(row.name, "Alice")
			assert.deepEqual(row.meta.tags, ["a", "b"])
			assert.equal(row.config.theme, "dark")
			count++
		}
		assert.equal(count, 1)
	})

	test("supports for...of with empty results", () => {
		const query = db.sql`SELECT * FROM test_table WHERE age > 100`
		let count = 0
		for (const _ of query.iter()) {
			count++
		}
		assert.equal(count, 0)
	})

	test("supports for...of with spread operator", () => {
		const query = db.sql`SELECT name FROM test_table ORDER BY name`
		const names = [...query.iter<{ name: string }>()].map(row => row.name)
		assert.deepEqual(names, ["Alice", "Bob", "Carol"])
	})
})
