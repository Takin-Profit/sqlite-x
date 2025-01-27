// Copyright 2025 Takin Profit. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

import { test, describe, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { DB } from "#database"
import { NodeSqliteError } from "#errors"
import {
	validateIndexDef,
	buildIndexStatement,
	createIndexName,
	type IndexDef,
} from "./idx"

interface TestTable {
	id: number
	name: string
	email: string
	age: number
	created_at: string
	metadata: object
}

describe("Index Creation and Validation", () => {
	let db: DB

	beforeEach(() => {
		db = new DB({ location: ":memory:" })
		db.exec(`CREATE TABLE test_table (
        id INTEGER PRIMARY KEY,
        name TEXT,
        email TEXT,
        age INTEGER,
        created_at TEXT,
        metadata TEXT
      )
    `)

		db.exec(`CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        name TEXT,
        email TEXT,
        age INTEGER
      )`)
	})

	afterEach(() => {
		db.close()
	})

	describe("validateIndexDef", () => {
		test("validates simple index definition", () => {
			const def: IndexDef<TestTable> = {
				name: "idx_test_name",
				tableName: "test_table",
				columns: ["name"],
			}
			const errors = validateIndexDef(def)
			assert.equal(errors.length, 0)
		})

		test("validates complex index definition", () => {
			const def: IndexDef<TestTable> = {
				name: "idx_test_composite",
				tableName: "test_table",
				columns: ["name ASC", "age DESC COLLATE NOCASE"],
				where: "WHERE age > 18",
				options: { unique: true, ifNotExists: true },
			}
			const errors = validateIndexDef(def)
			assert.equal(errors.length, 0)
		})

		test("rejects invalid index name", () => {
			const def: IndexDef<TestTable> = {
				// biome-ignore lint/suspicious/noExplicitAny: <explanation>
				name: "invalid_name" as any,
				tableName: "test_table",
				columns: ["name"],
			}
			const errors = validateIndexDef(def)
			assert.equal(errors.length, 1)
			assert.ok(
				errors[0].message.includes("must end with '_idx' or start with 'idx_'")
			)
		})

		test("rejects missing table name", () => {
			const def: IndexDef<TestTable> = {
				name: "idx_test",
				tableName: "",
				columns: ["name"],
			}
			const errors = validateIndexDef(def)
			assert.equal(errors.length, 1)
			assert.ok(errors[0].message.includes("Table name is required"))
		})

		test("rejects empty columns array", () => {
			const def: IndexDef<TestTable> = {
				name: "idx_test",
				tableName: "test_table",
				columns: [],
			}
			const errors = validateIndexDef(def)
			assert.equal(errors.length, 1)
			assert.ok(errors[0].message.includes("must have at least one column"))
		})

		test("validates expression index", () => {
			const def: IndexDef<TestTable> = {
				name: "idx_test_expr",
				tableName: "test_table",
				columns: ["name(LOWER(name))"],
			}
			const errors = validateIndexDef(def)
			assert.equal(errors.length, 0)
		})

		test("validates index with WHERE clause", () => {
			const def: IndexDef<TestTable> = {
				name: "idx_test_partial",
				tableName: "test_table",
				columns: ["email"],
				where: "WHERE email IS NOT NULL",
			}
			const errors = validateIndexDef(def)
			assert.equal(errors.length, 0)
		})

		test("rejects invalid WHERE clause", () => {
			const def: IndexDef<TestTable> = {
				name: "idx_test",
				tableName: "test_table",
				columns: ["name"],
				// biome-ignore lint/suspicious/noExplicitAny: <explanation>
				where: "INVALID WHERE" as any,
			}
			const errors = validateIndexDef(def)
			assert.equal(errors.length, 1)
			assert.ok(errors[0].message.includes("must start with 'WHERE'"))
		})
	})

	describe("buildIndexStatement", () => {
		test("builds basic index", () => {
			const def: IndexDef<TestTable> = {
				name: "idx_test_basic",
				tableName: "test_table",
				columns: ["name"],
			}
			const sql = buildIndexStatement(def)
			assert.equal(sql, "CREATE INDEX idx_test_basic ON test_table (name)")
		})

		test("builds unique index", () => {
			const def: IndexDef<TestTable> = {
				name: "idx_test_unique",
				tableName: "test_table",
				columns: ["email"],
				options: { unique: true },
			}
			const sql = buildIndexStatement(def)
			assert.equal(
				sql,
				"CREATE UNIQUE INDEX idx_test_unique ON test_table (email)"
			)
		})

		test("builds IF NOT EXISTS index", () => {
			const def: IndexDef<TestTable> = {
				name: "idx_test_if_not_exists",
				tableName: "test_table",
				columns: ["name"],
				options: { ifNotExists: true },
			}
			const sql = buildIndexStatement(def)
			assert.equal(
				sql,
				"CREATE INDEX IF NOT EXISTS idx_test_if_not_exists ON test_table (name)"
			)
		})

		test("builds composite index with sort orders", () => {
			const def: IndexDef<TestTable> = {
				name: "idx_test_composite",
				tableName: "test_table",
				columns: ["name ASC", "age DESC"],
			}
			const sql = buildIndexStatement(def)
			assert.equal(
				sql,
				"CREATE INDEX idx_test_composite ON test_table (name ASC, age DESC)"
			)
		})

		test("builds index with collation", () => {
			const def: IndexDef<TestTable> = {
				name: "idx_test_collate",
				tableName: "test_table",
				columns: ["name COLLATE NOCASE"],
			}
			const sql = buildIndexStatement(def)
			assert.equal(
				sql,
				"CREATE INDEX idx_test_collate ON test_table (name COLLATE NOCASE)"
			)
		})

		test("builds partial index", () => {
			const def: IndexDef<TestTable> = {
				name: "idx_test_partial",
				tableName: "test_table",
				columns: ["age"],
				where: "WHERE age >= 18",
			}
			const sql = buildIndexStatement(def)
			assert.equal(
				sql,
				"CREATE INDEX idx_test_partial ON test_table (age)\n  WHERE age >= 18"
			)
		})

		test("builds expression index", () => {
			const def: IndexDef<TestTable> = {
				name: "idx_test_expr",
				tableName: "test_table",
				columns: ["name(LOWER(name))"],
			}
			const sql = buildIndexStatement(def)
			assert.equal(
				sql,
				"CREATE INDEX idx_test_expr ON test_table (LOWER(name))"
			)
		})

		test("builds complex index with all options", () => {
			const def: IndexDef<TestTable> = {
				name: "idx_test_complex",
				tableName: "test_table",
				columns: ["email COLLATE NOCASE", "created_at DESC", "age"],
				where: "WHERE email IS NOT NULL",
				options: {
					unique: true,
					ifNotExists: true,
				},
			}
			const sql = buildIndexStatement(def)
			assert.equal(
				sql,
				"CREATE UNIQUE INDEX IF NOT EXISTS idx_test_complex ON test_table (email COLLATE NOCASE, created_at DESC, age)\n  WHERE email IS NOT NULL"
			)
		})

		test("throws on invalid index definition", () => {
			const def: IndexDef<TestTable> = {
				// biome-ignore lint/suspicious/noExplicitAny: <explanation>
				name: "invalid_name" as any,
				tableName: "test_table",
				columns: [],
			}
			assert.throws(
				() => buildIndexStatement(def),
				(err: unknown) => {
					assert(err instanceof NodeSqliteError)
					assert.equal(err.code, "ERR_SQLITE_INDEX")
					return true
				}
			)
		})
	})

	describe("createIndexName", () => {
		test("creates valid index name", () => {
			const name = createIndexName("users", "email", "name")
			assert.equal(name, "idx_users_email_name")
		})

		test("creates valid index name with single column", () => {
			const name = createIndexName("users", "id")
			assert.equal(name, "idx_users_id")
		})
	})
})
interface TestTable {
	id: number
	name: string
	email: string
	age: number
	city: string
	state: string
	country: string
	created_at: string
	metadata: object
}

describe("Database Index Creation (createIndex method)", () => {
	let db: DB

	beforeEach(() => {
		db = new DB({ location: ":memory:" })
		db.exec(`
            CREATE TABLE test_table (
                id INTEGER PRIMARY KEY,
                name TEXT,
                email TEXT UNIQUE,
                age INTEGER,
                city TEXT,
                state TEXT,
                country TEXT,
                created_at TEXT,
                metadata TEXT
            )
        `)
	})

	afterEach(() => {
		db.close()
	})

	// Helper function to check if an index exists
	function indexExists(db: DB, indexName: string): boolean {
		const result = db.sql<{ name: string }>`
            SELECT name FROM sqlite_master WHERE type='index' AND name=${"$name"}
        `.get({ name: indexName })
		return !!result
	}

	test("creates a simple index", () => {
		const indexDef: IndexDef<TestTable> = {
			name: "idx_test_table_name",
			tableName: "test_table",
			columns: ["name"],
		}

		db.createIndex(indexDef)
		assert.ok(indexExists(db, "idx_test_table_name"))
	})

	test("creates a unique index", () => {
		const indexDef: IndexDef<TestTable> = {
			name: "idx_test_table_email",
			tableName: "test_table",
			columns: ["email"],
			options: { unique: true },
		}

		db.createIndex(indexDef)
		assert.ok(indexExists(db, "idx_test_table_email"))
	})

	test("creates an index with ifNotExists option", () => {
		const indexDef: IndexDef<TestTable> = {
			name: "idx_test_table_age",
			tableName: "test_table",
			columns: ["age"],
			options: { ifNotExists: true },
		}

		db.createIndex(indexDef)
		assert.ok(indexExists(db, "idx_test_table_age"))

		// Try creating again - should not throw an error
		db.createIndex(indexDef)
		assert.ok(indexExists(db, "idx_test_table_age"))
	})

	test("creates a composite index", () => {
		const indexDef: IndexDef<TestTable> = {
			name: "idx_test_table_city_state",
			tableName: "test_table",
			columns: ["city", "state"],
		}

		db.createIndex(indexDef)
		assert.ok(indexExists(db, "idx_test_table_city_state"))
	})

	test("creates an index with ordering", () => {
		const indexDef: IndexDef<TestTable> = {
			name: "idx_test_table_name_age",
			tableName: "test_table",
			columns: ["name ASC", "age DESC"],
		}

		db.createIndex(indexDef)
		assert.ok(indexExists(db, "idx_test_table_name_age"))
	})

	test("creates an index with a WHERE clause", () => {
		const indexDef: IndexDef<TestTable> = {
			name: "idx_test_table_age",
			tableName: "test_table",
			columns: ["age"],
			where: "WHERE age > 18",
		}

		db.createIndex(indexDef)
		assert.ok(indexExists(db, "idx_test_table_age"))
	})

	test("creates an index with COLLATE option", () => {
		const indexDef: IndexDef<TestTable> = {
			name: "idx_test_table_name_collate",
			tableName: "test_table",
			columns: ["name COLLATE NOCASE"],
		}

		db.createIndex(indexDef)
		assert.ok(indexExists(db, "idx_test_table_name_collate"))
	})
	test("creates an index with an expression", () => {
		const indexDef: IndexDef<TestTable> = {
			name: "idx_test_table_name_lower",
			tableName: "test_table",
			columns: ["name(LOWER(name))"],
		}

		db.createIndex(indexDef)
		assert.ok(indexExists(db, "idx_test_table_name_lower"))
	})

	test("throws an error on invalid index definition", () => {
		const invalidIndexDef = {
			name: "invalid_index", // Invalid name
			tableName: "test_table",
			columns: [], // Empty columns
		}
		assert.throws(
			// biome-ignore lint/suspicious/noExplicitAny: <explanation>
			() => db.createIndex(invalidIndexDef as any),
			(err: unknown) => {
				assert(err instanceof NodeSqliteError)
				assert.equal(err.code, "ERR_SQLITE_INDEX")
				return true
			}
		)
	})
	test("throws an error on duplicate index name", () => {
		const indexDef: IndexDef<TestTable> = {
			name: "idx_test_table_name",
			tableName: "test_table",
			columns: ["name"],
		}

		db.createIndex(indexDef)
		assert.ok(indexExists(db, "idx_test_table_name"))

		// Try creating again - should throw an error
		assert.throws(
			() => db.createIndex(indexDef),
			(err: unknown) => {
				assert(err instanceof Error)
				assert.equal(err.message, "index idx_test_table_name already exists")
				return true
			}
		)
	})
})
