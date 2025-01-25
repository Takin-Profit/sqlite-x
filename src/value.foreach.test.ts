// Copyright 2025 Takin Profit. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

import { test, describe, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { DB } from "#database"

describe("forEach with Values Context", () => {
	let db: DB

	beforeEach(() => {
		db = new DB({ location: ":memory:" })
	})

	afterEach(() => {
		db.close()
	})

	test("inserts multiple rows with basic columns", () => {
		db.exec(`
      CREATE TABLE test_table (
        id INTEGER PRIMARY KEY,
        name TEXT,
        age INTEGER
      )
    `)

		const stmt = db.sql<{ id: number; name: string; age: number }>`
      INSERT INTO test_table
      ${["*", { jsonColumns: [], forEach: true }]}
    `

		const params = [
			{ id: 1, name: "Alice", age: 25 },
			{ id: 2, name: "Bob", age: 30 },
			{ id: 3, name: "Carol", age: 35 },
		]

		stmt.run(params)

		const result = db.sql<Record<string, never>>`
      SELECT * FROM test_table ORDER BY id
    `.all()

		assert.equal(result.length, 3)
		assert.deepEqual(result, params)
	})

	test("inserts multiple rows with JSON columns", () => {
		db.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        name TEXT,
        metadata JSON
      )
    `)

		const stmt = db.sql<{
			id: number
			name: string
			metadata: Record<string, unknown>
		}>`
      INSERT INTO users
      ${["*", { jsonColumns: ["metadata"], forEach: true }]}
    `

		const params = [
			{ id: 1, name: "Alice", metadata: { role: "admin", active: true } },
			{ id: 2, name: "Bob", metadata: { role: "user", active: false } },
		]

		stmt.run(params)

		const result = db.sql<Record<string, never>>`
      SELECT id, name, json_extract(metadata, '$') as metadata FROM users ORDER BY id
    `.all()

		assert.deepEqual(result, params)
	})

	test("handles empty array for forEach", () => {
		db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)")

		const stmt = db.sql<{ id: number; name: string }>`
      INSERT INTO test
      ${["*", { jsonColumns: [], forEach: true }]}
    `

		assert.throws(() => stmt.run([]), /Values array cannot be empty/)
	})

	test("validates forEach parameter type", () => {
		db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)")

		const stmt = db.sql<{ id: number; name: string }>`
      INSERT INTO test
      ${["*", { jsonColumns: [], forEach: true }]}
    `

		assert.throws(
			() => stmt.run({ id: 1, name: "test" } as any),
			/Expected array of parameters/
		)
	})

	test("handles multiple JSON columns", () => {
		db.exec(`
      CREATE TABLE complex_data (
        id INTEGER PRIMARY KEY,
        settings JSON,
        metadata JSON,
        config JSON
      )
    `)

		const stmt = db.sql<{
			id: number
			settings: Record<string, unknown>
			metadata: Record<string, unknown>
			config: Record<string, unknown>
		}>`
      INSERT INTO complex_data
      ${["*", { jsonColumns: ["settings", "metadata", "config"], forEach: true }]}
    `

		const params = [
			{
				id: 1,
				settings: { theme: "dark" },
				metadata: { created: "2025-01-01" },
				config: { enabled: true },
			},
			{
				id: 2,
				settings: { theme: "light" },
				metadata: { created: "2025-01-02" },
				config: { enabled: false },
			},
		]

		stmt.run(params)

		const result = db.sql<Record<string, never>>`
      SELECT
        id,
        json_extract(settings, '$') as settings,
        json_extract(metadata, '$') as metadata,
        json_extract(config, '$') as config
      FROM complex_data
      ORDER BY id
    `.all()

		assert.deepEqual(result, params)
	})

	test("handles large number of rows", () => {
		db.exec("CREATE TABLE large_test (id INTEGER PRIMARY KEY, value TEXT)")

		const stmt = db.sql<{ id: number; value: string }>`
      INSERT INTO large_test
      ${["*", { jsonColumns: [], forEach: true }]}
    `

		const params = Array.from({ length: 1000 }, (_, i) => ({
			id: i + 1,
			value: `value-${i + 1}`,
		}))

		stmt.run(params)

		const count = db.sql<Record<string, never>>`
      SELECT COUNT(*) as count FROM large_test
    `.get() as { count: number }

		assert.equal(count.count, 1000)
	})
})

describe("forEach with Set Context", () => {
	let db: DB

	beforeEach(() => {
		db = new DB({ location: ":memory:" })
	})

	afterEach(() => {
		db.close()
	})

	test("updates multiple rows with basic columns", () => {
		db.exec(`
      CREATE TABLE test_updates (
        id INTEGER PRIMARY KEY,
        name TEXT,
        status TEXT
      )
    `)

		// Insert initial data
		db.exec(`
      INSERT INTO test_updates (id, name, status) VALUES
      (1, 'old1', 'inactive'),
      (2, 'old2', 'inactive'),
      (3, 'old3', 'inactive')
    `)

		const stmt = db.sql<{ id: number; name: string; status: string }>`
      UPDATE test_updates
      ${["*", { jsonColumns: [], forEach: true }]}
      WHERE id IN (1, 2, 3)
    `

		const params = [
			{ id: 1, name: "new1", status: "active" },
			{ id: 2, name: "new2", status: "active" },
			{ id: 3, name: "new3", status: "active" },
		]

		stmt.run(params)

		const result = db.sql<Record<string, never>>`
      SELECT * FROM test_updates ORDER BY id
    `.all()

		assert.deepEqual(result, params)
	})

	test("updates multiple rows with JSON columns", () => {
		db.exec(`
      CREATE TABLE entities (
        id INTEGER PRIMARY KEY,
        data JSON
      )
    `)

		// Insert initial data
		db.exec(`
      INSERT INTO entities (id, data) VALUES
      (1, '{"old": true}'),
      (2, '{"old": true}')
    `)

		const stmt = db.sql<{ id: number; data: Record<string, unknown> }>`
      UPDATE entities
      ${["*", { jsonColumns: ["data"], forEach: true }]}
      WHERE id IN (1, 2)
    `

		const params = [
			{ id: 1, data: { new: true, value: 1 } },
			{ id: 2, data: { new: true, value: 2 } },
		]

		stmt.run(params)

		const result = db.sql<Record<string, never>>`
      SELECT id, json_extract(data, '$') as data
      FROM entities ORDER BY id
    `.all()

		assert.deepEqual(result, params)
	})

	test("updates subset of columns", () => {
		db.exec(`
      CREATE TABLE partial_updates (
        id INTEGER PRIMARY KEY,
        name TEXT,
        age INTEGER,
        email TEXT
      )
    `)

		// Insert initial data
		db.exec(`
      INSERT INTO partial_updates (id, name, age, email) VALUES
      (1, 'old1', 20, 'old1@test.com'),
      (2, 'old2', 25, 'old2@test.com')
    `)

		const stmt = db.sql<{ id: number; age: number; email: string }>`
      UPDATE partial_updates
      ${["$age", "$email"]}
      WHERE id IN (1, 2)
    `

		stmt.run({ id: 1, age: 30, email: "new1@test.com" })

		const result = db.sql<Record<string, never>>`
      SELECT * FROM partial_updates WHERE id = 1
    `.get()

		assert.deepEqual(result, {
			id: 1,
			name: "old1",
			age: 30,
			email: "new1@test.com",
		})
	})

	test("handles updates with complex JSON structures", () => {
		db.exec(`
      CREATE TABLE complex_updates (
        id INTEGER PRIMARY KEY,
        config JSON,
        metadata JSON
      )
    `)

		// Insert initial data
		db.exec(`
      INSERT INTO complex_updates (id) VALUES (1), (2)
    `)

		const stmt = db.sql<{
			id: number
			config: Record<string, unknown>
			metadata: Record<string, unknown>
		}>`
      UPDATE complex_updates
      ${["*", { jsonColumns: ["config", "metadata"], forEach: true }]}
      WHERE id IN (1, 2)
    `

		const params = [
			{
				id: 1,
				config: { features: ["a", "b"], settings: { enabled: true } },
				metadata: { updated: new Date().toISOString(), version: 1 },
			},
			{
				id: 2,
				config: { features: ["c", "d"], settings: { enabled: false } },
				metadata: { updated: new Date().toISOString(), version: 2 },
			},
		]

		stmt.run(params)

		const result = db.sql<Record<string, never>>`
      SELECT id,
        json_extract(config, '$') as config,
        json_extract(metadata, '$') as metadata
      FROM complex_updates
      ORDER BY id
    `.all()

		assert.deepEqual(result, params)
	})

	test("validates array parameters for set operation", () => {
		db.exec("CREATE TABLE validation_test (id INTEGER PRIMARY KEY, value TEXT)")

		const stmt = db.sql<{ id: number; value: string }>`
      UPDATE validation_test
      ${["*", { jsonColumns: [], forEach: true }]}
      WHERE id IN (1, 2)
    `

		assert.throws(
			() => stmt.run({ id: 1, value: "test" } as any),
			/Expected array of parameters/
		)
	})

	test("handles large batch updates", () => {
		db.exec("CREATE TABLE large_updates (id INTEGER PRIMARY KEY, value TEXT)")

		// Insert initial data
		const values = Array.from(
			{ length: 1000 },
			(_, i) => `(${i + 1}, 'old-${i + 1}')`
		).join(",")
		db.exec(`INSERT INTO large_updates (id, value) VALUES ${values}`)

		const stmt = db.sql<{ id: number; value: string }>`
      UPDATE large_updates
      ${["*", { jsonColumns: [], forEach: true }]}
      WHERE id <= 1000
    `

		const params = Array.from({ length: 1000 }, (_, i) => ({
			id: i + 1,
			value: `new-${i + 1}`,
		}))

		stmt.run(params)

		const result = db.sql<Record<string, never>>`
      SELECT COUNT(*) as count FROM large_updates WHERE value LIKE 'new-%'
    `.get() as { count: number }

		assert.equal(result.count, 1000)
	})

	test("handles mixed basic and JSON columns in updates", () => {
		db.exec(`
      CREATE TABLE mixed_updates (
        id INTEGER PRIMARY KEY,
        name TEXT,
        status TEXT,
        metadata JSON
      )
    `)

		// Insert initial data
		db.exec(`
      INSERT INTO mixed_updates (id, name, status) VALUES
      (1, 'old1', 'inactive'),
      (2, 'old2', 'inactive')
    `)

		const stmt = db.sql<{
			id: number
			name: string
			status: string
			metadata: Record<string, unknown>
		}>`
      UPDATE mixed_updates
      ${["*", { jsonColumns: ["metadata"], forEach: true }]}
      WHERE id IN (1, 2)
    `

		const params = [
			{
				id: 1,
				name: "new1",
				status: "active",
				metadata: { updated: true, time: "2025-01-01" },
			},
			{
				id: 2,
				name: "new2",
				status: "active",
				metadata: { updated: true, time: "2025-01-02" },
			},
		]

		stmt.run(params)

		const result = db.sql<Record<string, never>>`
      SELECT id, name, status, json_extract(metadata, '$') as metadata
      FROM mixed_updates ORDER BY id
    `.all()

		assert.deepEqual(result, params)
	})

	test("handles updates with WHERE IN clause", () => {
		db.exec(`
      CREATE TABLE where_in_test (
        id INTEGER PRIMARY KEY,
        value TEXT,
        metadata JSON
      )
    `)

		// Insert initial data
		db.exec(`
      INSERT INTO where_in_test (id, value) VALUES
      (1, 'old'),
      (2, 'old'),
      (3, 'old'),
      (4, 'old')
    `)

		const stmt = db.sql<{
			id: number
			value: string
			metadata: Record<string, unknown>
		}>`
      UPDATE where_in_test
      ${["*", { jsonColumns: ["metadata"], forEach: true }]}
      WHERE id IN (1, 3)
    `

		const params = [
			{ id: 1, value: "new", metadata: { updated: 1 } },
			{ id: 3, value: "new", metadata: { updated: 3 } },
		]

		stmt.run(params)

		const result = db.sql<Record<string, never>>`
      SELECT id, value, json_extract(metadata, '$') as metadata
      FROM where_in_test
      WHERE id IN (1, 3)
      ORDER BY id
    `.all()

		assert.deepEqual(result, params)

		// Verify other rows unchanged
		const unchanged = db.sql<Record<string, never>>`
      SELECT id, value FROM where_in_test WHERE id IN (2, 4)
    `.all()

		assert.deepEqual(unchanged, [
			{ id: 2, value: "old" },
			{ id: 4, value: "old" },
		])
	})
})
