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
