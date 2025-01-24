// Copyright 2025 Takin Profit. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

import { test, describe, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { buildValuesStatement } from "./values"
import { NodeSqliteError } from "./errors"
import { DB } from "#database"

describe("buildValuesStatement", () => {
	describe("with '*' values", () => {
		test("builds SQL with all params keys", () => {
			const params = {
				name: "John",
				age: 30,
				email: "john@example.com",
			}

			const { sql, hasJsonColumns } = buildValuesStatement("*", params)
			assert.equal(sql, "(name, age, email) VALUES ($name, $age, $email)")
			assert.equal(hasJsonColumns, false)
		})

		test("handles empty params object", () => {
			const params = {}
			const { sql, hasJsonColumns } = buildValuesStatement("*", params)
			assert.equal(sql, "() VALUES ()")
			assert.equal(hasJsonColumns, false)
		})
	})

	describe("with JSON columns configuration", () => {
		test("builds SQL with specified JSON columns", () => {
			const params = {
				id: 1,
				name: "John",
				metadata: { key: "value" },
			}

			const { sql, hasJsonColumns } = buildValuesStatement(
				["*", { jsonColumns: ["metadata"] }],
				params
			)

			assert.equal(
				sql,
				"(id, name, metadata) VALUES ($id, $name, jsonb($metadata))"
			)
			assert.equal(hasJsonColumns, true)
		})

		test("handles multiple JSON columns", () => {
			const params = {
				id: 1,
				profile: { age: 30 },
				settings: { theme: "dark" },
			}

			const { sql, hasJsonColumns } = buildValuesStatement(
				["*", { jsonColumns: ["profile", "settings"] }],
				params
			)

			assert.equal(
				sql,
				"(id, profile, settings) VALUES ($id, jsonb($profile), jsonb($settings))"
			)
			assert.equal(hasJsonColumns, true)
		})

		test("ignores non-existent JSON columns", () => {
			const params = {
				id: 1,
				name: "John",
			}

			const { sql, hasJsonColumns } = buildValuesStatement(
				["*", { jsonColumns: ["metadata" as keyof typeof params] }],
				params
			)

			assert.equal(sql, "(id, name) VALUES ($id, $name)")
			assert.equal(hasJsonColumns, false)
		})
	})

	describe("with explicit column array", () => {
		test("builds SQL with specified columns", () => {
			const params = {
				name: "John",
				age: 30,
				email: "john@example.com",
			}

			const { sql, hasJsonColumns } = buildValuesStatement(
				["$name", "$age"],
				params
			)

			assert.equal(sql, "(name, age) VALUES ($name, $age)")
			assert.equal(hasJsonColumns, false)
		})

		test("handles JSON columns with toJson suffix", () => {
			const params = {
				id: 1,
				metadata: { key: "value" },
				settings: { theme: "dark" },
			}

			const { sql, hasJsonColumns } = buildValuesStatement(
				["$id", "$metadata->json", "$settings->json"],
				params
			)

			assert.equal(
				sql,
				"(id, metadata, settings) VALUES ($id, jsonb($metadata), jsonb($settings))"
			)
			assert.equal(hasJsonColumns, true)
		})

		test("handles mix of regular and JSON columns", () => {
			const params = {
				id: 1,
				name: "John",
				metadata: { key: "value" },
			}

			const { sql, hasJsonColumns } = buildValuesStatement(
				["$id", "$name", "$metadata->json"],
				params
			)

			assert.equal(
				sql,
				"(id, name, metadata) VALUES ($id, $name, jsonb($metadata))"
			)
			assert.equal(hasJsonColumns, true)
		})
	})

	describe("error handling", () => {
		test("throws on invalid parameter format", () => {
			const params = { name: "John" }

			assert.throws(
				// biome-ignore lint/suspicious/noExplicitAny: <explanation>
				() => buildValuesStatement(["name" as any], params),
				(err: unknown) => {
					assert(err instanceof NodeSqliteError)
					assert(err.message.includes("must be in format"))
					return true
				}
			)
		})

		test("throws on non-string parameter", () => {
			const params = { name: "John" }

			assert.throws(
				// biome-ignore lint/suspicious/noExplicitAny: <explanation>
				() => buildValuesStatement([42 as any], params),
				(err: unknown) => {
					assert(err instanceof NodeSqliteError)
					assert(err.message.includes("must be a string"))
					return true
				}
			)
		})

		test("throws on invalid JSON column configuration", () => {
			const params = { name: "John" }

			assert.throws(
				() =>
					buildValuesStatement(
						// biome-ignore lint/suspicious/noExplicitAny: <explanation>
						["*", { wrongKey: ["metadata"] } as any],
						params
					),
				NodeSqliteError
			)
		})

		test("throws on invalid toJson syntax", () => {
			const params = { metadata: { key: "value" } }

			assert.throws(
				// biome-ignore lint/suspicious/noExplicitAny: <explanation>
				() => buildValuesStatement(["$metadata->jso" as any], params),
				(err: unknown) => {
					assert(err instanceof NodeSqliteError)
					assert(err.message.includes("must be in format"))
					return true
				}
			)
		})
	})

	describe("edge cases", () => {
		test("handles params with special characters in names", () => {
			const params = {
				"user-name": "John",
				email_address: "john@example.com",
			}

			const { sql } = buildValuesStatement("*", params)
			assert.equal(
				sql,
				"(user-name, email_address) VALUES ($user-name, $email_address)"
			)
		})

		test("preserves column order from explicit array", () => {
			const params = {
				c: 3,
				a: 1,
				b: 2,
			}

			const { sql } = buildValuesStatement(["$c", "$a", "$b"], params)

			assert.equal(sql, "(c, a, b) VALUES ($c, $a, $b)")
		})

		test("handles single column case", () => {
			const params = { id: 1 }

			const { sql } = buildValuesStatement(["$id"], params)
			assert.equal(sql, "(id) VALUES ($id)")
		})
	})
})

describe("Values Context SQL Generation", () => {
	let db: DB

	beforeEach(() => {
		db = new DB({
			location: ":memory:",
			environment: "testing",
		})
		db.exec(`
     CREATE TABLE test_data (
       simple_text TEXT,
       data_one TEXT,
       data_two TEXT
     );
   `)
	})

	afterEach(() => {
		db.close()
	})

	test("generates correct SQL for basic values", () => {
		const stmt = db.sql<{
			simple_text: string
			data_one: string
		}>`INSERT INTO test_data ${{ values: ["$simple_text", "$data_one"] }}`

		assert.equal(
			stmt.sourceSQL({ simple_text: "test", data_one: "data" }).trim(),
			"INSERT INTO test_data (simple_text, data_one)\nVALUES ($simple_text, $data_one)"
		)
	})

	test("generates correct SQL for ->json fields", () => {
		type TestData = {
			simple_text: string
			data_one: { value: string }
		}

		const stmt = db.sql<TestData>`INSERT INTO test_data ${{ values: ["$simple_text", "$data_one->json"] }}`

		assert.equal(
			stmt
				.sourceSQL({ simple_text: "test", data_one: { value: "test value" } })
				.trim(),
			"INSERT INTO test_data (simple_text, data_one)\nVALUES ($simple_text, jsonb($data_one))"
		)
	})

	test("generates correct SQL for multiple ->json fields", () => {
		type TestData = {
			simple_text: string
			data_one: { value: string }
			data_two: { count: number }
		}

		const stmt = db.sql<TestData>`INSERT INTO test_data ${{
			values: ["$simple_text", "$data_one->json", "$data_two->json"],
		}}`

		assert.equal(
			stmt
				.sourceSQL({
					simple_text: "test",
					data_one: { value: "test value" },
					data_two: { count: 42 },
				})
				.trim(),
			"INSERT INTO test_data (simple_text, data_one, data_two)\nVALUES ($simple_text, jsonb($data_one), jsonb($data_two))"
		)
	})

	test("generates correct SQL for '*' with jsonColumns", () => {
		type TestData = {
			simple_text: string
			data_one: { value: string }
			data_two: { count: number }
		}

		const stmt = db.sql<TestData>`INSERT INTO test_data ${{
			values: ["*", { jsonColumns: ["data_one", "data_two"] }],
		}}`

		assert.equal(
			stmt
				.sourceSQL({
					simple_text: "test",
					data_one: { value: "test value" },
					data_two: { count: 42 },
				})
				.trim(),
			"INSERT INTO test_data (simple_text, data_one, data_two)\nVALUES ($simple_text, jsonb($data_one), jsonb($data_two))"
		)
	})
})

describe("Values Context SQL Generation", () => {
	let db: DB

	beforeEach(() => {
		db = new DB({
			location: ":memory:",
			environment: "testing",
		})
		db.exec(`
     CREATE TABLE test_data (
		id INTEGER PRIMARY KEY,
       simple_text TEXT,
       data_one TEXT,
       data_two TEXT,
       metadata TEXT,
       settings TEXT,
       config TEXT,
       tags TEXT
     );
   `)
	})

	afterEach(() => {
		db.close()
	})

	test("generates formatted SQL for basic values", () => {
		const stmt = db.sql<{
			simple_text: string
			data_one: string
		}>`INSERT INTO test_data ${{ values: ["$simple_text", "$data_one"] }}`

		assert.equal(
			stmt
				.sourceSQL({
					simple_text: "test",
					data_one: "data",
				})
				.trim(),
			"INSERT INTO test_data (simple_text, data_one)\nVALUES ($simple_text, $data_one)"
		)
	})
	test("generates SQL for complex object with nested JSON", () => {
		type ComplexData = {
			simple_text: string
			metadata: { created: string }
			settings: { theme: string }
			config: { flags: boolean }
			tags: string[]
		}

		const stmt = db.sql<ComplexData>`INSERT INTO test_data ${{
			values: [
				"$simple_text",
				"$metadata->json",
				"$settings->json",
				"$config->json",
				"$tags->json",
			],
		}}`

		assert.equal(
			stmt
				.sourceSQL({
					simple_text: "test",
					metadata: { created: "2025-01-01" },
					settings: { theme: "dark" },
					config: { flags: true },
					tags: ["tag1"],
				})
				.trim(),
			"INSERT INTO test_data (simple_text, metadata, settings, config, tags)\nVALUES (\n    $simple_text,\n    jsonb($metadata),\n    jsonb($settings),\n    jsonb($config),\n    jsonb($tags)\n  )"
		)
	})

	test("generates SQL with all fields as JSON except one", () => {
		type AllJsonData = {
			id: string
			data_one: { [key: string]: unknown }
			data_two: { [key: string]: unknown }
			metadata: { [key: string]: unknown }
			settings: { [key: string]: unknown }
			config: { [key: string]: unknown }
		}

		const stmt = db.sql<AllJsonData>`INSERT INTO test_data ${{
			values: [
				"*",
				{
					jsonColumns: [
						"data_one",
						"data_two",
						"metadata",
						"settings",
						"config",
					],
				},
			],
		}}`

		assert.equal(
			stmt
				.sourceSQL({
					id: "123",
					data_one: { key: "value1" },
					data_two: { key: "value2" },
					metadata: { key: "value3" },
					settings: { key: "value4" },
					config: { key: "value5" },
				})
				.trim(),
			"INSERT INTO test_data (\n    id,\n    data_one,\n    data_two,\n    metadata,\n    settings,\n    config\n  )\nVALUES (\n    $id,\n    jsonb($data_one),\n    jsonb($data_two),\n    jsonb($metadata),\n    jsonb($settings),\n    jsonb($config)\n  )"
		)
	})
})
