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

const stringify: typeof stringifyLib = createRequire(import.meta.url)(
	"fast-safe-stringify"
)

/**
 * Represents a parameter operator that references a property of type P
 */
export type ValueOfOperator<P extends { [key: string]: unknown }> =
	`$${keyof P & string}`

/**
 * Represents a parameter operator that converts a property to JSON
 */
export type ToJson<P extends { [key: string]: unknown }> =
	`${ValueOfOperator<P>}.toJson`

/**
 * Represents a parameter operator that parses a property from JSON
 */
type FromJson<P extends { [key: string]: unknown }> =
	`${ValueOfOperator<P>}.fromJson`

/**
 * Union type of all possible parameter operators
 */
export type ParamValue<P extends { [key: string]: unknown }> =
	| ValueOfOperator<P>
	| ToJson<P>
	| FromJson<P>

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

	constructor(
		strings: readonly string[],
		paramOperators: ReadonlyArray<ParamValue<P>>
	) {
		this.#strings = strings
		this.#paramOperators = paramOperators
	}

	get sql(): string {
		let result = this.#strings[0]

		for (let i = 0; i < this.#paramOperators.length; i++) {
			const op = this.#paramOperators[i]

			if (op.endsWith(".toJson")) {
				result += `json(${op.split(".")[0]}) ${this.#strings[i + 1]}`
			} else if (op.endsWith(".fromJson")) {
				const columnName = op.split(".")[0].substring(1)
				result += `json_extract(${columnName}, '$') ${this.#strings[i + 1]}`
			} else {
				result += `${op} ${this.#strings[i + 1]}`
			}
		}
		return result
	}

	get hasJsonColumns(): boolean {
		const { sql } = this
		return (
			sql.includes("json_extract") ||
			sql.includes("json(") ||
			sql.includes("jsonb(") ||
			sql.includes("json_array") ||
			sql.includes("json_object") ||
			sql.includes("json_type") ||
			sql.includes("json_valid") ||
			sql.includes("json_patch") ||
			sql.includes("json_group_array") ||
			sql.includes("json_group_object") ||
			sql.includes("json_tree") ||
			sql.includes("json_each") ||
			sql.includes("->") ||
			sql.includes("->>")
		)
	}

	#toNamedParams(params: P): Record<string, SupportedValueType> {
		const namedParams: Record<string, SupportedValueType> = {}

		for (const op of this.#paramOperators) {
			// Skip fromJson operations as they don't need parameters
			if (op.endsWith(".fromJson")) {
				continue
			}

			const paramName = op.split(".")[0].substring(1) // Remove $ prefix
			const value = params[paramName]

			if (value === undefined) {
				throw new NodeSqliteError(
					"ERR_SQLITE_PARAM",
					SqlitePrimaryResultCode.SQLITE_ERROR,
					"Missing parameter",
					`Parameter '${paramName}' is undefined`,
					undefined
				)
			}

			if (op.endsWith(".toJson")) {
				if (
					typeof value !== "object" &&
					!Array.isArray(value) &&
					value !== null
				) {
					throw new NodeSqliteError(
						"ERR_SQLITE_PARAM",
						SqlitePrimaryResultCode.SQLITE_ERROR,
						"Invalid parameter",
						`Parameter '${paramName}' must be an object or array for JSON conversion`,
						undefined
					)
				}
				namedParams[`$${paramName}`] = stringify(value)
			} else {
				namedParams[`$${paramName}`] = toSupportedValue(value)
			}
		}

		return namedParams
	}

	prepare(params: P): {
		sql: string
		namedParams: Record<string, SupportedValueType>
		hasJsonColumns: boolean
	} {
		return {
			sql: this.sql,
			namedParams: this.#toNamedParams(params),
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
				const data = JSON.parse(value)
				result[key] = data
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
	namedParams: Record<string, SupportedValueType>
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
				const { stmt, namedParams, hasJsonColumns } = props(params)
				const results = stmt.all(namedParams)
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
				const { stmt, namedParams, hasJsonColumns } = props(params)
				const row = stmt.get(namedParams)

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
				const { stmt, namedParams } = props(params)
				return stmt.run(namedParams)
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
				const { stmt, namedParams, hasJsonColumns } = props(params)
				// @ts-expect-error -- @types/node types are incomplete
				const baseIterator = stmt.iterate(namedParams)
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
