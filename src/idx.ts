import { NodeSqliteError, SqlitePrimaryResultCode } from "#errors.js"
import type { DataRow } from "#types.js"
import { validationErr, type ValidationError } from "#validate.js"

type IndexColumn<T extends DataRow> =
	`${keyof T & string}${"" | " ASC" | " DESC"}${"" | ` COLLATE ${string}`}`

type WhereExpr = `WHERE ${string}`

type IndexName = `${string}_idx` | `idx_${string}`

type IndexOptions = {
	unique?: boolean
	ifNotExists?: boolean
}

export type IndexDef<T extends DataRow> = {
	name: IndexName
	tableName: string
	columns: IndexColumn<T>[] | [`${keyof T & string}(${string})`]
	where?: WhereExpr
	options?: IndexOptions
}

export function validateIndexDef<T extends DataRow>(
	def: IndexDef<T>
): ValidationError[] {
	const errors: ValidationError[] = []

	if (!def.name.endsWith("_idx") && !def.name.startsWith("idx_")) {
		errors.push(
			validationErr({
				msg: "Index name must end with '_idx' or start with 'idx_'",
				path: "name",
			})
		)
	}

	if (!def.tableName) {
		errors.push(
			validationErr({
				msg: "Table name is required",
				path: "tableName",
			})
		)
	}

	if (!Array.isArray(def.columns) || def.columns.length === 0) {
		errors.push(
			validationErr({
				msg: "Index must have at least one column",
				path: "columns",
			})
		)
	}

	if (def.where && !def.where.startsWith("WHERE ")) {
		errors.push(
			validationErr({
				msg: "WHERE clause must start with 'WHERE'",
				path: "where",
			})
		)
	}

	return errors
}

export function buildIndexStatement<T extends DataRow>(
	def: IndexDef<T>
): string {
	const errors = validateIndexDef(def)
	if (errors.length > 0) {
		throw new NodeSqliteError(
			"ERR_SQLITE_INDEX",
			SqlitePrimaryResultCode.SQLITE_ERROR,
			"Invalid index definition",
			errors.map(e => e.message).join("\n"),
			undefined
		)
	}

	// Extract expressions from column definitions
	const columns = def.columns
		.map(col => {
			const match =
				typeof col === "string" ? col.match(/^(\w+)\((.*)\)$/) : null
			return match ? match[2] : col
		})
		.join(", ")

	const unique = def.options?.unique ? "UNIQUE " : ""
	const ifNotExists = def.options?.ifNotExists ? "IF NOT EXISTS " : ""
	const where = def.where ? `\n  ${def.where}` : ""

	return `CREATE ${unique}INDEX ${ifNotExists}${def.name} ON ${def.tableName} (${columns})${where}`
}

export function createIndexName(
	prefix: string,
	...columns: string[]
): IndexName {
	return `idx_${prefix}_${columns.join("_")}` as IndexName
}
