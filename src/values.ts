import type { InsertOptions } from "#context.js"
import { NodeSqliteError, SqlitePrimaryResultCode } from "#errors"
import type { DataRow } from "#types"

type BuildSqlResult = {
	columns: string[]
	placeholders: string[]
	isMulti?: boolean
	itemCount?: number
}

function buildSqlComponents<P extends DataRow>(
	options: InsertOptions<P>,
	params: P
): BuildSqlResult {
	// First check if params is Array/Set for default multi-row behavior
	if ((Array.isArray(params) || params instanceof Set) && options === "*") {
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
		return {
			columns,
			placeholders: columns.map(k => `$${k}`),
			isMulti: true,
			itemCount: items.length,
		}
	}

	if (options === "*") {
		const columns = Object.keys(params)
		return {
			columns,
			placeholders: columns.map(k => `$${k}`),
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

		// Legacy forEach case
		if ("forEach" in config) {
			if (!Array.isArray(params) && !(params instanceof Set)) {
				throw new NodeSqliteError(
					"ERR_SQLITE_PARAM",
					SqlitePrimaryResultCode.SQLITE_ERROR,
					"Invalid parameters",
					"Expected array or Set when using forEach",
					undefined
				)
			}

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
			const jsonColumns = new Set(
				"jsonColumns" in config ? config.jsonColumns : []
			)

			return {
				columns,
				placeholders: columns.map(col =>
					jsonColumns.has(col) ? `jsonb($${col})` : `$${col}`
				),
				isMulti: true,
				itemCount: items.length,
			}
		}

		// Handle jsonColumns case
		if ("jsonColumns" in config) {
			const jsonColumns = new Set(config.jsonColumns)
			const columns = Object.keys(params)
			const placeholders = columns.map(col =>
				jsonColumns.has(col) ? `jsonb($${col})` : `$${col}`
			)
			return { columns, placeholders }
		}

		throw new NodeSqliteError(
			"ERR_SQLITE_PARAM",
			SqlitePrimaryResultCode.SQLITE_ERROR,
			"Invalid configuration",
			"Configuration must include either forEach or jsonColumns",
			undefined
		)
	}

	if (Array.isArray(options)) {
		const columns: string[] = []
		const placeholders: string[] = []

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
			if (op.endsWith("->json")) {
				placeholders.push(`jsonb($${column})`)
			} else {
				placeholders.push(`$${column}`)
			}
		}

		return { columns, placeholders }
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
	params: P
): string {
	const result = buildSqlComponents(values, params)

	if (result.isMulti && result.itemCount) {
		const placeholderRow = `(${result.placeholders.join(", ")})`

		// For single item, don't add newlines
		if (result.itemCount === 1) {
			return `(${result.columns.join(", ")}) VALUES ${placeholderRow}`
		}

		const allRows = Array(result.itemCount).fill(placeholderRow).join(",\n    ")
		return `(${result.columns.join(", ")}) VALUES\n    ${allRows}`
	}

	return `(${result.columns.join(", ")}) VALUES (${result.placeholders.join(", ")})`
}

export function buildSetStatement<P extends DataRow>(
	set: InsertOptions<P>,
	params: P
): string {
	const { columns, placeholders } = buildSqlComponents(set, params)
	const setPairs = columns.map((col, i) => `${col} = ${placeholders[i]}`)

	return `SET ${setPairs.join(", ")}`
}
