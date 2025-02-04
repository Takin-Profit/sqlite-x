import { NodeSqliteError, SqlitePrimaryResultCode } from "#errors.js"
import { validationErr, type ValidationError } from "#validate.js"

// biome-ignore lint/suspicious/noExplicitAny: <explanation>
type DataRow = { [key: string]: any }
export type DeferrableStatus =
	| "NOT DEFERRABLE"
	| "DEFERRABLE INITIALLY IMMEDIATE"
	| "DEFERRABLE INITIALLY DEFERRED"

export type KeyList<T extends DataRow> =
	| keyof T
	| `${keyof T & string},${keyof T & string}`
	| `${keyof T & string},${keyof T & string},${keyof T & string}`

// Foreign key actions from SQLite spec
export type FKAction =
	| "NO ACTION"
	| "RESTRICT"
	| "SET NULL"
	| "SET DEFAULT"
	| "CASCADE"

export type ForeignKeyDef<T extends DataRow> = {
	key: KeyList<T>
	references: { table: string; columns: string[] }
	onDelete?: FKAction
	onUpdate?: FKAction
	deferrable?: DeferrableStatus
}

function validateKeyList<T extends DataRow>(key: unknown): ValidationError[] {
	if (typeof key !== "string") {
		return [validationErr({ msg: "Key must be a string" })]
	}

	const keys = key.split(",").map(k => k.trim())
	if (keys.length > 3) {
		return [
			validationErr({
				msg: "Maximum of 3 keys allowed in foreign key constraint",
			}),
		]
	}

	return []
}

export function validateForeignKeys<T extends DataRow>(
	value: unknown
): ValidationError[] {
	if (!value || typeof value !== "object") {
		return [validationErr({ msg: "Foreign key must be an object" })]
	}

	const errors: ValidationError[] = []
	const foreignKey = value as ForeignKeyDef<T>

	// Validate key
	errors.push(...validateKeyList(foreignKey.key))

	// Validate references
	if (!foreignKey.references) {
		errors.push(
			validationErr({
				msg: "References is required",
				path: "references",
			})
		)
	} else {
		if (typeof foreignKey.references.table !== "string") {
			errors.push(
				validationErr({
					msg: "Referenced table must be a string",
					path: "references.table",
				})
			)
		}

		if (!Array.isArray(foreignKey.references.columns)) {
			errors.push(
				validationErr({
					msg: "Referenced columns must be an array",
					path: "references.columns",
				})
			)
		} else if (foreignKey.references.columns.length > 3) {
			errors.push(
				validationErr({
					msg: "Maximum of 3 referenced columns allowed",
					path: "references.columns",
				})
			)
		}
	}

	// Validate actions
	if (foreignKey.onDelete && !isValidAction(foreignKey.onDelete)) {
		errors.push(
			validationErr({
				msg: "Invalid ON DELETE action",
				path: "onDelete",
			})
		)
	}

	if (foreignKey.onUpdate && !isValidAction(foreignKey.onUpdate)) {
		errors.push(
			validationErr({
				msg: "Invalid ON UPDATE action",
				path: "onUpdate",
			})
		)
	}

	// Validate deferrable
	if (foreignKey.deferrable && !isValidDeferrable(foreignKey.deferrable)) {
		errors.push(
			validationErr({
				msg: "Invalid deferrable status",
				path: "deferrable",
			})
		)
	}

	return errors
}

function isValidAction(action: string): action is FKAction {
	return [
		"NO ACTION",
		"RESTRICT",
		"SET NULL",
		"SET DEFAULT",
		"CASCADE",
	].includes(action)
}

function isValidDeferrable(status: string): status is DeferrableStatus {
	return [
		"NOT DEFERRABLE",
		"DEFERRABLE INITIALLY IMMEDIATE",
		"DEFERRABLE INITIALLY DEFERRED",
	].includes(status)
}

export function isForeignKeys<T extends DataRow>(
	value: unknown
): value is ForeignKeyDef<T> {
	return validateForeignKeys<T>(value).length === 0
}

export function buildForeignKeyStatement<T extends DataRow>(
	foreignKeys: ForeignKeyDef<T>[]
): string {
	if (!foreignKeys?.length) {
		return ""
	}

	return foreignKeys
		.map(fk => {
			const key = fk.key as string
			const keyColumns = key.split(",").map(k => k.trim())
			const refColumns = fk.references.columns

			if (keyColumns.length !== refColumns.length) {
				throw new NodeSqliteError(
					"ERR_SQLITE_FOREIGN_KEY",
					SqlitePrimaryResultCode.SQLITE_ERROR,
					"Column count mismatch",
					`Foreign key columns count (${keyColumns.length}) does not match referenced columns count (${refColumns.length})`,
					undefined
				)
			}

			let sql = `FOREIGN KEY(${keyColumns.join(", ")}) REFERENCES ${fk.references.table}(${refColumns.join(", ")})`

			if (fk.onDelete) {
				sql += ` ON DELETE ${fk.onDelete}`
			}

			if (fk.onUpdate) {
				sql += ` ON UPDATE ${fk.onUpdate}`
			}

			if (fk.deferrable) {
				sql += ` ${fk.deferrable}`
			}

			return sql
		})
		.join(",\n  ")
}
