import { NodeSqliteError, SqlitePrimaryResultCode } from "#errors.js"
import { buildForeignKeyStatement, validateForeignKeys } from "#fk.js"
import type { DataRow, Schema } from "#types"
import { validationErr, type ValidationError } from "#validate"

const columnRegex = /^(TEXT|INTEGER|REAL|BLOB)(\s+.+)?$/

export function validateSchema<T extends DataRow>(
	value: unknown
): ValidationError[] {
	if (!value || typeof value !== "object") {
		return [validationErr({ msg: "Columns must be an object" })]
	}

	const errors: ValidationError[] = []
	const columns = value as Record<string, unknown>

	for (const [key, def] of Object.entries(columns)) {
		if (key === "$$foreignKeys") {
			continue
		}

		if (typeof def !== "string") {
			errors.push(
				validationErr({
					msg: `Column '${key}' definition must be a string`,
					path: key,
				})
			)
			continue
		}

		if (!columnRegex.test(def.trim())) {
			errors.push(
				validationErr({
					msg: `Invalid column definition format for '${key}'`,
					path: key,
				})
			)
		}
	}

	if ("$$foreignKeys" in columns) {
		// Validate the foreign keys array
		const fks = columns.$$foreignKeys
		if (!Array.isArray(fks)) {
			errors.push(
				validationErr({
					msg: "Foreign keys must be an array",
					path: "$$foreignKeys",
				})
			)
		} else {
			fks.forEach((fk, idx) => {
				const fkErrors = validateForeignKeys(fk)
				errors.push(
					...fkErrors.map(err => ({
						...err,
						path: `$$foreignKeys[${idx}].${err.path || ""}`,
					}))
				)
			})
		}
	}

	return errors
}

export function isValidSchema<T extends DataRow>(
	value: unknown
): value is Schema<T> {
	return validateSchema<T>(value).length === 0
}

export function buildSchema<T extends DataRow>(columns: Schema<T>): string {
	const errors = validateSchema<T>(columns)
	if (errors.length > 0) {
		throw new NodeSqliteError(
			"ERR_SQLITE_COLUMNS",
			SqlitePrimaryResultCode.SQLITE_ERROR,
			"Invalid column definitions",
			errors.map(e => e.message).join("\n"),
			undefined
		)
	}

	const columnDefs = Object.entries(columns)
		.filter(([key]) => key !== "$$foreignKeys")
		.map(([name, def]) => `${name} ${String(def).trim()}`)

	const foreignKeys = columns.$$foreignKeys
		? buildForeignKeyStatement(columns.$$foreignKeys)
		: null

	const allDefs = foreignKeys ? [...columnDefs, foreignKeys] : columnDefs

	return `(\n  ${allDefs.join(",\n  ")}\n)`
}
