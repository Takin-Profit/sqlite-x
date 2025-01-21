// Copyright 2025 Takin Profit. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.
// noinspection t

import { NodeSqliteError, SqlitePrimaryResultCode } from "#errors.js"
import type stringifyLib from "fast-safe-stringify"
import { createRequire } from "node:module"
import type {
	StatementResultingChanges,
	StatementSync,
	SupportedValueType,
} from "node:sqlite"
import type { PartialDeep } from "type-fest"

const stringify: typeof stringifyLib = createRequire(import.meta.url)(
	"fast-safe-stringify"
)

/**
 * Represents a parameter operator that references a property of type P
 */
type ValueOfOperator<P extends { [key: string]: unknown }> =
	`@${keyof P & string}`

/**
 * Represents a parameter operator that converts a property to JSON
 */
type ToJson<P extends { [key: string]: unknown }> =
	`${ValueOfOperator<P>}.toJson`

/**
 * Represents a parameter operator that parses a property from JSON
 */
type FromJson<P extends { [key: string]: unknown }> =
	`${ValueOfOperator<P>}.fromJson`

/**
 * Union type of all possible parameter operators
 */
type ParamValue<P extends { [key: string]: unknown }> =
	| ValueOfOperator<P>
	| ToJson<P>
	| FromJson<P>

/**
 * Function type for SQL template literal tag
 */
export type SqlFn<P extends { [key: string]: unknown }> = (
	strings: TemplateStringsArray,
	...params: Array<ParamValue<P>>
) => Sql<P>

function toSupportedValue(value: unknown): SupportedValueType {
	if (
		value === null ||
		typeof value === "string" ||
		typeof value === "number" ||
		typeof value === "bigint" ||
		value instanceof Uint8Array
	) {
		return value as SupportedValueType
	}
	return String(value)
}

export class Sql<P extends { [key: string]: unknown }> {
	readonly #strings: readonly string[]
	readonly #paramOperators: ReadonlyArray<ParamValue<P>>
	readonly #defaultParams: Partial<P>
	readonly #jsonColumns = new Set<string>()

	constructor(
		strings: readonly string[],
		paramOperators: ReadonlyArray<ParamValue<P>>,
		defaultParams: Partial<P> = {} as Partial<P>
	) {
		this.#strings = strings
		this.#paramOperators = paramOperators
		this.#defaultParams = defaultParams
	}

	#extractParamName(op: ParamValue<P>): keyof P {
		const match = op.match(/^@([^.]+)/)
		if (!match) {
			throw new NodeSqliteError(
				"ERR_SQLITE_PARAM",
				SqlitePrimaryResultCode.SQLITE_ERROR,
				"Invalid parameter format",
				`Parameter operator "${op}" must start with @`,
				undefined
			)
		}
		return match[1] as keyof P
	}

	#isToJson(op: ParamValue<P>): boolean {
		if (op.endsWith(".toJson")) {
			const columnName = op.split(".")[0].substring(1)
			this.#jsonColumns.add(columnName)
			return true
		}
		return false
	}

	#isFromJson(op: ParamValue<P>): boolean {
		if (op.endsWith(".fromJson")) {
			const columnName = op.split(".")[0].substring(1)
			this.#jsonColumns.add(columnName)
			return true
		}
		return false
	}

	get sql(): string {
		let result = this.#strings[0]

		for (let i = 0; i < this.#paramOperators.length; i++) {
			const op = this.#paramOperators[i]

			if (this.#isToJson(op)) {
				result += `json(?) ${this.#strings[i + 1]}`
			} else if (this.#isFromJson(op)) {
				const columnName = op.split(".")[0].substring(1)
				result += `json_extract(${columnName}, '$') ${this.#strings[i + 1]}`
			} else {
				result += `? ${this.#strings[i + 1]}`
			}
		}
		return result
	}
	withParams(
		params: P,
		isMutation = false
	): {
		sql: string
		values: SupportedValueType[]
		jsonColumns: string[]
	} {
		const values = this.#paramOperators
			.map((op) => {
				// For fromJson operations in queries, we don't need any values at all
				if (this.#isFromJson(op) && !isMutation) {
					return null
				}

				const paramName = this.#extractParamName(op)
				const value =
					paramName in params
						? params[paramName]
						: this.#defaultParams[paramName]

				// Only mutations need to check for missing parameters
				if (value === undefined && isMutation) {
					throw new NodeSqliteError(
						"ERR_SQLITE_PARAM",
						SqlitePrimaryResultCode.SQLITE_ERROR,
						"Missing parameter",
						`Parameter '${String(paramName)}' is undefined`,
						undefined
					)
				}

				if (this.#isToJson(op)) {
					return stringify(value)
				}

				return toSupportedValue(value)
			})
			.filter((value): value is NonNullable<typeof value> => value !== null)

		const jsonColumns = Array.from(this.#jsonColumns)

		return {
			sql: this.sql,
			values,
			jsonColumns,
		}
	}
}

/**
 * Interface for prepared statements with type safety
 */
export interface PreparedStatement<T> {
	all(): T[]
	expandedSQL: string
	iterate(): Iterator<T>
	get(): T | undefined
	run(): StatementResultingChanges
	sourceSQL: string
}

/**
 * Helper function to parse JSON columns in result rows
 */
export function parseJsonColumns(
	row: Record<string, unknown>,
	jsonColumns: string[]
): Record<string, unknown> {
	if (!row || !jsonColumns.length) {
		return row
	}

	const result = { ...row }

	// Handle every field in the row that's a string and try to parse it
	for (const [key, value] of Object.entries(result)) {
		if (typeof value === "string") {
			try {
				result[key] = JSON.parse(value)
			} catch {
				// Keep original value if parsing fails
			}
		}
	}
	return result
}
/**
 * Creates a type-safe prepared statement
 */
export function createPreparedStatement<T>(
	stmt: StatementSync,
	values: SupportedValueType[],
	jsonColumns: string[] = []
): PreparedStatement<T> {
	return {
		all: () =>
			stmt
				.all(...values)
				.map((row) =>
					parseJsonColumns(row as Record<string, unknown>, jsonColumns)
				) as T[],

		get: () => {
			const row = stmt.get(...values)
			return row
				? (parseJsonColumns(row as Record<string, unknown>, jsonColumns) as T)
				: undefined
		},

		run: () => stmt.run(...values),

		iterate: () => {
			// @ts-expect-error -- node:sqlite types are incomplete
			const baseIterator = stmt.iterate(...values)
			return {
				next(): IteratorResult<T> {
					const result = baseIterator.next()
					if (result.done) {
						return { done: true, value: undefined }
					}
					return {
						done: false,
						value: parseJsonColumns(
							result.value as Record<string, unknown>,
							jsonColumns
						) as T,
					}
				},
			}
		},

		get expandedSQL() {
			return stmt.expandedSQL
		},
		get sourceSQL() {
			return stmt.sourceSQL
		},
	}
}

/**
 * Interface for binding parameters to prepared statements
 */
export type StatementBinder<P extends { [key: string]: unknown }, T> = {
	bind(params: PartialDeep<P>): PreparedStatement<T>
}

/**
 * Creates a type-safe statement binder
 */
export function createStatementBinder<P extends { [key: string]: unknown }, T>(
	statement: Sql<P>,
	prepareStatement: (sql: string) => StatementSync
): StatementBinder<P, T> {
	return {
		bind: (params: PartialDeep<P>) => {
			const { sql, values, jsonColumns } = statement.withParams(params as P)
			const stmt = prepareStatement(sql)
			return createPreparedStatement<T>(stmt, values, jsonColumns)
		},
	}
}
