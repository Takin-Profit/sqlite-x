// Copyright 2025 Takin Profit. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

import type { InsertOrSetOptions } from "#context.js"
import { NodeSqliteError, SqlitePrimaryResultCode } from "#errors.js"

type BuildValuesResult = {
	sql: string
	hasJsonColumns: boolean
}

export function buildValuesStatement<P extends { [key: string]: unknown }>(
	values: InsertOrSetOptions<P>,
	params: P
): BuildValuesResult {
	const isValueType = (value: unknown): value is string => {
		return typeof value === "string"
	}

	if (values === "*") {
		const columns = Object.keys(params)
		return {
			sql: `(${columns.join(", ")}) VALUES (${columns.map((k) => `$${k}`).join(", ")})`,
			hasJsonColumns: false,
		}
	}

	if (Array.isArray(values) && values[0] === "*" && values.length === 2) {
		if (
			!values[1] ||
			typeof values[1] !== "object" ||
			!("jsonColumns" in values[1])
		) {
			throw new NodeSqliteError(
				"ERR_SQLITE_PARAM",
				SqlitePrimaryResultCode.SQLITE_ERROR,
				"Invalid JSON columns configuration",
				"Second element must be an object with jsonColumns array",
				undefined
			)
		}

		const jsonColumns = new Set(
			(values[1] as { jsonColumns: string[] }).jsonColumns
		)
		const columns = Object.keys(params)
		const existingJsonColumns = [...jsonColumns].filter((col) =>
			columns.includes(col)
		)
		const placeholders = columns.map((col) =>
			jsonColumns.has(col) ? `jsonb($${col})` : `$${col}`
		)

		return {
			sql: `(${columns.join(", ")}) VALUES (${placeholders.join(", ")})`,
			hasJsonColumns: existingJsonColumns.length > 0,
		}
	}

	if (Array.isArray(values)) {
		const columns: string[] = []
		const placeholders: string[] = []
		let hasJson = false

		for (const op of values) {
			if (!isValueType(op)) {
				throw new NodeSqliteError(
					"ERR_SQLITE_PARAM",
					SqlitePrimaryResultCode.SQLITE_ERROR,
					"Invalid parameter format",
					`Parameter must be a string but got ${typeof op}`,
					undefined
				)
			}

			const match = op.match(/^\$([^->]+)(->json)?$/)
			if (!match) {
				throw new NodeSqliteError(
					"ERR_SQLITE_PARAM",
					SqlitePrimaryResultCode.SQLITE_ERROR,
					"Invalid parameter format",
					`Parameter "${op}" must be in format $column or $column->json`,
					undefined
				)
			}

			const column = match[1]
			columns.push(column)
			if (op.endsWith("->json")) {
				placeholders.push(`jsonb($${column})`)
				hasJson = true
			} else {
				placeholders.push(`$${column}`)
			}
		}

		return {
			sql: `(${columns.join(", ")}) VALUES (${placeholders.join(", ")})`,
			hasJsonColumns: hasJson,
		}
	}

	throw new NodeSqliteError(
		"ERR_SQLITE_PARAM",
		SqlitePrimaryResultCode.SQLITE_ERROR,
		"Invalid values format",
		"Values must be '*', an array of parameters, or a ValuesWithJsonColumns tuple",
		undefined
	)
}
