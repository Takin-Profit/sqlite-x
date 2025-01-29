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

			const result = buildValuesStatement("*", params)
			assert.equal(result.sql, "(name, age, email) VALUES ($name,$age,$email)")
		})

		test("handles empty params object", () => {
			const params = {}
			const result = buildValuesStatement("*", params)
			assert.equal(result.sql, "() VALUES ()")
		})
	})

	describe("with JSON columns configuration", () => {
		test("builds SQL with specified JSON columns", () => {
			const params = {
				id: 1,
				name: "John",
				metadata: { key: "value" },
			}

			const result = buildValuesStatement(
				["*", { jsonColumns: ["metadata"] }],
				params
			)

			assert.equal(
				result.sql,
				"(id, name, metadata) VALUES ($id,$name,jsonb($metadata))"
			)
		})

		test("handles multiple JSON columns", () => {
			const params = {
				id: 1,
				profile: { age: 30 },
				settings: { theme: "dark" },
			}

			const result = buildValuesStatement(
				["*", { jsonColumns: ["profile", "settings"] }],
				params
			)

			assert.equal(
				result.sql,
				"(id, profile, settings) VALUES ($id,jsonb($profile),jsonb($settings))"
			)
		})

		test("ignores non-existent JSON columns", () => {
			const params = {
				id: 1,
				name: "John",
			}

			const result = buildValuesStatement(
				["*", { jsonColumns: ["metadata" as keyof typeof params] }],
				params
			)

			assert.equal(result.sql, "(id, name) VALUES ($id,$name)")
		})
	})

	describe("with explicit column array", () => {
		test("builds SQL with specified columns", () => {
			const params = {
				name: "John",
				age: 30,
				email: "john@example.com",
			}

			const result = buildValuesStatement(["$name", "$age"], params)

			assert.equal(result.sql, "(name, age) VALUES ($name,$age)")
		})

		test("handles JSON columns with toJson suffix", () => {
			const params = {
				id: 1,
				metadata: { key: "value" },
				settings: { theme: "dark" },
			}

			const result = buildValuesStatement(
				["$id", "$metadata->json", "$settings->json"],
				params
			)

			assert.equal(
				result.sql,
				"(id, metadata, settings) VALUES ($id,jsonb($metadata),jsonb($settings))"
			)
		})

		test("handles mix of regular and JSON columns", () => {
			const params = {
				id: 1,
				name: "John",
				metadata: { key: "value" },
			}

			const result = buildValuesStatement(
				["$id", "$name", "$metadata->json"],
				params
			)

			assert.equal(
				result.sql,
				"(id, name, metadata) VALUES ($id,$name,jsonb($metadata))"
			)
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

			const result = buildValuesStatement("*", params)
			assert.equal(
				result.sql,
				"(user-name, email_address) VALUES ($user-name,$email_address)"
			)
		})

		test("preserves column order from explicit array", () => {
			const params = {
				c: 3,
				a: 1,
				b: 2,
			}

			const result = buildValuesStatement(["$c", "$a", "$b"], params)

			assert.equal(result.sql, "(c, a, b) VALUES ($c,$a,$b)")
		})

		test("handles single column case", () => {
			const params = { id: 1 }

			const result = buildValuesStatement(["$id"], params)
			assert.equal(result.sql, "(id) VALUES ($id)")
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

describe("batch Values Generation", () => {
	let db: DB

	beforeEach(() => {
		db = new DB({
			location: ":memory:",
			environment: "testing",
		})
		db.exec(`
      CREATE TABLE bands (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        formed_year INTEGER,
        members INTEGER,
        metadata TEXT
      );
    `)
	})

	afterEach(() => {
		db.close()
	})

	test("generates correct SQL for basic array of values", () => {
		type Band = {
			name: string
			formed_year: number
			members: number
		}

		const stmt = db.sql<Band>`
      INSERT INTO bands ${{ values: ["*", { batch: true }] }}
    `

		const bands = [
			{ name: "INDIAN OCEAN", formed_year: 1990, members: 5 },
			{ name: "BTS", formed_year: 2013, members: 7 },
			{ name: "METALLICA", formed_year: 1981, members: 4 },
		]

		assert.equal(
			stmt.sourceSQL(bands).trim(),
			"INSERT INTO bands (name, formed_year, members)\nVALUES ($name_0, $formed_year_0, $members_0),\n  ($name_1, $formed_year_1, $members_1),\n  ($name_2, $formed_year_2, $members_2)"
		)
	})

	test("handles empty array", () => {
		type Band = {
			name: string
			formed_year: number
		}

		const stmt = db.sql<Band>`
      INSERT INTO bands ${{ values: ["*", { batch: true }] }}
    `

		assert.throws(
			() => stmt.sourceSQL([]),
			(err: unknown) => {
				assert(err instanceof NodeSqliteError)
				assert(err.message.includes("Cannot insert empty array"))
				return true
			}
		)
	})

	test("handles Set input", () => {
		type Band = {
			name: string
			members: number
		}

		const stmt = db.sql<Band>`
      INSERT INTO bands ${{ values: ["*", { batch: true }] }}
    `

		const bandsSet = new Set([
			{ name: "PINK FLOYD", members: 5 },
			{ name: "LED ZEPPELIN", members: 4 },
		])

		assert.equal(
			stmt.sourceSQL(bandsSet).trim(),
			"INSERT INTO bands (name, members)\nVALUES ($name_0, $members_0),\n  ($name_1, $members_1)" // Fixed parameter names
		)
	})

	test("combines batch with JSON columns", () => {
		type Band = {
			name: string
			members: number
			metadata: {
				genre: string[]
				albums: number
				active: boolean
			}
		}

		const stmt = db.sql<Band>`
      INSERT INTO bands ${{ values: ["*", { batch: true, jsonColumns: ["metadata"] }] }}
    `

		const bands = [
			{
				name: "QUEEN",
				members: 4,
				metadata: { genre: ["rock"], albums: 15, active: true },
			},
			{
				name: "THE BEATLES",
				members: 4,
				metadata: { genre: ["rock", "pop"], albums: 12, active: false },
			},
		]

		assert.equal(
			stmt.sourceSQL(bands).trim(),
			"INSERT INTO bands (name, members, metadata)\nVALUES ($name_0, $members_0, jsonb($metadata_0)),\n  ($name_1, $members_1, jsonb($metadata_1))"
		)
	})

	test("throws on non-array/non-set input", () => {
		type Band = { name: string }
		const stmt = db.sql<Band>`
        INSERT INTO bands ${{ values: ["*", { batch: true }] }}
    `

		// Ensure we're testing with the correct error type and message
		assert.throws(() => stmt.sourceSQL({ name: "INVALID" }), {
			name: "NodeSqliteError",
			message: /Expected array or Set/,
		})
	})

	test("handles array with single item", () => {
		type Band = {
			name: string
			members: number
		}

		const stmt = db.sql<Band>`
      INSERT INTO bands ${{ values: ["*", { batch: true }] }}
    `

		const bands = [{ name: "SOLO ARTIST", members: 1 }]

		assert.equal(
			stmt.sourceSQL(bands).trim(),
			"INSERT INTO bands (name, members)\nVALUES ($name_0, $members_0)"
		)
	})

	test("ensures consistent column order across all rows", () => {
		type Band = {
			name: string
			formed_year?: number
			members: number
		}

		const stmt = db.sql<Band>`
      INSERT INTO bands ${{ values: ["*", { batch: true }] }}
    `

		const bands = [
			{ name: "BAND1", members: 4, formed_year: 1990 },
			{ name: "BAND2", members: 3 },
			{ name: "BAND3", members: 5, formed_year: 1985 },
		]

		const sql = stmt.sourceSQL(bands)
		const lines = sql.trim().split("\n")

		// Verify column order is consistent
		const columnsLine = lines[0]
		assert(columnsLine.includes("name") && columnsLine.includes("members"))

		// Verify all VALUES lines have same number of parameters
		const valueSets = lines.slice(2)
		const paramCounts = valueSets.map(line => (line.match(/\$/g) || []).length)
		assert(paramCounts.every(count => count === paramCounts[0]))
	})
})

describe("Values Database Operations", () => {
	let db: DB

	beforeEach(() => {
		db = new DB({
			location: ":memory:",
			environment: "testing",
		})

		// Create test tables
		db.exec(`
      CREATE TABLE stocks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ticker TEXT NOT NULL UNIQUE,
        description TEXT,
        exchange TEXT CHECK(exchange IN ('AMEX','ARCA','BATS','NYSE','NASDAQ','NYSEARCA','FTXU','CBSE','GNSS','ERSX','OTC','CRYPTO','')),
        hasIcon INTEGER DEFAULT 0
      );
    `)
	})

	afterEach(() => {
		db.close()
	})

	test(":values - inserts single record with values array", () => {
		type Stock = {
			ticker: string
			description: string
			exchange: string
			hasIcon: number
		}

		const stock = {
			ticker: "AAPL",
			description: "Apple Inc.",
			exchange: "NASDAQ",
			hasIcon: 1,
		}

		const stmt = db.sql<Stock>`
      INSERT INTO stocks ${{ values: ["$ticker", "$description", "$exchange", "$hasIcon"] }}
    `

		stmt.run(stock)

		const result =
			db.sql`SELECT * FROM stocks WHERE ticker = ${"$ticker"}`.get<{
				id: number
			}>({ ticker: "AAPL" })
		assert.equal(result?.id, 1)
	})

	test(":values - inserts single record with values:* syntax", () => {
		type Stock = {
			ticker: string
			description: string
			exchange: string
			hasIcon: number
		}

		const stock = {
			ticker: "AAPL",
			description: "Apple Inc.",
			exchange: "NASDAQ",
			hasIcon: 1,
		}

		const stmt = db.sql<Stock>`
      INSERT INTO stocks ${{ values: "*" }}
    `
		stmt.run(stock)

		const result =
			db.sql`SELECT * FROM stocks WHERE ticker = ${"$ticker"}`.get<{
				ticker: string
			}>({ ticker: "AAPL" })
		assert.deepEqual(result?.ticker, "AAPL")
	})

	test(":values - inserts batch of records using values:* and batch:true", () => {
		type Stock = {
			ticker: string
			description: string
			exchange: string
			hasIcon: number
		}

		const stocks = [
			{
				ticker: "AAPL",
				description: "Apple Inc.",
				exchange: "NASDAQ",
				hasIcon: 1,
			},
			{
				ticker: "MSFT",
				description: "Microsoft Corporation",
				exchange: "NASDAQ",
				hasIcon: 1,
			},
			{
				ticker: "GOOGL",
				description: "Alphabet Inc.",
				exchange: "NASDAQ",
				hasIcon: 1,
			},
		]

		const stmt = db.sql<Stock[]>`
      INSERT INTO stocks ${{ values: ["*", { batch: true }] }}
    `
		stmt.run(stocks)

		const results = db.sql`SELECT * FROM stocks ORDER BY ticker`.all<{
			ticker: string
		}>()
		assert.equal(results.length, 3)
		assert.deepEqual(
			results.map(r => r.ticker),
			["AAPL", "GOOGL", "MSFT"]
		)
	})

	test(":values - batch insert properly fails transaction on error", () => {
		type Stock = {
			ticker: string
			description: string
			exchange: string
			hasIcon: number
		}

		const stocks = [
			{
				ticker: "AAPL",
				description: "Apple Inc.",
				exchange: "NASDAQ",
				hasIcon: 1,
			},
			{
				ticker: "AAPL", // Duplicate ticker should cause error
				description: "Apple Inc Again",
				exchange: "NASDAQ",
				hasIcon: 1,
			},
		]

		const stmt = db.sql<Stock[]>`
      INSERT INTO stocks ${{ values: ["*", { batch: true }] }}
    `

		// Should throw due to unique constraint violation
		assert.throws(() => stmt.run(stocks))

		// Query to verify no records were inserted
		const result = db.sql`
        SELECT COUNT(*) as count FROM stocks
    `.get<{ count: number }>()

		// Ensure we have a number even if result is undefined
		const count = result?.count ?? 0
		assert.equal(count, 0)
	})

	test(":values - batch insert handles nulls and optional fields", () => {
		type Stock = {
			ticker: string
			description?: string
			exchange: string
			hasIcon: number
		}

		const stocks = [
			{
				ticker: "AAPL",
				description: "Apple Inc.",
				exchange: "NASDAQ",
				hasIcon: 1,
			},
			{
				ticker: "MSFT",
				exchange: "NASDAQ", // No description
				hasIcon: 1,
			},
		]

		const stmt = db.sql<Stock[]>`
      INSERT INTO stocks ${{ values: ["*", { batch: true }] }}
    `
		stmt.run(stocks)

		const results = db.sql`SELECT * FROM stocks ORDER BY ticker`.all<{
			description: string
		}>()
		assert.equal(results.length, 2)
		assert.equal(results[1].description, null)
	})

	test(":values - batch insert verifies constraints", () => {
		type Stock = {
			ticker: string
			description: string
			exchange: string
			hasIcon: number
		}

		const stocks = [
			{
				ticker: "AAPL",
				description: "Apple Inc.",
				exchange: "INVALID", // Invalid exchange value
				hasIcon: 1,
			},
		]

		const stmt = db.sql<Stock[]>`
      INSERT INTO stocks ${{ values: ["*", { batch: true }] }}
    `

		// Should throw due to check constraint violation
		assert.throws(() => stmt.run(stocks))

		// Query to verify no records were inserted
		const result = db.sql`
        SELECT COUNT(*) as count FROM stocks
    `.get<{ count: number }>()

		// Ensure we have a number even if result is undefined
		const count = result?.count ?? 0
		assert.equal(count, 0)
	})

	test(":values - inserts using values array with explicit ID", () => {
		type Stock = {
			id: number
			ticker: string
			description: string
			exchange: string
			hasIcon: number
		}

		const stock = {
			id: 42,
			ticker: "AAPL",
			description: "Apple Inc.",
			exchange: "NASDAQ",
			hasIcon: 1,
		}

		const stmt = db.sql<Stock>`
      INSERT INTO stocks ${{
				values: ["$id", "$ticker", "$description", "$exchange", "$hasIcon"],
			}}
    `
		stmt.run(stock)

		const result = db.sql`SELECT * FROM stocks WHERE id = ${"$id"}`.get<{
			id: number
		}>({
			id: 42,
		})
		assert.deepEqual(result?.id, 42)
	})
})
