import { test, beforeEach, afterEach, describe } from "node:test"
import assert from "node:assert/strict"
import { DB } from "#database"
import { NodeSqliteError } from "#errors"
import { raw } from "#sql.js"

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

describe("Statement Composition", () => {
	test("composes basic SELECT with WHERE", () => {
		const select = db.sql`SELECT * FROM users`
		const where = db.sql`WHERE id = ${"$id"}`
		const query = db.sql`${select} ${where}`

		assert.equal(
			query.sourceSQL({ id: 1 }).trim(),
			"SELECT *\nFROM users\nWHERE id = $id"
		)
	})

	test("composes SELECT with columns and WHERE", () => {
		type User = {
			id: number
			name: string
			email: string
		}

		const select = db.sql<Partial<User>>`
      SELECT ${{ columns: ["id", "name", "email"] }}
      FROM users
    `
		const where = db.sql<{ id: number }>`WHERE id = ${"$id"}`
		const query = db.sql`${select} ${where}`

		assert.equal(
			query.sourceSQL({ id: 1 }).trim(),
			"SELECT id,\n  name,\n  email\nFROM users\nWHERE id = $id"
		)
	})

	test("composes multiple statements with JSON operations", () => {
		type UserWithJSON = {
			id: number
			name: string
			settings: { theme: string }
		}

		const select = db.sql<Partial<UserWithJSON>>`
      SELECT ${{ columns: ["id", "name", "settings<-json"] }}
      FROM users
    `
		const where = db.sql<{ id: number }>`WHERE id = ${"$id"}`
		const query = db.sql`${select} ${where}`

		assert.equal(
			query.sourceSQL({ id: 1 }).trim(),
			"SELECT id,\n  name,\n  json_extract(settings, '$') AS settings\nFROM users\nWHERE id = $id"
		)
	})

	test("composes statements with contexts", () => {
		type QueryParams = {
			minAge: number
			active: boolean
		}

		const select = db.sql`SELECT * FROM users`
		const conditions = db.sql<QueryParams>`${
			{
				where: ["age > $minAge", "AND", "active = $active"],
				orderBy: { name: "ASC" },
				limit: 10,
				// biome-ignore lint/suspicious/noExplicitAny: <explanation>
			} as any
		}`
		const query = db.sql`${select} ${conditions}`

		assert.equal(
			query.sourceSQL({ minAge: 21, active: true }).trim(),
			"SELECT *\nFROM users\nWHERE age > $minAge\n  AND active = $active\nORDER BY name ASC\nLIMIT 10"
		)
	})

	test("composes INSERT with VALUES", () => {
		type NewUser = {
			name: string
			email: string
			metadata: { tags: string[] }
		}

		const insert = db.sql`INSERT INTO users`
		const values = db.sql<NewUser>`${{
			values: ["$name", "$email", "$metadata->json"],
		}}`
		const query = db.sql`${insert} ${values}`

		assert.equal(
			query
				.sourceSQL({
					name: "Test User",
					email: "test@example.com",
					metadata: { tags: ["new"] },
				})
				.trim(),
			"INSERT INTO users (name, email, metadata)\nVALUES ($name, $email, jsonb($metadata))"
		)
	})

	test("composes complex CTE", () => {
		type FilterParams = {
			minAge: number
			active: boolean
		}

		// Create base CTE query in one statement to avoid syntax issues
		const cteQuery = db.sql<FilterParams>`
        WITH active_users AS (
            SELECT ${
							// biome-ignore lint/suspicious/noExplicitAny: <explanation>
							{ columns: ["id", "name", "metadata<-json"] } as any
						}
            FROM users
            ${
							{
								where: ["age > $minAge", "AND", "active = $active"],
								limit: 100,
								// biome-ignore lint/suspicious/noExplicitAny: <explanation>
							} as any
						}
        )
        SELECT ${
					// biome-ignore lint/suspicious/noExplicitAny: <explanation>
					{ columns: ["id", "name"] } as any
				}
        FROM active_users
        ${
					// biome-ignore lint/suspicious/noExplicitAny: <explanation>
					{ orderBy: { name: "ASC" } } as any
				}
    `

		assert.equal(
			cteQuery.sourceSQL({ minAge: 21, active: true }).trim(),
			"WITH active_users AS (\n  SELECT id,\n    name,\n    json_extract(metadata, '$') AS metadata\n  FROM users\n  WHERE age > $minAge\n    AND active = $active\n  LIMIT 100\n)\nSELECT id,\n  name\nFROM active_users\nORDER BY name ASC"
		)
	})
	test("handles parameter type checking across composed statements", () => {
		type UserParams = {
			name: string
			age: number
		}

		const select = db.sql<UserParams>`
      SELECT * FROM users
      WHERE name = ${"$name"}
    `
		// This should type error if uncommented:
		// const invalidWhere = db.sql<{ wrongParam: string }>`AND age = ${"$wrongParam"}`

		const validWhere = db.sql<UserParams>`AND age = ${"$age"}`
		const query = db.sql`${select} ${validWhere}`

		assert.equal(
			query.sourceSQL({ name: "Test", age: 25 }).trim(),
			"SELECT *\nFROM users\nWHERE name = $name\n  AND age = $age"
		)
	})

	test("preserves parameter scope in nested compositions", () => {
		type BaseParams = { id: number }
		type ExtendedParams = BaseParams & { email: string }

		const base = db.sql<BaseParams>`SELECT * FROM users WHERE id = ${"$id"}`
		const extended = db.sql<ExtendedParams>`${base} AND email = ${"$email"}`
		const final = db.sql`${extended} ORDER BY id`

		assert.equal(
			final.sourceSQL({ id: 1, email: "test@example.com" }).trim(),
			"SELECT *\nFROM users\nWHERE id = $id\n  AND email = $email\nORDER BY id"
		)
	})

	test("validates contexts in composed statements", () => {
		const select = db.sql`SELECT * FROM users`
		assert.throws(() => {
			const invalidContext = db.sql`${
				{
					where: "INVALID SYNTAX",
					orderBy: { nonExistentColumn: "ASC" },
					// biome-ignore lint/suspicious/noExplicitAny: <explanation>
				} as any
			}`
			const query = db.sql`${select} ${invalidContext}`
			query.sourceSQL()
		}, NodeSqliteError)
	})

	test("composes raw SQL literals correctly", () => {
		const tableName = "users"
		const select = db.sql`SELECT * FROM ${raw`${tableName}`}`
		const where = db.sql<{ age: number }>`WHERE age > ${"$age"}`
		const query = db.sql`${select} ${where}`

		assert.equal(
			query.sourceSQL({ age: 21 }).trim(),
			"SELECT *\nFROM users\nWHERE age > $age"
		)
	})

	test("executes composed queries correctly", () => {
		// First insert some test data
		const insertUser = db.sql<{ name: string; age: number }>`
      INSERT INTO users (name, age) VALUES (${"$name"}, ${"$age"})
    `
		insertUser.run({ name: "Test User", age: 25 })

		// Now test the composed query
		const select = db.sql`SELECT * FROM users`
		const where = db.sql<{ age: number }>`WHERE age = ${"$age"}`
		const query = db.sql`${select} ${where}`

		const result = query.get<{ name: string; age: number }>({ age: 25 })
		assert.equal(result?.name, "Test User")
		assert.equal(result?.age, 25)
	})
})

describe("Complex Query Integration", () => {
	let db: DB

	beforeEach(() => {
		db = new DB({ location: ":memory:" })
		db.exec(`
      CREATE TABLE executions (
        id INTEGER PRIMARY KEY,
        createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
        updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
        actionType TEXT NOT NULL,
        triggeredBy TEXT NOT NULL,
        data TEXT NOT NULL,
        loggedAlertId INTEGER,
        status TEXT DEFAULT 'pending'
      );

      INSERT INTO executions (actionType, triggeredBy, data, status) VALUES
      ('EMAIL', 'system', '{"actionType":"EMAIL","triggeredBy":"system","status":"completed","details":{"message":"Test 1"}}', 'completed'),
      ('SMS', 'user123', '{"actionType":"SMS","triggeredBy":"user123","status":"pending","details":{"message":"Test 2"}}', 'pending'),
      ('EMAIL', 'system', '{"actionType":"EMAIL","triggeredBy":"system","status":"completed","details":{"message":"Test 3"}}', 'completed');
    `)
	})

	afterEach(() => {
		db.close()
	})

	test("composes filtered query with json columns", () => {
		const baseSelect = db.sql`
      SELECT ${{ columns: ["id", "actionType", "data<-json", "status"] }}
      FROM executions
    `
		const whereClause = db.sql`WHERE status = ${"$status"}`
		const query = db.sql`${baseSelect} ${whereClause}`

		const results = query.all({ status: "completed" })
		assert.equal(results.length, 2)
		assert.equal(results[0].data.status, "completed")
	})

	test("composes query with filter and sort", () => {
		const baseSelect = db.sql`
      SELECT ${{ columns: ["id", "actionType", "data<-json"] }}
      FROM executions
    `
		const whereClause = db.sql`WHERE actionType = ${"$type"}`
		const orderClause = db.sql`ORDER BY ${raw`createdAt`} DESC`
		const query = db.sql`${baseSelect} ${whereClause} ${orderClause}`

		const results = query.all({ type: "EMAIL" })
		assert.equal(results.length, 2)
		assert.equal(results[0].actionType, "EMAIL")
	})

	test("composes query with pagination", () => {
		const baseSelect = db.sql`
      SELECT ${{ columns: ["id", "actionType"] }}
      FROM executions
    `
		const limitClause = db.sql`${{ limit: 1, offset: 1 }}`
		const query = db.sql`${baseSelect} ${limitClause}`

		const results = query.all()
		assert.equal(results.length, 1)
	})

	test("composes complex query with multiple conditions", () => {
		const baseSelect = db.sql`
      SELECT ${{ columns: ["id", "actionType", "data<-json"] }}
      FROM executions
    `
		const whereClause = db.sql`
      WHERE actionType = ${"$type"}
      AND status = ${"$status"}
    `
		const orderAndLimit = db.sql`
      ORDER BY ${raw`createdAt`} DESC
      ${{ limit: 1 }}
    `
		const query = db.sql`${baseSelect} ${whereClause} ${orderAndLimit}`

		const results = query.all({ type: "EMAIL", status: "completed" })
		assert.equal(results.length, 1)
		assert.equal(results[0].actionType, "EMAIL")
		assert.equal(results[0].data.status, "completed")
	})

	test("composes mutation query", () => {
		const updateStmt = db.sql`UPDATE executions`
		const setClause = db.sql`
      SET status = ${"$newStatus"},
          data = ${"$data->json"}
    `
		const whereClause = db.sql`WHERE id = ${"$id"}`
		const query = db.sql`${updateStmt} ${setClause} ${whereClause}`

		const result = query.run({
			id: 1,
			newStatus: "failed",
			data: {
				actionType: "EMAIL",
				triggeredBy: "system",
				status: "failed",
				details: { message: "Updated" },
			},
		})
		assert.equal(result.changes, 1)
	})
})
