// noinspection t

import { NodeSqliteError, SqlitePrimaryResultCode } from "#errors"
import type { DataRow, InsertOptions } from "#types"

type BuildSqlResult = {
	columns: string[]
	placeholders: string[]
	parameterOperators: string[]
	isMulti?: boolean
	itemCount?: number
}

function buildSqlComponents<P extends DataRow>(
	options: InsertOptions<P>,
	params: P | P[]
): BuildSqlResult {
	// Handle batch operations
	if (Array.isArray(params) || params instanceof Set) {
		const items = Array.from(params)
		if (items.length === 0) {
			throw new NodeSqliteError(
				"ERR_SQLITE_PARAM",
				SqlitePrimaryResultCode.SQLITE_ERROR,
				"Empty data set",
				"Cannot insert empty array or set",
				undefined
			)
		}

		const firstItem = items[0]
		const columns = Object.keys(firstItem)

		// Handle * with batch config
		if (Array.isArray(options) && options[0] === "*" && options.length === 2) {
			const [, config] = options
			const jsonColumns = new Set(
				typeof config === "object" && "jsonColumns" in config
					? config.jsonColumns
					: []
			)

			// Generate unique parameter names and placeholders for each row
			const placeholderRows = items.map((_, rowIndex) => {
				const rowPlaceholders = columns.map(col =>
					jsonColumns.has(col)
						? `jsonb($${col}_${rowIndex})`
						: `$${col}_${rowIndex}`
				)
				return `(${rowPlaceholders.join(", ")})`
			})

			const paramOps = items.flatMap((_, rowIndex) =>
				columns.map(col => `$${col}_${rowIndex}`)
			)

			return {
				columns,
				placeholders: placeholderRows,
				parameterOperators: paramOps,
				isMulti: true,
				itemCount: items.length,
			}
		}

		// Handle simple * for batch
		if (options === "*") {
			const placeholderRows = items.map((_, rowIndex) => {
				const rowPlaceholders = columns.map(col => `$${col}_${rowIndex}`)
				return `(${rowPlaceholders.join(", ")})`
			})

			const paramOps = items.flatMap((_, rowIndex) =>
				columns.map(col => `$${col}_${rowIndex}`)
			)

			return {
				columns,
				placeholders: placeholderRows,
				parameterOperators: paramOps,
				isMulti: true,
				itemCount: items.length,
			}
		}
	}

	// Handle single record operations (rest of the code remains the same)
	if (options === "*") {
		const columns = Object.keys(params as P)
		const paramOps = columns.map(k => `$${k}`)
		return {
			columns,
			placeholders: paramOps,
			parameterOperators: paramOps,
		}
	}

	if (Array.isArray(options) && options[0] === "*" && options.length === 2) {
		const [, config] = options

		if (!config || typeof config !== "object") {
			throw new NodeSqliteError(
				"ERR_SQLITE_PARAM",
				SqlitePrimaryResultCode.SQLITE_ERROR,
				"Invalid configuration",
				"Second element must be a configuration object",
				undefined
			)
		}

		if (
			"batch" in config &&
			config.batch &&
			!Array.isArray(params) &&
			!(params instanceof Set)
		) {
			throw new NodeSqliteError(
				"ERR_SQLITE_PARAM",
				SqlitePrimaryResultCode.SQLITE_ERROR,
				"Invalid parameters",
				"Expected array or Set when using batch",
				undefined
			)
		}

		if ("jsonColumns" in config) {
			const jsonColumns = new Set(config.jsonColumns)
			const columns = Object.keys(params as P)
			const paramOps = columns.map(k => `$${k}`)

			return {
				columns,
				placeholders: columns.map(col =>
					jsonColumns.has(col) ? `jsonb($${col})` : `$${col}`
				),
				parameterOperators: paramOps,
			}
		}

		throw new NodeSqliteError(
			"ERR_SQLITE_PARAM",
			SqlitePrimaryResultCode.SQLITE_ERROR,
			"Invalid configuration",
			"Configuration must include jsonColumns for single record",
			undefined
		)
	}

	// Handle explicit column array (remains the same)
	if (Array.isArray(options)) {
		const columns: string[] = []
		const placeholders: string[] = []
		const paramOps: string[] = []

		for (const op of options) {
			if (typeof op !== "string") {
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
			paramOps.push(op)

			if (op.endsWith("->json")) {
				placeholders.push(`jsonb($${column})`)
			} else {
				placeholders.push(`$${column}`)
			}
		}

		return { columns, placeholders, parameterOperators: paramOps }
	}

	throw new NodeSqliteError(
		"ERR_SQLITE_PARAM",
		SqlitePrimaryResultCode.SQLITE_ERROR,
		"Invalid format",
		"Must be '*', an array of parameters, or a configuration tuple",
		undefined
	)
}

export function buildValuesStatement<P extends DataRow>(
	values: InsertOptions<P>,
	params: P | P[]
): { sql: string; parameterOperators: string[] } {
	const result = buildSqlComponents(values, params)

	if (
		result.isMulti &&
		result.itemCount &&
		Array.isArray(result.placeholders)
	) {
		return {
			sql: `(${result.columns.join(", ")}) VALUES\n  ${result.placeholders.join(",\n  ")}`,
			parameterOperators: result.parameterOperators,
		}
	}

	return {
		sql: `(${result.columns.join(", ")}) VALUES (${result.placeholders})`,
		parameterOperators: result.parameterOperators,
	}
}
