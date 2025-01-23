import { NodeSqliteError, SqlitePrimaryResultCode } from "#errors.js"
import type { DataRow } from "#types"
import { validationErr, type ValidationError } from "#validate"

type BaseConstraint =
	| "PRIMARY KEY"
	| "AUTOINCREMENT"
	| "UNIQUE"
	| `CHECK (${string})`
	| `FOREIGN KEY REFERENCES ${string} (${string})`
	| `DEFAULT ${string}`
	| "NOT NULL"

type DataType = "TEXT" | "INTEGER" | "REAL" | "BLOB"

type ConstraintPatterns<T, D extends DataType> = undefined extends T
	?
			| `${D} ${BaseConstraint}`
			| `${D} ${BaseConstraint} ${Exclude<BaseConstraint, "NOT NULL">}`
			| `${D} ${BaseConstraint} ${Exclude<BaseConstraint, "NOT NULL">} ${Exclude<BaseConstraint, "NOT NULL">}`
	:
			| `${D} ${BaseConstraint}`
			| `${D} ${BaseConstraint} ${BaseConstraint}`
			| `${D} ${BaseConstraint} ${BaseConstraint} ${BaseConstraint}`

type ValidColumnTypeMap<T> = T extends string
	? ConstraintPatterns<T, "TEXT"> | "TEXT"
	: T extends number
		?
				| ConstraintPatterns<T, "INTEGER">
				| ConstraintPatterns<T, "REAL">
				| "INTEGER"
				| "REAL"
		: T extends boolean
			? ConstraintPatterns<T, "INTEGER"> | "INTEGER"
			: T extends bigint
				? ConstraintPatterns<T, "INTEGER"> | "INTEGER"
				: T extends object | unknown[]
					?
							| ConstraintPatterns<T, "TEXT">
							| ConstraintPatterns<T, "BLOB">
							| "BLOB"
							| "TEXT"
					: never

export type Columns<T extends DataRow> = {
	[K in keyof T]?: ValidColumnTypeMap<T[K]>
}

const columnRegex = /^(TEXT|INTEGER|REAL|BLOB)(\s+.+)?$/

export function validateColumns<T extends DataRow>(
	value: unknown
): ValidationError[] {
	if (!value || typeof value !== "object") {
		return [validationErr({ msg: "Columns must be an object" })]
	}

	const errors: ValidationError[] = []
	const columns = value as Record<string, string>

	for (const [key, def] of Object.entries(columns)) {
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

	return errors
}

export function isValidColumns<T extends DataRow>(
	value: unknown
): value is Columns<T> {
	return validateColumns<T>(value).length === 0
}

export function buildColumnsStatement<T extends DataRow>(
	columns: Columns<T>
): string {
	const errors = validateColumns<T>(columns)
	if (errors.length > 0) {
		throw new NodeSqliteError(
			"ERR_SQLITE_COLUMNS",
			SqlitePrimaryResultCode.SQLITE_ERROR,
			"Invalid column definitions",
			errors.map((e) => e.message).join("\n"),
			undefined
		)
	}
	return `(\n  ${Object.entries(columns)
		.map(([name, def]) => `${name} ${String(def).trim()}`)
		.join(",\n  ")}\n);`
}
