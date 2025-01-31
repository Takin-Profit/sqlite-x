// Copyright 2025 Takin Profit. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

import { validateSetOptions, type SetOptions } from "#context"
import { NodeSqliteError, SqlitePrimaryResultCode } from "#errors.js"
import { isRawValue, type DataRow } from "#types"

// In values.ts
export function buildSetStatement<P extends DataRow>(
	set: SetOptions<P>,
	params: P
): { sql: string; parameterOperators: string[] } {
	// Validate the set options first
	const errors = validateSetOptions(set)
	if (errors.length > 0) {
		throw new NodeSqliteError(
			"ERR_SQLITE_PARAM",
			SqlitePrimaryResultCode.SQLITE_ERROR,
			"Invalid SET options",
			errors.map(e => e.message).join("\n"),
			undefined
		)
	}

	// Handle star format
	if (set === "*") {
		const columns = Object.keys(params)
		const paramOps = columns.map(k => `$${k}`)
		return {
			sql: `SET ${columns.map((col, i) => `${col} = ${paramOps[i]}`).join(", ")}`,
			parameterOperators: paramOps,
		}
	}

	// Handle array format with jsonColumns
	if (Array.isArray(set)) {
		const [, config] = set
		const jsonColumns = new Set(config.jsonColumns)
		const columns = Object.keys(params)
		const paramOps = columns.map(k => `$${k}`)

		const setPairs = columns.map((col, i) => {
			if (jsonColumns.has(col)) {
				return `${col} = jsonb(${paramOps[i]})`
			}
			return `${col} = ${paramOps[i]}`
		})

		return {
			sql: `SET ${setPairs.join(", ")}`,
			parameterOperators: paramOps,
		}
	}

	// Handle object format
	const entries = Object.entries(set)
	const paramOps: string[] = []
	const setPairs: string[] = []

	for (const [col, value] of entries) {
		if (isRawValue(value)) {
			setPairs.push(`${col} = ${value.value}`)
			continue
		}

		if (typeof value === "string") {
			// Must be a ValueType (ParameterOperator or ToJson) at this point
			// since validation passed
			if (value.endsWith("->json")) {
				// Handle ToJson case
				const paramName = value.slice(1, -6)
				paramOps.push(`$${paramName}`)
				setPairs.push(`${col} = jsonb($${paramName})`)
			} else {
				// Handle ParameterOperator case
				const paramName = value.slice(1)
				paramOps.push(`$${paramName}`)
				setPairs.push(`${col} = $${paramName}`)
			}
		}
		// No else needed - validation would have caught invalid types
	}

	return {
		sql: `SET ${setPairs.join(", ")}`,
		parameterOperators: paramOps,
	}
}
