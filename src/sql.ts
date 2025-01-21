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
	readonly #defaultParams: PartialDeep<P>

	#hasJsonColumns = false

	constructor(
		strings: readonly string[],
		paramOperators: ReadonlyArray<ParamValue<P>>,
		defaultParams: PartialDeep<P> = {} as PartialDeep<P>
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

	get sql(): string {
		let result = this.#strings[0]

		for (let i = 0; i < this.#paramOperators.length; i++) {
			const op = this.#paramOperators[i]

			if (op.endsWith(".toJson")) {
				result += `jsonb(?) ${this.#strings[i + 1]}`
			} else if (op.endsWith(".fromJson")) {
				const columnName = op.split(".")[0].substring(1)
				result += `json_extract(${columnName}, '$') ${this.#strings[i + 1]}`
			} else {
				result += `? ${this.#strings[i + 1]}`
			}
		}
		return result
	}

	get hasJsonColumns(): boolean {
		return (
			this.sql.includes("json_extract") ||
			this.sql.includes("json(") ||
			this.sql.includes("jsonb(") ||
			this.#hasJsonColumns
		)
	}

	withParams(
		params: P,
		isMutation = false
	): {
		sql: string
		values: SupportedValueType[]
		hasJsonColumns: boolean
	} {
		const values = this.#paramOperators
			.map((op) => {
				// For fromJson operations in queries, we don't need any values at all
				if (op.endsWith(".fromJson") && !isMutation) {
					this.#hasJsonColumns = true
					return null
				}

				const paramName = this.#extractParamName(op)
				const value =
					paramName in params
						? params[paramName]
						: this.#defaultParams[paramName as string]

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

				if (op.endsWith(".toJson")) {
					this.#hasJsonColumns = true
					return stringify(value)
				}

				return toSupportedValue(value)
			})
			.filter((value): value is NonNullable<typeof value> => value !== null)

		return {
			sql: this.sql,
			values,
			hasJsonColumns: this.hasJsonColumns,
		}
	}
}

/**
 * Interface for prepared statements with type safety
 */
export interface XStatementSync<
	P extends Record<string, unknown> | undefined,
	RET = unknown,
> {
	all<R = RET>(params: P): R[]
	expandedSQL: string
	iterate<R = RET>(params: P): Iterator<R>
	get<R = RET>(params: P): R | undefined
	run(params: P): StatementResultingChanges
	sourceSQL: string
}

function looksLikeJSON(value: unknown): value is string {
	if (typeof value !== "string") {
		return false
	}
	const data = value.trim()
	return (
		// Only objects and arrays
		(data.startsWith("{") && data.endsWith("}")) ||
		(data.startsWith("[") && data.endsWith("]"))
	)
}

/**
 * Helper function to parse JSON columns in result rows
 */
export function parseJsonColumns(
	row: Record<string, unknown>
): Record<string, unknown> {
	const result = { ...row }

	// Handle every field in the row that's a string and try to parse it
	for (const [key, value] of Object.entries(result)) {
		if (looksLikeJSON(value)) {
			try {
				result[key] = JSON.parse(value)
			} catch {
				// Keep original value if parsing fails
			}
		}
	}
	return result
}
type CreateXStatementSyncProps<
	P extends { [key: string]: unknown } | undefined,
> = (params: P) => {
	stmt: StatementSync
	values: SupportedValueType[]
	hasJsonColumns: boolean
}

/**
 * Creates a type-safe prepared statement
 */
// Update the factory function
export function createXStatementSync<
	P extends Record<string, unknown> | undefined,
	RET = unknown,
>(props: CreateXStatementSyncProps<P>): XStatementSync<P, RET> {
	return {
		all<R = RET>(params: P) {
			try {
				const { stmt, values, hasJsonColumns } = props(params)
				const results = stmt.all(...values)
				if (!results || !results.length) {
					// No results case
					return (Array.isArray(results) ? [] : undefined) as R
				}

				if (!hasJsonColumns) {
					return results as R
				}

				if (Array.isArray(results)) {
					// Array results case
					return results.map((row) =>
						parseJsonColumns(row as Record<string, unknown>)
					) as R
				}

				if (typeof results === "object") {
					// Single object result case
					return parseJsonColumns(results as Record<string, unknown>) as R
				}

				// Primitive value case
				return results as R
			} catch (error) {
				throw new NodeSqliteError(
					"ERR_SQLITE_QUERY",
					SqlitePrimaryResultCode.SQLITE_ERROR,
					"Query execution failed",
					error instanceof Error ? error.message : String(error),
					error instanceof Error ? error : undefined
				)
			}
		},

		get<R = RET>(params: P) {
			try {
				const { stmt, values, hasJsonColumns } = props(params)
				const row = stmt.get(...values)

				if (!row) {
					return undefined
				}

				if (!hasJsonColumns) {
					return row as R
				}

				return parseJsonColumns(row as Record<string, unknown>) as R
			} catch (error) {
				throw new NodeSqliteError(
					"ERR_SQLITE_QUERY",
					SqlitePrimaryResultCode.SQLITE_ERROR,
					"Query execution failed",
					error instanceof Error ? error.message : String(error),
					error instanceof Error ? error : undefined
				)
			}
		},

		run(params: P) {
			try {
				const { stmt, values } = props(params)
				return stmt.run(...values)
			} catch (error) {
				throw new NodeSqliteError(
					"ERR_SQLITE_MUTATE",
					SqlitePrimaryResultCode.SQLITE_ERROR,
					"Mutation failed",
					error instanceof Error ? error.message : String(error),
					error instanceof Error ? error : undefined
				)
			}
		},

		iterate<R = RET>(params: P) {
			try {
				const { stmt, values, hasJsonColumns } = props(params)
				// @ts-expect-error -- @types/node types are incomplete
				const baseIterator = stmt.iterate(...values)
				return {
					next(): IteratorResult<R> {
						const result = baseIterator.next()
						if (result.done) {
							return { done: true, value: undefined }
						}
						return {
							done: false,
							value: hasJsonColumns
								? (parseJsonColumns(
										result.value as Record<string, unknown>
									) as R)
								: (result.value as R),
						}
					},
				}
			} catch (error) {
				throw new NodeSqliteError(
					"ERR_SQLITE_QUERY",
					SqlitePrimaryResultCode.SQLITE_ERROR,
					"Query execution failed",
					error instanceof Error ? error.message : String(error),
					error instanceof Error ? error : undefined
				)
			}
		},

		get expandedSQL() {
			try {
				const { stmt } = props({} as P)
				return stmt.expandedSQL
			} catch (error) {
				throw new NodeSqliteError(
					"ERR_SQLITE_QUERY",
					SqlitePrimaryResultCode.SQLITE_ERROR,
					"Failed to get expanded SQL",
					error instanceof Error ? error.message : String(error),
					error instanceof Error ? error : undefined
				)
			}
		},

		get sourceSQL() {
			try {
				const { stmt } = props({} as P)
				return stmt.sourceSQL
			} catch (error) {
				throw new NodeSqliteError(
					"ERR_SQLITE_QUERY",
					SqlitePrimaryResultCode.SQLITE_ERROR,
					"Failed to get source SQL",
					error instanceof Error ? error.message : String(error),
					error instanceof Error ? error : undefined
				)
			}
		},
	}
}
