// Copyright 2025 Takin Profit. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

import { test, describe } from "node:test"
import assert from "node:assert/strict"
import { buildColsStatement } from "#context"

interface TestUser {
	id: number
	name: string
	metadata: object
	settings: {
		theme: string
		notifications: boolean
	}
	active: boolean
}

describe("buildColsStatement", () => {
	test("handles '*' selector", () => {
		const sql = buildColsStatement<TestUser>("*")
		assert.equal(sql, "*")
	})

	test("handles basic column selection", () => {
		const sql = buildColsStatement<TestUser>(["id", "name", "active"])
		assert.equal(sql, "id, name, active")
	})

	test("handles JSON extraction", () => {
		const sql = buildColsStatement<TestUser>([
			"id",
			"metadata<-json",
			// biome-ignore lint/suspicious/noExplicitAny: <explanation>
		] as any)
		assert.equal(sql, "id, json_extract(metadata, '$')")
	})

	test("handles JSON insertion", () => {
		const sql = buildColsStatement<TestUser>([
			"id",
			"settings->json",
			// biome-ignore lint/suspicious/noExplicitAny: <explanation>
		] as any)
		assert.equal(sql, "id, jsonb(settings)")
	})

	test("handles mixed JSON operations", () => {
		const sql = buildColsStatement<TestUser>([
			"id",
			"metadata<-json",
			"settings->json",
			"active",
			// biome-ignore lint/suspicious/noExplicitAny: <explanation>
		] as any)
		assert.equal(
			sql,
			"id, json_extract(metadata, '$'), jsonb(settings), active"
		)
	})
})

describe("buildColsStatement with new format", () => {
	interface TestTable {
		id: number
		name: string
		settings: { theme: string }
		metadata: { tags: string[] }
		config: object
		active: boolean
	}

	test("handles * with jsonColumns config", () => {
		const sql = buildColsStatement<TestTable>([
			"*",
			{ jsonColumns: ["settings", "metadata", "config"] },
		])
		assert.equal(
			sql,
			"id, name, active, json_extract(settings, '$') as settings, json_extract(metadata, '$') as metadata, json_extract(config, '$') as config"
		)
	})

	test("throws on invalid jsonColumns config", () => {
		assert.throws(
			() =>
				// biome-ignore lint/suspicious/noExplicitAny: <explanation>
				buildColsStatement<TestTable>(["*", { jsonColumns: "invalid" as any }]),
			{
				name: "NodeSqliteError",
				message: /When using '\*' with config, jsonColumns must be an array/,
			}
		)
	})

	test("maintains backwards compatibility with original formats", () => {
		// Test original * format
		assert.equal(buildColsStatement<TestTable>("*"), "*")

		// Test original array format
		assert.equal(
			buildColsStatement<TestTable>(["id", "name", "active"]),
			"id, name, active"
		)

		// Test original JSON notation
		assert.equal(
			// biome-ignore lint/suspicious/noExplicitAny: <explanation>
			buildColsStatement<TestTable>(["id", "settings<-json", "active"] as any),
			"id, json_extract(settings, '$'), active"
		)
	})

	test("handles empty jsonColumns array", () => {
		const sql = buildColsStatement<TestTable>(["*", { jsonColumns: [] }])
		assert.equal(sql, "*")
	})

	test("throws on invalid input format", () => {
		// biome-ignore lint/suspicious/noExplicitAny: <explanation>
		assert.throws(() => buildColsStatement<TestTable>({} as any), {
			name: "NodeSqliteError",
			message:
				/Columns must be '\*', an array of columns, or \['\*', { jsonColumns: \[...\] }\]/,
		})
	})
})

describe("buildColsStatement advanced scenarios", () => {
	interface ComplexTable {
		id: number
		name: string
		metadata: {
			tags: string[]
			owner: {
				id: number
				role: string
			}
		}
		settings: {
			theme: {
				dark: boolean
				colors: {
					primary: string
					secondary: string
				}
			}
			notifications: boolean
		}
		preferences: {
			language: string
			timezone: string
		}
		stats: {
			views: number
			likes: number[]
		}
		active: boolean
	}

	test("handles nested JSON fields with multiple extracts", () => {
		const sql = buildColsStatement<ComplexTable>([
			"*",
			{ jsonColumns: ["metadata", "settings", "preferences", "stats"] },
		])
		assert.equal(
			sql,
			"id, name, active, " +
				"json_extract(metadata, '$') as metadata, " +
				"json_extract(settings, '$') as settings, " +
				"json_extract(preferences, '$') as preferences, " +
				"json_extract(stats, '$') as stats"
		)
	})

	test("handles combination of JSON extracts and regular columns", () => {
		const sql = buildColsStatement<ComplexTable>([
			"id",
			"name",
			"metadata<-json",
			"active",
			"stats<-json",
			// biome-ignore lint/suspicious/noExplicitAny: <explanation>
		] as any)
		assert.equal(
			sql,
			"id, name, json_extract(metadata, '$'), active, json_extract(stats, '$')"
		)
	})

	test("handles single JSON column with * selector", () => {
		const sql = buildColsStatement<ComplexTable>([
			"*",
			{ jsonColumns: ["settings"] },
		])
		assert.equal(
			sql,
			"id, name, active, json_extract(settings, '$') as settings"
		)
	})

	test("preserves column order in jsonColumns array", () => {
		const sql = buildColsStatement<ComplexTable>([
			"*",
			{
				jsonColumns: ["stats", "metadata", "preferences", "settings"],
			},
		])
		assert.equal(
			sql,
			"id, name, active, json_extract(stats, '$') as stats, json_extract(metadata, '$') as metadata, json_extract(preferences, '$') as preferences, json_extract(settings, '$') as settings"
		)
	})

	test("handles mixing different JSON operation styles", () => {
		const sql = buildColsStatement<ComplexTable>([
			"id",
			"metadata->json",
			"name",
			"settings<-json",
			"active",
			// biome-ignore lint/suspicious/noExplicitAny: <explanation>
		] as any)
		assert.equal(
			sql,
			"id, jsonb(metadata), name, json_extract(settings, '$'), active"
		)
	})

	test("silently removes duplicate JSON columns while preserving order", () => {
		const sql = buildColsStatement<ComplexTable>([
			"*",
			{
				jsonColumns: [
					"metadata",
					"metadata",
					"settings",
					"metadata",
					"settings",
					"stats",
				],
			},
		])
		assert.equal(
			sql,
			"id, name, active, " +
				"json_extract(metadata, '$') as metadata, " +
				"json_extract(settings, '$') as settings, " +
				"json_extract(stats, '$') as stats"
		)
	})
})
