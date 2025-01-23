// Copyright 2025 Takin Profit. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

import { DB } from "#database.js"
import assert from "node:assert"
import test, { afterEach, beforeEach, describe } from "node:test"

describe("SQL Values Context", () => {
	let db: DB

	beforeEach(() => {
		db = new DB({
			location: ":memory:",
			environment: "testing",
		})

		db.exec(`
            CREATE TABLE users (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                age INTEGER,
                email TEXT,
                metadata JSON,
                settings JSON,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        `)
	})

	afterEach(() => {
		db.close()
	})

	test("basic values context with primitive types", () => {
		const insertUser = db.prepare<{
			name: string
			age: number
			email: string
		}>(
			(ctx) => ctx.sql`
            INSERT INTO users ${{ values: ["$name", "$age", "$email"] }}
        `
		)

		const result = insertUser.run({
			name: "John",
			age: 30,
			email: "john@example.com",
		})

		assert.equal(result.changes, 1)

		// Verify insertion
		const user = db
			.prepare<{ id: number }>(
				(ctx) => ctx.sql`
            SELECT * FROM users WHERE id = ${"$id"}
        `
			)
			// biome-ignore lint/suspicious/noExplicitAny: <explanation>
			.get<any>({ id: result.lastInsertRowid as number })

		assert.equal(user?.name, "John")
		assert.equal(user?.age, 30)
		assert.equal(user?.email, "john@example.com")
	})

	test("values context with all columns using '*'", () => {
		const insertUser = db.prepare<{
			name: string
			age: number
			email: string
		}>(
			(ctx) => ctx.sql`
            INSERT INTO users ${{ values: "*" }}
        `
		)

		const result = insertUser.run({
			name: "Jane",
			age: 25,
			email: "jane@example.com",
		})

		assert.equal(result.changes, 1)

		const user = db
			.prepare<{ id: number }>(
				(ctx) => ctx.sql`
            SELECT * FROM users WHERE id = ${"$id"}
        `
			)
			// biome-ignore lint/suspicious/noExplicitAny: <explanation>
			.get<any>({ id: result.lastInsertRowid as number })

		assert.equal(user?.name, "Jane")
		assert.equal(user?.age, 25)
		assert.equal(user?.email, "jane@example.com")
	})

	test("values context with JSON column using toJson", () => {
		type UserWithMetadata = {
			name: string
			metadata: {
				preferences: {
					theme: string
					notifications: boolean
				}
			}
		}

		const insertUser = db.prepare<UserWithMetadata>(
			(ctx) => ctx.sql`
            INSERT INTO users ${{ values: ["$name", "$metadata.toJson"] }}
        `
		)

		const result = insertUser.run({
			name: "Alice",
			metadata: {
				preferences: {
					theme: "dark",
					notifications: true,
				},
			},
		})

		assert.equal(result.changes, 1)

		const user = db
			.prepare<{ id: number }>(
				(ctx) => ctx.sql`
            SELECT name, json_extract(metadata, '$.preferences.theme') as theme
            FROM users WHERE id = ${"$id"}
        `
			)
			// biome-ignore lint/suspicious/noExplicitAny: <explanation>
			.get<any>({ id: result.lastInsertRowid as number })

		assert.equal(user?.name, "Alice")
		assert.equal(user?.theme, "dark")
	})

	test("values context with multiple JSON columns", () => {
		type UserWithJson = {
			name: string
			metadata: { tags: string[] }
			settings: { fontSize: number }
		}

		const insertUser = db.prepare<UserWithJson>(
			(ctx) => ctx.sql`
            INSERT INTO users ${{
							values: ["$name", "$metadata.toJson", "$settings.toJson"],
						}}
        `
		)

		const result = insertUser.run({
			name: "Bob",
			metadata: { tags: ["admin", "user"] },
			settings: { fontSize: 14 },
		})

		assert.equal(result.changes, 1)

		const user = db
			.prepare<{ id: number }>(
				(ctx) => ctx.sql`
            SELECT
                name,
                json_extract(metadata, '$.tags[0]') as firstTag,
                json_extract(settings, '$.fontSize') as fontSize
            FROM users WHERE id = ${"$id"}
        `
			)
			// biome-ignore lint/suspicious/noExplicitAny: <explanation>
			.get<any>({ id: result.lastInsertRowid as number })

		assert.equal(user?.name, "Bob")
		assert.equal(user?.firstTag, "admin")
		assert.equal(user?.fontSize, 14)
	})

	test("values context with '*' and JSON columns configuration", () => {
		type UserWithJson = {
			name: string
			age: number
			metadata: { role: string }
			settings: { theme: string }
		}

		const insertUser = db.prepare<UserWithJson>(
			(ctx) => ctx.sql`
            INSERT INTO users ${{
							values: ["*", { jsonColumns: ["metadata", "settings"] }],
						}}
        `
		)

		const result = insertUser.run({
			name: "Charlie",
			age: 35,
			metadata: { role: "admin" },
			settings: { theme: "light" },
		})

		assert.equal(result.changes, 1)

		const user = db
			.prepare<{ id: number }>(
				(ctx) => ctx.sql`
            SELECT
                name,
                age,
                json_extract(metadata, '$.role') as role,
                json_extract(settings, '$.theme') as theme
            FROM users WHERE id = ${"$id"}
        `
			)
			// biome-ignore lint/suspicious/noExplicitAny: <explanation>
			.get<any>({ id: result.lastInsertRowid as number })

		assert.equal(user?.name, "Charlie")
		assert.equal(user?.age, 35)
		assert.equal(user?.role, "admin")
		assert.equal(user?.theme, "light")
	})

	test("values context with subset of available columns", () => {
		const insertUser = db.prepare<{
			name: string
			age: number
			email: string
		}>(
			(ctx) => ctx.sql`
            INSERT INTO users ${
							{ values: ["$name", "$age"] } // Deliberately omit email
						}
        `
		)

		const result = insertUser.run({
			name: "Dave",
			age: 40,
			email: "dave@example.com", // This won't be inserted
		})

		assert.equal(result.changes, 1)

		const user = db
			.prepare<{ id: number }>(
				(ctx) => ctx.sql`
            SELECT name, age, email
            FROM users WHERE id = ${"$id"}
        `
			)
			// biome-ignore lint/suspicious/noExplicitAny: <explanation>
			.get<any>({ id: result.lastInsertRowid as number })

		assert.equal(user?.name, "Dave")
		assert.equal(user?.age, 40)
		assert.equal(user?.email, null) // Email should be null
	})

	test("values context with null values", () => {
		const insertUser = db.prepare<{
			name: string
			age: number | null
			metadata: Record<string, unknown> | null
		}>(
			(ctx) => ctx.sql`
            INSERT INTO users ${{
							values: ["$name", "$age", "$metadata.toJson"],
						}}
        `
		)

		const result = insertUser.run({
			name: "Eve",
			age: null,
			metadata: null,
		})

		assert.equal(result.changes, 1)

		const user = db
			.prepare<{ id: number }>(
				(ctx) => ctx.sql`
            SELECT name, age, metadata
            FROM users WHERE id = ${"$id"}
        `
			)
			// biome-ignore lint/suspicious/noExplicitAny: <explanation>
			.get<any>({ id: result.lastInsertRowid as number })

		assert.equal(user?.name, "Eve")
		assert.equal(user?.age, null)
		assert.equal(user?.metadata, null)
	})
})
