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
	// If values is "*", use all keys from params
	if (values === "*") {
		const columns = Object.keys(params)
		return {
			sql: `(${columns.join(", ")}) VALUES (${columns.map((k) => `$${k}`).join(", ")})`,
			hasJsonColumns: false,
		}
	}

	// Handle ValuesWithJsonColumns case
	if (Array.isArray(values) && values[0] === "*" && values.length === 2) {
		const jsonColumns = new Set(
			(values[1] as { jsonColumns: string[] }).jsonColumns
		)
		const columns = Object.keys(params)
		const placeholders = columns.map((col) =>
			jsonColumns.has(col) ? `json($${col})` : `$${col}`
		)

		return {
			sql: `(${columns.join(", ")}) VALUES (${placeholders.join(", ")})`,
			hasJsonColumns: jsonColumns.size > 0,
		}
	}

	// Handle ValueType array case
	if (Array.isArray(values)) {
		const columns: string[] = []
		const placeholders: string[] = []
		let hasJson = false

		for (const op of values) {
			const match = op.match(/^\$([^.]+)(?:\.toJson)?$/)
			if (!match) {
				throw new NodeSqliteError(
					"ERR_SQLITE_PARAM",
					SqlitePrimaryResultCode.SQLITE_ERROR,
					"Invalid parameter format",
					`Parameter "${op}" must be in format $column or $column.toJson`,
					undefined
				)
			}

			const column = match[1]
			columns.push(column)

			if (op.endsWith(".toJson")) {
				placeholders.push(`json($${column})`)
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
