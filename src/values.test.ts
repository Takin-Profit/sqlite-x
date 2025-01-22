// Copyright 2025 Takin Profit. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

import { test, describe } from "node:test"
import assert from "node:assert/strict"
import { buildValuesStatement } from "./values.js"
import { NodeSqliteError } from "./errors.js"

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
				["$id", "$metadata.toJson", "$settings.toJson"],
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
				["$id", "$name", "$metadata.toJson"],
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
				() => buildValuesStatement(["$metadata.tojson" as any], params),
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
