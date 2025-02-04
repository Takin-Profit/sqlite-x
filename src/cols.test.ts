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
		const sql = buildColsStatement<TestUser>(["id", "metadata<-json"])
		assert.equal(sql, "id, json_extract(metadata, '$') as metadata")
	})

	test("handles JSON insertion", () => {
		const sql = buildColsStatement<TestUser>(["id", "settings->json"])
		assert.equal(sql, "id, jsonb(settings)")
	})

	test("handles mixed JSON operations", () => {
		const sql = buildColsStatement<TestUser>([
			"id",
			"metadata<-json",
			"settings->json",
			"active",
		])
		assert.equal(
			sql,
			"id, json_extract(metadata, '$') as metadata, jsonb(settings), active"
		)
	})

	test("removes duplicate columns while preserving order", () => {
		const sql = buildColsStatement<TestUser>([
			"id",
			"name",
			"id",
			"metadata<-json",
			"name",
			"metadata<-json",
		])
		assert.equal(sql, "id, name, json_extract(metadata, '$') as metadata")
	})

	test("throws on invalid input", () => {
		assert.throws(
			// biome-ignore lint/suspicious/noExplicitAny: <explanation>
			() => buildColsStatement<TestUser>({} as any),
			{
				name: "NodeSqliteError",
				message: /Columns must be '\*' or an array of columns/,
			}
		)
	})
})

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
	stats: {
		views: number
		likes: number[]
	}
	active: boolean
}

describe("buildColsStatement complex scenarios", () => {
	test("handles complex JSON fields", () => {
		const sql = buildColsStatement<ComplexTable>([
			"id",
			"name",
			"metadata->json",
			"settings<-json",
			"stats->json",
			"active",
		])
		assert.equal(
			sql,
			"id, name, jsonb(metadata), json_extract(settings, '$') as settings, jsonb(stats), active"
		)
	})

	test("handles multiple JSON extractions", () => {
		const sql = buildColsStatement<ComplexTable>([
			"metadata<-json",
			"settings<-json",
			"stats<-json",
		])
		assert.equal(
			sql,
			"json_extract(metadata, '$') as metadata, json_extract(settings, '$') as settings, json_extract(stats, '$') as stats"
		)
	})

	test("handles multiple JSON insertions", () => {
		const sql = buildColsStatement<ComplexTable>([
			"metadata->json",
			"settings->json",
			"stats->json",
		])
		assert.equal(sql, "jsonb(metadata), jsonb(settings), jsonb(stats)")
	})
})
