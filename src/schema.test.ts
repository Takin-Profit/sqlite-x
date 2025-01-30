// Copyright 2025 Takin Profit. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

// columns.test.ts
import { test, describe, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { validateSchema, type Schema, buildSchema } from "./schema"
import { NodeSqliteError } from "#errors"
import { DB } from "#database"

interface TestUser {
	id: number
	name?: string
	active: boolean
	metadata: { tags: string[] }
}

// Updated test file
describe("Column Validation", () => {
	test("validates simple column definitions", () => {
		const columns = {
			id: "INTEGER PRIMARY KEY",
			name: "TEXT",
			active: "INTEGER",
			metadata: "BLOB",
		}
		const errors = validateSchema<TestUser>(columns)
		assert.equal(errors.length, 0)
	})

	test("validates columns with constraints", () => {
		const columns = {
			id: "INTEGER PRIMARY KEY AUTOINCREMENT",
			name: "TEXT NOT NULL UNIQUE",
			status: "INTEGER DEFAULT 1",
		}
		const errors = validateSchema<TestUser>(columns)
		assert.equal(errors.length, 0)
	})

	test("rejects invalid types", () => {
		const columns = {
			id: "INVALID",
			name: "STRING",
		}
		const errors = validateSchema<TestUser>(columns)
		assert.equal(errors.length, 2)
	})

	test("requires valid SQLite type", () => {
		const columns = {
			id: "PRIMARY KEY",
			name: "NOT NULL",
		}
		const errors = validateSchema<TestUser>(columns)
		assert.equal(errors.length, 2)
	})
})

test("buildColumnsStatement generates correct SQL DDL", () => {
	interface TestTable {
		id: number
		name: string
		active: boolean
		metadata: object
	}

	const columns: Schema<TestTable> = {
		id: "INTEGER PRIMARY KEY AUTOINCREMENT",
		name: "TEXT NOT NULL",
		active: "INTEGER DEFAULT 1",
		metadata: "BLOB",
	}

	const sql = buildSchema(columns)
	assert.equal(
		sql,
		"(\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  name TEXT NOT NULL,\n  active INTEGER DEFAULT 1,\n  metadata BLOB\n)"
	)
})

test("buildColumnsStatement handles complex constraints", () => {
	interface ComplexTable {
		id: number
		ref: number
		code: string
	}

	const columns: Schema<ComplexTable> = {
		id: "INTEGER PRIMARY KEY CHECK (id > 0) NOT NULL",
		ref: "INTEGER FOREIGN KEY REFERENCES users (id)",
		code: "TEXT UNIQUE DEFAULT 'none'",
	}

	const sql = buildSchema(columns)
	assert.equal(
		sql,
		"(\n  id INTEGER PRIMARY KEY CHECK (id > 0) NOT NULL,\n  ref INTEGER FOREIGN KEY REFERENCES users (id),\n  code TEXT UNIQUE DEFAULT 'none'\n)"
	)
})

test("buildColumnsStatement throws on invalid definitions", () => {
	const invalidColumns = {
		id: "INTEGER INVALID",
		name: 123,
	}

	assert.throws(
		// biome-ignore lint/suspicious/noExplicitAny: <explanation>
		() => buildSchema(invalidColumns as any),
		NodeSqliteError
	)
})

describe("Columns Context SQL Generation", () => {
	let db: DB

	beforeEach(() => {
		db = new DB({
			location: ":memory:",
			environment: "testing",
		})
	})

	afterEach(() => {
		db.close()
	})
	test("generates CREATE TABLE with column definitions", () => {
		interface TestTable {
			id: number
			name: string
			active: boolean
			data: object
		}

		const stmt = db.sql<TestTable>`
      CREATE TABLE test_table ${{
				schema: {
					id: "INTEGER PRIMARY KEY AUTOINCREMENT",
					name: "TEXT NOT NULL",
					active: "INTEGER DEFAULT 1",
					data: "BLOB",
				},
			}};
    `

		assert.equal(
			stmt.sourceSQL({} as TestTable).trim(),
			"CREATE TABLE test_table (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  name TEXT NOT NULL,\n  active INTEGER DEFAULT 1,\n  data BLOB\n);"
		)
	})

	test("validates CREATE TABLE with VALUES", () => {
		interface TestTable {
			id: number
			name: string
		}

		const stmt = db.sql<TestTable>`
      CREATE TABLE test_table (
        id INTEGER PRIMARY KEY,
        name TEXT
      );
      INSERT INTO test_table ${{ values: ["$id", "$name"] }}
    `

		assert.equal(
			stmt.sourceSQL({ id: 1, name: "test" }).trim(),
			"CREATE TABLE test_table (\n  id INTEGER PRIMARY KEY,\n  name TEXT\n);"
		)
	})
})
