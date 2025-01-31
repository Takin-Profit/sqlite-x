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
			set: {
				name: "$name",
				metadata: "$metadata->json",
			},
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

test("generates rows from query", () => {
	db.exec(`
    CREATE TABLE test_generator (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      data JSON
    )
  `)

	const insertData = db.sql<{ name: string; data: Record<string, unknown> }>`
    INSERT INTO test_generator (name, data)
    VALUES (${"$name"}, ${"$data->json"})
  `

	const testData = [
		{ name: "item1", data: { value: 1, active: true } },
		{ name: "item2", data: { value: 2, active: false } },
		{ name: "item3", data: { value: 3, active: true } },
	]

	for (const item of testData) {
		insertData.run(item)
	}

	const query = db.sql<Record<string, never>>`
    SELECT name, json_extract(data, '$') as data
    FROM test_generator
    ORDER BY id
  `

	const generator = query.rows<{
		name: string
		data: Record<string, unknown>
	}>()

	let index = 0
	for (const row of generator) {
		assert.equal(row.name, testData[index].name)
		assert.deepEqual(row.data, testData[index].data)
		index++
	}

	assert.equal(index, testData.length)
})

test("generator handles empty results", () => {
	db.exec("CREATE TABLE empty_table (id INTEGER PRIMARY KEY)")

	const query = db.sql<Record<string, never>>`SELECT * FROM empty_table`
	const generator = query.rows()

	let count = 0
	for (const _ of generator) {
		count++
	}

	assert.equal(count, 0)
})

test("generator supports early termination", () => {
	db.exec(`
    CREATE TABLE sequence (
      id INTEGER PRIMARY KEY,
      value INTEGER
    )
  `)

	// Insert test data
	for (let i = 0; i < 100; i++) {
		db.exec(`INSERT INTO sequence (value) VALUES (${i})`)
	}

	const query = db.sql<Record<string, never>>`
    SELECT * FROM sequence ORDER BY value
  `

	const generator = query.rows<{ id: number; value: number }>({})
	let count = 0

	// Only consume first 50 items
	for (const row of generator) {
		assert.equal(row.value, count)
		count++
		if (count === 50) {
			break
		}
	}

	assert.equal(count, 50)
})

test("generator handles complex joins with JSON data", () => {
	// Setup tables
	db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      name TEXT,
      settings JSON
    );

    CREATE TABLE posts (
      id INTEGER PRIMARY KEY,
      user_id INTEGER,
      content TEXT,
      metadata JSON,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );
  `)

	// Insert test data
	const insertUser = db.sql<{
		name: string
		settings: Record<string, unknown>
	}>`
    INSERT INTO users (name, settings)
    VALUES (${"$name"}, ${"$settings->json"})
  `

	const insertPost = db.sql<{
		userId: number
		content: string
		metadata: Record<string, unknown>
	}>`
    INSERT INTO posts (user_id, content, metadata)
    VALUES (${"$userId"}, ${"$content"}, ${"$metadata->json"})
  `

	const users = [
		{ name: "Alice", settings: { theme: "dark", notifications: true } },
		{ name: "Bob", settings: { theme: "light", notifications: false } },
	]

	for (const user of users) {
		insertUser.run(user)
	}

	const posts = [
		{ userId: 1, content: "Post 1", metadata: { tags: ["a", "b"], views: 10 } },
		{ userId: 1, content: "Post 2", metadata: { tags: ["b", "c"], views: 20 } },
		{ userId: 2, content: "Post 3", metadata: { tags: ["a", "c"], views: 30 } },
	]

	for (const post of posts) {
		insertPost.run(post)
	}

	const query = db.sql<Record<string, never>>`
    SELECT
      u.name,
      json_extract(u.settings, '$') as user_settings,
      p.content,
      json_extract(p.metadata, '$') as post_metadata
    FROM users u
    JOIN posts p ON u.id = p.user_id
    ORDER BY p.id
  `

	const generator = query.rows<{
		name: string
		user_settings: Record<string, unknown>
		content: string
		post_metadata: Record<string, unknown>
	}>({})

	let count = 0
	for (const row of generator) {
		if (count < 2) {
			assert.equal(row.name, "Alice")
			assert.deepEqual(row.user_settings, users[0].settings)
		} else {
			assert.equal(row.name, "Bob")
			assert.deepEqual(row.user_settings, users[1].settings)
		}
		assert.equal(row.content, posts[count].content)
		assert.deepEqual(row.post_metadata, posts[count].metadata)
		count++
	}

	assert.equal(count, 3)
})

test("generator handles dynamic query composition", () => {
	db.exec(`
    CREATE TABLE products (
      id INTEGER PRIMARY KEY,
      name TEXT,
      price REAL,
      category TEXT,
      details JSON
    )
  `)

	const insert = db.sql<{
		name: string
		price: number
		category: string
		details: Record<string, unknown>
	}>`
    INSERT INTO products (name, price, category, details)
    VALUES (${"$name"}, ${"$price"}, ${"$category"}, ${"$details->json"})
  `

	const products = [
		{
			name: "A",
			price: 10.99,
			category: "electronics",
			details: { stock: 5, rating: 4.5 },
		},
		{
			name: "B",
			price: 20.99,
			category: "books",
			details: { stock: 10, rating: 4.0 },
		},
		{
			name: "C",
			price: 15.99,
			category: "electronics",
			details: { stock: 0, rating: 4.2 },
		},
	]
	for (const p of products) {
		insert.run(p)
	}

	let baseQuery = db.sql<Record<string, never>>`
    SELECT *, json_extract(details, '$') as details
    FROM products
  `

	// Compose with WHERE
	baseQuery = baseQuery.sql`WHERE category = 'electronics'`

	// Compose with ORDER BY
	baseQuery = baseQuery.sql`ORDER BY price DESC`

	const generator = baseQuery.rows<{
		id: number
		name: string
		price: number
		category: string
		details: Record<string, unknown>
	}>({})

	let count = 0
	let lastPrice = Number.POSITIVE_INFINITY

	for (const row of generator) {
		assert.equal(row.category, "electronics")
		assert.ok(row.price <= lastPrice) // Check ordering
		lastPrice = row.price
		count++
	}

	assert.equal(count, 2)
})

test("generator handles error recovery and cleanup", () => {
	db.exec(`
    CREATE TABLE error_test (
      id INTEGER PRIMARY KEY,
      value INTEGER
    )
  `)

	for (let i = 0; i < 5; i++) {
		db.exec(`INSERT INTO error_test (value) VALUES (${i})`)
	}

	const query = db.sql<Record<string, never>>`
    SELECT * FROM error_test ORDER BY id
  `

	const generator = query.rows<{ id: number; value: number }>({})

	let count = 0
	try {
		for (const row of generator) {
			assert.equal(row.value, count)
			count++
			if (count === 3) {
				throw new Error("Simulated error")
			}
		}
	} catch (error) {
		assert.equal((error as Error).message, "Simulated error")
	}

	// Start a new query
	const newGenerator = query.rows<{ id: number; value: number }>({})
	count = 0
	for (const row of newGenerator) {
		assert.equal(row.value, count)
		count++
	}
	assert.equal(count, 5)
})

test("handles JSON columns in RETURNING clause", () => {
	type TestData = {
		id?: number
		name: string
		metadata: { tags: string[] }
		settings: { theme: string }
	}

	const stmt = db.sql<TestData>`
    INSERT INTO test_table ${{
			values: ["$name", "$metadata->json", "$settings->json"],
			returning: ["*", { jsonColumns: ["metadata", "settings"] }],
		}}
  `

	assert.equal(
		stmt
			.sourceSQL({
				name: "test",
				metadata: { tags: ["a", "b"] },
				settings: { theme: "dark" },
			})
			.trim(),
		`INSERT INTO test_table (name, metadata, settings)\nVALUES ($name, jsonb($metadata), jsonb($settings))\nRETURNING name,\n  json_extract(metadata, '$') AS metadata,\n  json_extract(settings, '$') AS settings`
	)
})

test("handles mixed standard and JSON columns in RETURNING clause", () => {
	type TestData = {
		id: number
		name: string
		metadata: { tags: string[] }
	}

	const stmt = db.sql<TestData>`
    UPDATE test_table ${{
			set: {
				name: "$name",
				metadata: "$metadata->json",
			},
			where: "id = $id",
			returning: ["*", { jsonColumns: ["metadata"] }],
		}}
  `

	assert.equal(
		stmt
			.sourceSQL({
				id: 1,
				name: "test",
				metadata: { tags: ["a", "b"] },
			})
			.trim(),
		"UPDATE test_table\nSET name = $name,\n  metadata = jsonb($metadata)\nWHERE id = $id\nRETURNING id,\n  name,\n  json_extract(metadata, '$') AS metadata"
	)
})

test("validates JSON columns configuration", () => {
	type TestData = {
		id: number
		metadata: { tags: string[] }
	}

	// Invalid jsonColumns type
	assert.throws(
		() => {
			db.sql<TestData>`
        INSERT INTO test_table ${{
					values: ["$metadata->json"],
					// biome-ignore lint/suspicious/noExplicitAny: <explanation>
					returning: ["*", { jsonColumns: "not-an-array" }] as any,
				}}
      `.get({ id: 0, metadata: { tags: [] } })
		},
		{ name: "NodeSqliteError" }
	)

	// Invalid column names
	assert.throws(
		() => {
			db.sql<TestData>`
        INSERT INTO test_table ${{
					values: ["$metadata->json"],
					// biome-ignore lint/suspicious/noExplicitAny: <explanation>
					returning: ["*", { jsonColumns: [42] }] as any,
				}}
      `.get({ id: 0, metadata: { tags: [] } })
		},
		{ name: "NodeSqliteError" }
	)
})
