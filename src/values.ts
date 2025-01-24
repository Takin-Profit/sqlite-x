import type { InsertOrSetOptions } from "#context"
import { NodeSqliteError, SqlitePrimaryResultCode } from "#errors"
import type { DataRow } from "#types"

type BuildSqlResult = {
	columns: string[]
	placeholders: string[]
}

function buildSqlComponents<P extends DataRow>(
	options: InsertOrSetOptions<P>,
	params: P
): BuildSqlResult {
	const isValueType = (value: unknown): value is string => {
		return typeof value === "string"
	}

	if (options === "*") {
		const columns = Object.keys(params)
		return {
			columns,
			placeholders: columns.map(k => `$${k}`),
		}
	}

	if (Array.isArray(options) && options[0] === "*" && options.length === 2) {
		if (
			!options[1] ||
			typeof options[1] !== "object" ||
			!("jsonColumns" in options[1])
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
			(options[1] as { jsonColumns: string[] }).jsonColumns
		)
		const columns = Object.keys(params)
		const placeholders = columns.map(col =>
			jsonColumns.has(col) ? `jsonb($${col})` : `$${col}`
		)

		return {
			columns,
			placeholders,
		}
	}

	if (Array.isArray(options)) {
		const columns: string[] = []
		const placeholders: string[] = []
		let hasJson = false

		for (const op of options) {
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

		return { columns, placeholders }
	}

	throw new NodeSqliteError(
		"ERR_SQLITE_PARAM",
		SqlitePrimaryResultCode.SQLITE_ERROR,
		"Invalid format",
		"Must be '*', an array of parameters, or a ValuesWithJsonColumns tuple",
		undefined
	)
}

export function buildValuesStatement<P extends DataRow>(
	values: InsertOrSetOptions<P>,
	params: P
): string {
	const { columns, placeholders } = buildSqlComponents(values, params)

	return `(${columns.join(", ")}) VALUES (${placeholders.join(", ")})`
}

export function buildSetStatement<P extends DataRow>(
	set: InsertOrSetOptions<P>,
	params: P
): string {
	const { columns, placeholders } = buildSqlComponents(set, params)
	const setPairs = columns.map((col, i) => `${col} = ${placeholders[i]}`)

	return `SET ${setPairs.join(", ")}`
}
