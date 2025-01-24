/* import { test, describe, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { DB } from "#database"

let db: DB

beforeEach(() => {
	db = new DB({ location: ":memory:" })

	db.exec(`
   CREATE TABLE users (
     id INTEGER PRIMARY KEY,
     name TEXT NOT NULL,
     email TEXT UNIQUE,
     age INTEGER,
     settings JSON,
     metadata JSON,
     created_at TEXT DEFAULT CURRENT_TIMESTAMP
   );

   CREATE TABLE posts (
     id INTEGER PRIMARY KEY,
     title TEXT NOT NULL,
     content TEXT,
     author_id INTEGER,
     tags JSON,
     published_at TEXT,
     FOREIGN KEY(author_id) REFERENCES users(id)
   );
 `)
})

afterEach(() => {
	db.close()
})

describe("SQL Query Composition", () => {
	test("basic SELECT composition", () => {
		const query = db.sql<{ minAge: number }>`SELECT * FROM users`
			.sql`WHERE age > ${"$minAge"}`.sql`ORDER BY name ASC`.sql`LIMIT 10`

		assert.equal(
			query.sourceSQL({ minAge: 18 }).trim(),
			"SELECT * FROM users WHERE age > $minAge ORDER BY name ASC LIMIT 10"
		)
	})

	test("chained SELECT with multiple parameters", () => {
		const query = db.sql<{ minAge: number; namePattern: string }>`
     SELECT id, name, email FROM users`.sql`WHERE age > ${"$minAge"}`
			.sql` AND name LIKE ${"$namePattern"}`.sql`ORDER BY created_at DESC`
			.sql`LIMIT 20 OFFSET 40`

		assert.equal(
			query.sourceSQL({ minAge: 21, namePattern: "J%" }).trim(),
			"SELECT id, name, email FROM users WHERE age > $minAge AND name LIKE $namePattern ORDER BY created_at DESC LIMIT 20 OFFSET 40"
		)
	})

	test("INSERT with JSON and context", () => {
		interface UserInsert {
			name: string
			email: string
			settings: { theme: string; notifications: boolean }
		}

		const query = db.sql<UserInsert>`
     INSERT INTO users (name, email, settings)`
			.sql`VALUES (${"$name"}, ${"$email"}, ${"$settings->json"})`
			.sql`${{ returning: ["id", "created_at"] }}`

		const sql = query.sourceSQL({
			name: "John",
			email: "john@example.com",
			settings: { theme: "dark", notifications: true },
		})

		assert.ok(sql.includes("INSERT INTO users"))
		assert.ok(sql.includes("VALUES ($name, $email, jsonb($settings))"))
		assert.ok(sql.includes("RETURNING id, created_at"))
	})

	test("UPDATE with JSON operations and context", () => {
		interface UserUpdate {
			id: number
			name: string
			settings: { theme: string }
		}

		const query = db.sql<UserUpdate>`UPDATE users`.sql`${{
			set: ["$name", "$settings->json"],
			where: "id = $id",
			returning: "*",
		}}`

		const sql = query.sourceSQL({
			id: 1,
			name: "Updated",
			settings: { theme: "light" },
		})

		assert.ok(sql.includes("SET name = $name, settings = jsonb($settings)"))
		assert.ok(sql.includes("WHERE id = $id"))
		assert.ok(sql.includes("RETURNING *"))
	})

	test("JOIN composition with multiple tables", () => {
		interface JoinQuery {
			userId: number
		}

		const query = db.sql<JoinQuery>`
     SELECT u.name, p.title, p.content
     FROM users u
     JOIN posts p ON p.author_id = u.id`.sql`WHERE u.id = ${"$userId"}`.sql`${{
			orderBy: { "p.published_at": "DESC" },
			limit: 5,
		}}`

		const sql = query.sourceSQL({ userId: 1 })
		assert.ok(sql.includes("JOIN posts p ON p.author_id = u.id"))
		assert.ok(sql.includes("WHERE u.id = $userId"))
		assert.ok(sql.includes("ORDER BY p.published_at DESC"))
		assert.ok(sql.includes("LIMIT 5"))
	})

	test("composition with JSON extraction", () => {
		interface JsonQuery {
			id: number
			metadata: { type: string }
		}

		const query = db.sql<JsonQuery>`
     SELECT *, ${"$metadata<-json"} as metadata_json
     FROM users`.sql`WHERE id = ${"$id"}`
			.sql` AND metadata = ${"$metadata->json"}`

		const sql = query.sourceSQL({
			id: 1,
			metadata: { type: "admin" },
		})

		assert.ok(sql.includes("json_extract(metadata, '$')"))
		assert.ok(sql.includes("metadata = jsonb($metadata)"))
	})

	test("deep chaining with mixed contexts", () => {
		interface DeepQuery {
			userId: number
			age: number
			settings: { active: boolean }
		}

		let query = db.sql<DeepQuery>`SELECT * FROM users`
		query = query.sql`WHERE id = ${"$userId"}`
		query = query.sql` AND age > ${"$age"}`
		query = query.sql` AND settings = ${"$settings->json"}`
		query = query.sql`${{
			orderBy: { created_at: "DESC" },
			limit: 1,
			returning: "*",
		}}`

		const sql = query.sourceSQL({
			userId: 1,
			age: 25,
			settings: { active: true },
		})

		assert.ok(sql.includes("WHERE id = $userId"))
		assert.ok(sql.includes("age > $age"))
		assert.ok(sql.includes("settings = jsonb($settings)"))
		assert.ok(sql.includes("ORDER BY created_at DESC"))
		assert.ok(sql.includes("LIMIT 1"))
		assert.ok(sql.includes("RETURNING *"))
	})

	test("execution with actual data", () => {
		interface User {
			name: string
			email: string
			settings: { theme: string }
		}

		const insert = db.sql<User>`
     INSERT INTO users (name, email, settings)
     VALUES (${"$name"}, ${"$email"}, ${"$settings->json"})
     RETURNING *`

		const user = insert.get({
			name: "Test",
			email: "test@example.com",
			settings: { theme: "dark" },
		})

		assert.ok(user)
		assert.equal(user.name, "Test")
		assert.equal(user.email, "test@example.com")
		assert.deepEqual(user.settings, { theme: "dark" })

		const select = db.sql<{ id: number }>`
     SELECT *, ${"$settings<-json"} as settings_json
     FROM users
     WHERE id = ${"$id"}`

		const found = select.get({ id: user.id })
		assert.ok(found)
		assert.equal(found.name, "Test")
		assert.deepEqual(found.settings_json, { theme: "dark" })
	})
})
 */
