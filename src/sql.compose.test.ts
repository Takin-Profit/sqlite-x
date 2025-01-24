import { test, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { DB } from "#database"
import { isNodeSqliteError } from "#errors"

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
      active BOOLEAN DEFAULT true,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE posts (
      id INTEGER PRIMARY KEY,
      user_id INTEGER,
      title TEXT NOT NULL,
      metadata JSON,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );
  `)
})

afterEach(() => {
	db.close()
})

test("concatenates simple strings", () => {
	let query = db.sql`SELECT * FROM users`
	query = query.sql`WHERE id = ${"$id"}`

	assert.equal(
		query.sourceSQL({ id: 1 }).trim(),
		"SELECT *\nFROM users\nWHERE id = $id"
	)
})

test("maintains proper sql spacing with multiple concatenations", () => {
	let query = db.sql`SELECT * FROM users`
	query = query.sql`WHERE age > ${"$age"}`
	query = query.sql` AND active = ${"$active"}`

	assert.equal(
		query.sourceSQL({ age: 21, active: true }).trim(),
		"SELECT *\nFROM users\nWHERE age > $age\n  AND active = $active"
	)
})

test("correctly handles JSON operations", () => {
	let query = db.sql`INSERT INTO users (name, settings) VALUES`
	query = query.sql`(${"$name"}, ${"$settings->json"})`

	assert.equal(
		query
			.sourceSQL({
				name: "test",
				settings: { theme: "dark" },
			})
			.trim(),
		"INSERT INTO users (name, settings)\nVALUES ($name, jsonb($settings))"
	)
})

test("concatenates multiple SQL fragments with contexts", () => {
	let query = db.sql`SELECT * FROM users`
	query = query.sql`${{
		where: "age > $age",
		orderBy: { name: "ASC" },
		limit: 10,
	}}`

	assert.equal(
		query.sourceSQL({ age: 21 }).trim(),
		"SELECT *\nFROM users\nWHERE age > $age\nORDER BY name ASC\nLIMIT 10"
	)
})

test("preserves SQL context validation", () => {
	assert.throws(() => {
		let query = db.sql`SELECT * FROM users`
		query = query.sql`${
			{
				where: "INVALID",
				orderBy: { name: "WRONG" },
				// biome-ignore lint/suspicious/noExplicitAny: <explanation>
			} as any
		}`
		query.sourceSQL({})
	}, isNodeSqliteError)
})

test("maintains parameter references through concatenation", () => {
	let query = db.sql`SELECT * FROM users WHERE`
	query = query.sql`age BETWEEN ${"$min"} AND ${"$max"}`

	assert.equal(
		query.sourceSQL({ min: 20, max: 30 }).trim(),
		"SELECT *\nFROM users\nWHERE age BETWEEN $min AND $max"
	)
})

test("builds complex SELECT with context columns", () => {
	let query = db.sql`SELECT ${{ cols: ["users.id", "users.name", "users.metadata<-json"] }} FROM users`
	query = query.sql`INNER JOIN posts ON user_id = users.id`
	query = query.sql`${
		// biome-ignore lint/suspicious/noExplicitAny: <explanation>
		{ where: "age > $minAge" } as any
	}`
	query = query.sql`${
		// biome-ignore lint/suspicious/noExplicitAny: <explanation>
		{ orderBy: { created_at: "DESC" }, limit: 5 } as any
	}`

	assert.equal(
		query
			// biome-ignore lint/suspicious/noExplicitAny: <explanation>
			.sourceSQL({ minAge: 21 } as any)
			.trim(),
		"SELECT users.id,\n  users.name,\n  json_extract(users.metadata, '$')\nFROM users\n  INNER JOIN posts ON user_id = users.id\nWHERE age > $minAge\nORDER BY created_at DESC\nLIMIT 5"
	)
})

test("builds CTE with complex SELECT", () => {
	let query = db.sql`WITH filtered_users AS (`
	query = query.sql`SELECT ${{ cols: ["id", "name", "metadata<-json"] }}`
	query = query.sql`FROM users`
	query = query.sql`${{ where: "age > $minAge", limit: 100 }})`
	query = query.sql`SELECT ${{ cols: ["id", "name"] }} FROM filtered_users`
	query = query.sql`${{ orderBy: { name: "ASC" } }}`

	assert.equal(
		query.sourceSQL({ minAge: 21 }).trim(),
		"WITH filtered_users AS (\n  SELECT id,\n    name,\n    json_extract(metadata, '$')\n  FROM users\n  WHERE age > $minAge\n  LIMIT 100\n)\nSELECT id,\n  name\nFROM filtered_users\nORDER BY name ASC"
	)
})

test("builds UPDATE with column list", () => {
	let query = db.sql`UPDATE users`
	query = query.sql`${{
		set: ["$name", "$email", "$metadata->json"],
		where: "id = $id",
		returning: ["id", "email"],
	}}`

	assert.equal(
		query
			.sourceSQL({
				id: 1,
				name: "Test",
				email: "test@example.com",
				metadata: { updated: true },
			})
			.trim(),
		"UPDATE users\nSET name = $name,\n  email = $email,\n  metadata = jsonb($metadata)\nWHERE id = $id\nRETURNING id,\n  email"
	)
})

test("builds complex INSERT with subselect and CTE", () => {
	let query = db.sql`WITH active_users AS (`
	query = query.sql`SELECT ${{ cols: ["id", "metadata<-json"] }}`
	query = query.sql`FROM users`
	query = query.sql`${{ where: "active = $active" }})`
	query = query.sql`INSERT INTO posts (user_id, metadata)`
	query = query.sql`SELECT id, ${"$newMeta->json"}`
	query = query.sql`FROM active_users`
	query = query.sql`${{ returning: "*" }}`

	assert.equal(
		query
			.sourceSQL({
				active: true,
				newMeta: { type: "post" },
			})
			.trim(),
		"WITH active_users AS (\n  SELECT id,\n    json_extract(metadata, '$')\n  FROM users\n  WHERE active = $active\n)\nINSERT INTO posts (user_id, metadata)\nSELECT id,\n  jsonb($newMeta)\nFROM active_users\nRETURNING *"
	)
})
