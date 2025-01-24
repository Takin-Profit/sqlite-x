// Copyright 2025 Takin Profit. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

import { test, describe, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { buildOrderByStatement } from "#order-by"
import { NodeSqliteError } from "#errors"
import { DB } from "#database"

describe("buildOrderByStatement", () => {
	test("generates single column order", () => {
		const { sql } = buildOrderByStatement({ name: "ASC" })
		assert.equal(sql, "ORDER BY name ASC")
	})

	test("generates multi-column order", () => {
		const { sql } = buildOrderByStatement({
			age: "DESC",
			name: "ASC",
		})
		assert.equal(sql, "ORDER BY age DESC, name ASC")
	})

	test("throws on invalid direction", () => {
		assert.throws(
			() => buildOrderByStatement({ name: "ASCENDING" as "ASC" | "DESC" }),
			(err: unknown) => {
				assert(err instanceof NodeSqliteError)
				assert(err.message.includes("Sort direction must be"))
				return true
			}
		)
	})

	test("throws on empty orderBy", () => {
		assert.throws(
			() => buildOrderByStatement({}),
			(err: unknown) => {
				assert(err instanceof NodeSqliteError)
				assert(err.message.includes("must be a non-empty object"))
				return true
			}
		)
	})
})

describe("OrderBy Context SQL Generation", () => {
	let db: DB

	beforeEach(() => {
		db = new DB({ location: ":memory:" })
		db.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        age INTEGER NOT NULL,
        email TEXT UNIQUE
      );
    `)

		const insert = db.sql<{ name: string; age: number; email: string }>`
        INSERT INTO users (name, age, email)
        VALUES (${"$name"}, ${"$age"}, ${"$email"})
      `

		insert.run({ name: "John", age: 30, email: "john@example.com" })
		insert.run({ name: "Alice", age: 25, email: "alice@example.com" })
		insert.run({ name: "Bob", age: 35, email: "bob@example.com" })
	})

	afterEach(() => {
		db.close()
	})

	test("generates and executes formatted ORDER BY clause", () => {
		const query = db.sql<Record<string, never>>`
        SELECT * FROM users
        ${{ orderBy: { name: "ASC", age: "DESC" } }}
      `

		const results = query.all<{ name: string; age: number }>({})

		assert.equal(
			query.sourceSQL({}).trim(),
			"SELECT * FROM users\n        ORDER BY name ASC, age DESC"
		)

		// Verify order
		assert.equal(results[0].name, "Alice")
		assert.equal(results[1].name, "Bob")
		assert.equal(results[2].name, "John")
	})
})
