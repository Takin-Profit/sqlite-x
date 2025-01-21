import { test, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { rm, accessSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { DB } from "./database.js"
import { NodeSqliteError, SqlitePrimaryResultCode } from "./errors.js"

let db: DB
let dbPath: string
let backupPath: string

beforeEach(() => {
	dbPath = join(tmpdir(), `test-${Date.now()}.db`)
	backupPath = join(tmpdir(), `backup-${Date.now()}.db`)

	db = new DB({
		location: dbPath,
		environment: "testing",
		// logger: new ConsoleLogger(LogLevel.DEBUG), // Changed to DEBUG level
	})

	db.exec("DROP TABLE IF EXISTS posts;")
	db.exec("DROP TABLE IF EXISTS users;")

	db.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        age INTEGER NOT NULL,
        email TEXT UNIQUE
      );
    `)

	db.exec(`
      CREATE TABLE posts (
        id INTEGER PRIMARY KEY,
        title TEXT NOT NULL,
        user_id INTEGER,
        FOREIGN KEY(user_id) REFERENCES users(id)
      );
    `)
})

afterEach(() => {
	rm(dbPath, () => {})
	rm(backupPath, () => {})
})

test("executes basic SELECT query", () => {
	const insertUser = db.mutation<{ name: string; age: number; email: string }>(
		({ sql }) => sql`
            INSERT INTO users (name, age, email)
            VALUES (${"@name"}, ${"@age"}, ${"@email"})
        `
	)

	insertUser.run({ name: "John", age: 30, email: "john@example.com" })
	insertUser.run({ name: "Jane", age: 25, email: "jane@example.com" })

	const users = db.query<
		{ minAge: number },
		{
			name: string
			age: number
			email: string
		}
	>(
		({ sql }) => sql`
            SELECT name, age, email
            FROM users
            WHERE age >= ${"@minAge"}
        `
	)

	const results = users.all({
		minAge: 28,
	})

	assert.equal(results.length, 1)
	assert.equal(results[0].name, "John")
	assert.equal(results[0].age, 30)
})

test("handles syntax errors", () => {
	const query = db.query<Record<string, never>>(
		({ sql }) => sql`SELEC * FORM users`
	)

	assert.throws(
		() => query.all({}), // Execute the query to trigger the error
		(error) =>
			error instanceof NodeSqliteError &&
			NodeSqliteError.fromNodeSqlite(error).getPrimaryResultCode() ===
				SqlitePrimaryResultCode.SQLITE_ERROR
	)
})

test("handles complex WHERE conditions", () => {
	const insertUser = db.mutation<{ name: string; age: number; email: string }>(
		({ sql }) => sql`
            INSERT INTO users (name, age, email)
            VALUES (${"@name"}, ${"@age"}, ${"@email"})
        `
	)

	insertUser.run({ name: "John", age: 30, email: "john@example.com" })
	insertUser.run({ name: "Jane", age: 25, email: "jane@example.com" })
	insertUser.run({ name: "Bob", age: 35, email: "bob@example.com" })

	const getUsersQuery = db.query<{ minAge: number; nameLike: string }>(
		({ sql }) => sql`
            SELECT * FROM users
            WHERE age >= ${"@minAge"}
            AND name LIKE ${"@nameLike"}
        `
	)

	const results = getUsersQuery.all<{ name: string; age: number }>({
		minAge: 25,
		nameLike: "J%",
	})

	assert.equal(results.length, 2)
	assert.ok(results.every((user) => user.name.startsWith("J")))
})

test("performs INSERT operation", () => {
	const insertUser = db.mutation<{ name: string; age: number; email: string }>(
		({ sql }) => sql`
            INSERT INTO users (name, age, email)
            VALUES (${"@name"}, ${"@age"}, ${"@email"})
        `
	)

	const result = insertUser.run({
		name: "John",
		age: 30,
		email: "john@example.com",
	})

	assert.equal(result.changes, 1)
	assert.ok(result.lastInsertRowid > 0)
})

test("performs UPDATE operation", () => {
	const insertUser = db.mutation<{ name: string; age: number; email: string }>(
		({ sql }) => sql`
            INSERT INTO users (name, age, email)
            VALUES (${"@name"}, ${"@age"}, ${"@email"})
        `
	)

	const inserted = insertUser.run({
		name: "John",
		age: 30,
		email: "john@example.com",
	})

	const updateUser = db.mutation<{ id: number | bigint; newAge: number }>(
		({ sql }) => sql`
            UPDATE users
            SET age = ${"@newAge"}
            WHERE id = ${"@id"}
        `
	)

	const result = updateUser.run({
		id: inserted.lastInsertRowid,
		newAge: 31,
	})

	assert.equal(result.changes, 1)
})

test("performs DELETE operation", () => {
	const insertUser = db.mutation<{ name: string; age: number; email: string }>(
		({ sql }) => sql`
            INSERT INTO users (name, age, email)
            VALUES (${"@name"}, ${"@age"}, ${"@email"})
        `
	)

	const inserted = insertUser.run({
		name: "John",
		age: 30,
		email: "john@example.com",
	})

	const deleteUser = db.mutation<{ id: number | bigint }>(
		({ sql }) => sql`
            DELETE FROM users
            WHERE id = ${"@id"}
        `
	)

	const result = deleteUser.run({ id: inserted.lastInsertRowid })
	assert.equal(result.changes, 1)
})

test("handles unique constraint violations", () => {
	const insertUser = db.mutation<{ name: string; age: number; email: string }>(
		({ sql }) => sql`
            INSERT INTO users (name, age, email)
            VALUES (${"@name"}, ${"@age"}, ${"@email"})
        `
	)

	insertUser.run({
		name: "John",
		age: 30,
		email: "john@example.com",
	})

	assert.throws(
		() =>
			insertUser.run({
				name: "Jane",
				age: 25,
				email: "john@example.com",
			}),
		(error) =>
			error instanceof NodeSqliteError &&
			error.message.includes("UNIQUE constraint")
	)
})

test("handles foreign key constraints", () => {
	const insertPost = db.mutation<{ title: string; userId: number }>(
		({ sql }) => sql`
            INSERT INTO posts (title, user_id)
            VALUES (${"@title"}, ${"@userId"})
        `
	)

	assert.throws(
		() =>
			insertPost.run({
				title: "Test Post",
				userId: 999,
			}),
		(error) =>
			error instanceof NodeSqliteError &&
			error.message.includes("FOREIGN KEY constraint")
	)
})

test("enforces NOT NULL constraints", () => {
	const insertUser = db.mutation<{
		name: string | null
		age: number
	}>(
		({ sql }) => sql`
      INSERT INTO users (name, age)
      VALUES (${"@name"}, ${"@age"})
    `
	)

	assert.throws(
		() =>
			insertUser.run({
				name: null,
				age: 30,
			}),
		(error: unknown) => {
			if (!(error instanceof NodeSqliteError)) {
				return false
			}

			return (
				error.code === "ERR_SQLITE_ERROR" &&
				error.errcode === 1299 &&
				error.message.includes("NOT NULL constraint failed: users.name")
			)
		}
	)
})

test("creates and restores from backup", () => {
	const insertUser = db.mutation<{ name: string; age: number; email: string }>(
		({ sql }) => sql`
            INSERT INTO users (name, age, email)
            VALUES (${"@name"}, ${"@age"}, ${"@email"})
        `
	)

	insertUser.run({
		name: "John",
		age: 30,
		email: "john@example.com",
	})

	db.backup(backupPath)

	assert.doesNotThrow(() => accessSync(backupPath))

	db.close()
	db = new DB({ location: dbPath })
	db.restore(backupPath)

	const getUsers = db.query<Record<string, never>>(
		({ sql }) => sql`SELECT * FROM users`
	)

	const results = getUsers.all<{ name: string; age: number }>({})
	assert.equal(results.length, 1)
	assert.equal(results[0].name, "John")
	assert.equal(results[0].age, 30)
})

test("throws on invalid backup path", () => {
	assert.throws(
		() => db.backup("/invalid/path/backup.db"),
		(error) =>
			error instanceof NodeSqliteError &&
			error.getPrimaryResultCode() === SqlitePrimaryResultCode.SQLITE_CANTOPEN
	)
})

test("throws on invalid restore path", () => {
	assert.throws(
		() => db.restore("/nonexistent/backup.db"),
		(error) =>
			error instanceof NodeSqliteError &&
			error.getPrimaryResultCode() === SqlitePrimaryResultCode.SQLITE_CANTOPEN
	)
})

test("caches prepared statements", () => {
	const dbWithCache = new DB({
		location: ":memory:",
		statementCache: { maxSize: 10 },
	})

	const query = dbWithCache.query<{ minAge: number }>(
		// Use dbWithCache here
		({ sql }) => sql`
            SELECT * FROM users
            WHERE age > ${"@minAge"}
        `
	)

	// Need to create the table first
	dbWithCache.exec(`
        CREATE TABLE users (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            age INTEGER NOT NULL,
            email TEXT UNIQUE
        );
    `)

	query.all<unknown[]>({ minAge: 20 })
	query.all<unknown[]>({ minAge: 25 })
	query.all<unknown[]>({ minAge: 30 })

	const stats = dbWithCache.getCacheStats()
	assert.ok(stats)
	assert.ok(stats.hits > 0)

	dbWithCache.close()
})

test("clears statement cache", () => {
	const dbWithCache = new DB({
		location: ":memory:",
		statementCache: { maxSize: 10 },
	})

	dbWithCache.clearStatementCache()
	const stats = dbWithCache.getCacheStats()
	assert.ok(stats)
	assert.equal(stats.size, 0)

	dbWithCache.close()
})
