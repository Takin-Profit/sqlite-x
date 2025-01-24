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
