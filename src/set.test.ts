// In values.set.test.ts
import { test, describe, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { DB } from "#database"
import { raw } from "#sql"

describe("SET Operations", () => {
	let db: DB

	beforeEach(() => {
		db = new DB({ location: ":memory:" })
		db.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        name TEXT,
        age INTEGER,
        metadata TEXT,
        settings TEXT,
        last_login TEXT,
        is_active BOOLEAN
      );

      INSERT INTO users (name, age, metadata, settings, is_active) VALUES
      ('Alice', 30, '{"role":"admin"}', '{"theme":"dark"}', true),
      ('Bob', 25, '{"role":"user"}', '{"theme":"light"}', true);
    `)
	})

	afterEach(() => {
		db.close()
	})

	describe("SQL Generation", () => {
		test(":set - generates SQL with object value types", () => {
			type UserUpdate = {
				name: string
				age: number
				is_active: boolean
			}

			const stmt = db.sql<UserUpdate>`
        UPDATE users ${
					{
						set: {
							name: "$name",
							age: "$age",
							is_active: "$is_active",
						},
						where: "id = $id",
						// biome-ignore lint/suspicious/noExplicitAny: <explanation>
					} as any
				}
      `

			assert.equal(
				stmt
					// biome-ignore lint/suspicious/noExplicitAny: <explanation>
					.sourceSQL({ name: "Carol", age: 28, is_active: true, id: 1 } as any)
					.trim(),
				"UPDATE users\nSET name = $name,\n  age = $age,\n  is_active = $is_active\nWHERE id = $id"
			)
		})

		test(":set - generates SQL with JSON operators", () => {
			type UserUpdate = {
				name: string
				metadata: { role: string }
				settings: { theme: string }
			}

			const stmt = db.sql<UserUpdate>`
        UPDATE users ${
					{
						set: {
							name: "$name",
							metadata: "$metadata->json",
							settings: "$settings->json",
						},
						where: "id = $id",
						// biome-ignore lint/suspicious/noExplicitAny: <explanation>
					} as any
				}
      `

			assert.equal(
				stmt
					.sourceSQL({
						name: "Carol",
						metadata: { role: "admin" },
						settings: { theme: "dark" },
						id: 1,
						// biome-ignore lint/suspicious/noExplicitAny: <explanation>
					} as any)
					.trim(),
				"UPDATE users\nSET name = $name,\n  metadata = jsonb($metadata),\n  settings = jsonb($settings)\nWHERE id = $id"
			)
		})

		test(":set - generates SQL with raw values", () => {
			type UserUpdate = {
				name: string
				last_login: string
			}

			const stmt = db.sql<UserUpdate>`
        UPDATE users ${
					{
						set: {
							name: "$name",
							last_login: raw`CURRENT_TIMESTAMP`,
						},
						where: "id = $id",
						// biome-ignore lint/suspicious/noExplicitAny: <explanation>
					} as any
				}
      `

			assert.equal(
				stmt
					// biome-ignore lint/suspicious/noExplicitAny: <explanation>
					.sourceSQL({ name: "Carol", id: 1 } as any)
					.trim(),
				"UPDATE users\nSET name = $name,\n  last_login = CURRENT_TIMESTAMP\nWHERE id = $id"
			)
		})

		test(":set - generates SQL with star notation", () => {
			type UserUpdate = {
				name: string
				age: number
			}

			const stmt = db.sql<UserUpdate>`
        UPDATE users ${
					{
						set: "*",
						where: "id = $id",
						// biome-ignore lint/suspicious/noExplicitAny: <explanation>
					} as any
				}
      `

			assert.equal(
				stmt
					// biome-ignore lint/suspicious/noExplicitAny: <explanation>
					.sourceSQL({ name: "Carol", age: 28, id: 1 } as any)
					.trim(),
				"UPDATE users\nSET name = $name,\n  age = $age,\n  id = $id\nWHERE id = $id"
			)
		})

		test(":set - generates SQL with jsonColumns array", () => {
			type UserUpdate = {
				name: string
				metadata: { role: string }
				settings: { theme: string }
			}

			const stmt = db.sql<UserUpdate>`
        UPDATE users ${
					{
						set: ["*", { jsonColumns: ["metadata", "settings"] }],
						where: "id = $id",
						// biome-ignore lint/suspicious/noExplicitAny: <explanation>
					} as any
				}
      `

			assert.equal(
				stmt
					.sourceSQL({
						name: "Carol",
						metadata: { role: "admin" },
						settings: { theme: "dark" },
						id: 1,
						// biome-ignore lint/suspicious/noExplicitAny: <explanation>
					} as any)
					.trim(),
				"UPDATE users\nSET name = $name,\n  metadata = jsonb($metadata),\n  settings = jsonb($settings),\n  id = $id\nWHERE id = $id"
			)
		})
	})

	describe(":set - Database Operations", () => {
		test(":set - updates with basic value types", () => {
			type UserUpdate = Partial<{
				name: string
				age: number
				id: number
			}>

			const update = db.sql<UserUpdate>`
        UPDATE users ${{
					set: {
						name: "$name",
						age: "$age",
					},
					where: "id = $id",
					returning: "*",
				}};
      `

			const result = update.get({
				name: "Carol",
				age: 35,
				id: 1,
			})

			assert.equal(result?.name, "Carol")
			assert.equal(result?.age, 35)
		})

		test(":set - updates with JSON columns", () => {
			type UserUpdate = {
				metadata: { role: string }
				settings: { theme: string }
				id: number
			}

			const update = db.sql<UserUpdate>`
        UPDATE users ${{
					set: {
						metadata: "$metadata->json",
						settings: "$settings->json",
					},
					where: "id = $id",
					returning: ["*", { jsonColumns: ["metadata", "settings"] }],
				}}
      `

			console.log(
				`SQL: ${update.sourceSQL({
					metadata: { role: "superadmin" },
					settings: { theme: "system" },
					id: 1,
				})}`
			)

			const result = update.get({
				metadata: { role: "superadmin" },
				settings: { theme: "system" },
				id: 1,
			})

			assert.deepEqual(result?.metadata, { role: "superadmin" })
			assert.deepEqual(result?.settings, { theme: "system" })
		})

		test(":set - updates with raw values", () => {
			type UserUpdate = {
				name: string
				id: number
				last_login?: string
			}

			const update = db.sql<UserUpdate>`
        UPDATE users ${
					{
						set: {
							name: "$name",
							last_login: raw`CURRENT_TIMESTAMP`,
						},
						where: "id = $id",
						returning: ["name", "last_login"],
						// biome-ignore lint/suspicious/noExplicitAny: <explanation>
					} as any
				}
      `

			const result = update.get({
				name: "Carol",
				id: 1,
			})

			assert.equal(result?.name, "Carol")
			assert.ok(result?.last_login, "last_login should be set")
		})

		test(":set - updates using star notation", () => {
			type UserUpdate = {
				name: string
				age: number
				id: number
			}

			const update = db.sql<UserUpdate>`
        UPDATE users ${{
					set: "*",
					where: "id = $id",
					returning: "*",
				}}
      `

			const result = update.get({
				name: "Carol",
				age: 35,
				id: 1,
			})

			assert.equal(result?.name, "Carol")
			assert.equal(result?.age, 35)
		})

		test(":set - updates using jsonColumns", () => {
			type UserUpdate = {
				name: string
				metadata: { role: string }
				settings: { theme: string }
				id: number
			}

			const update = db.sql<UserUpdate>`
        UPDATE users ${{
					set: ["*", { jsonColumns: ["metadata", "settings"] }],
					where: "id = $id",
					returning: ["*", { jsonColumns: ["metadata", "settings"] }],
				}}
      `

			const result = update.get({
				name: "Carol",
				metadata: { role: "superadmin" },
				settings: { theme: "system" },
				id: 1,
			})

			assert.equal(result?.name, "Carol")
			assert.deepEqual(result?.metadata, { role: "superadmin" })
			assert.deepEqual(result?.settings, { theme: "system" })
		})

		test(":set - handles multiple updates", () => {
			type UserUpdate = {
				is_active: number // Change to number since SQLite uses 0/1
				id1: number
				id2: number
			}

			const update = db.sql<UserUpdate>`
    UPDATE users ${{
			set: {
				is_active: "$is_active",
			},
			// biome-ignore lint/suspicious/noExplicitAny: <explanation>
			where: ["id = $id1", "OR", "id = $id2"] as any,
			returning: "*",
		}}
  `

			const results = update.all({
				is_active: 0, // Use 0 instead of false
				id1: 1,
				id2: 2,
			})

			assert.equal(results.length, 2)
			assert.ok(results.every(r => r.is_active === 0)) // Check for 0 instead of false
		})

		test(":set - verifies no update on no matching rows", () => {
			type UserUpdate = {
				name: string
				id: number
			}

			const update = db.sql<UserUpdate>`
        UPDATE users ${{
					set: {
						name: "$name",
					},
					where: "id = $id",
					returning: "*",
				}}
      `

			const result = update.run({
				name: "Carol",
				id: 999, // Non-existent ID
			})

			assert.equal(result.changes, 0)
		})
	})
})
