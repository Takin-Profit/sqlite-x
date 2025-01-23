// Copyright 2025 Takin Profit. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.
// noinspection t

import {
	isSqlContext,
	validateContextCombination,
	validateSqlContext,
	type SqlContext,
} from "#context.js"
import { NodeSqliteError, SqlitePrimaryResultCode } from "#errors.js"
import { buildValuesStatement } from "#values.js"
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

export type SqlTemplateValues<P extends { [key: string]: unknown }> =
	ReadonlyArray<ParamValue<P> | SqlContext<P>>

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
	readonly #paramOperators: SqlTemplateValues<P>

	#params: P

	constructor(
		strings: readonly string[],
		paramOperators: SqlTemplateValues<P>,
		params: P
	) {
		this.#strings = strings
		this.#paramOperators = paramOperators
		this.#params = params
	}

	static formatSql(sqlInput: string): string {
		const depth = 0
		return `
     ${sqlInput
				.replace(/\bSELECT\b/g, "\nSELECT")
				.replace(/\bFROM\b/g, "\nFROM")
				.replace(/\bWHERE\b/g, "\nWHERE")
				.replace(/\bGROUP BY\b/g, "\nGROUP BY")
				.replace(/\bHAVING\b/g, "\nHAVING")
				.replace(/\bORDER BY\b/g, "\nORDER BY")
				.replace(/\bLIMIT\b/g, "\nLIMIT")
				.replace(/\bVALUES\b/g, "\nVALUES")
				.replace(/\bINSERT INTO\b/g, "\nINSERT INTO")
				.replace(/\bUPDATE\b/g, "\nUPDATE")
				.replace(/\bDELETE FROM\b/g, "\nDELETE FROM")
				.replace(/([,(])/g, `$1\n${" ".repeat(depth + 2)}`)
				.replace(/([)])/g, `\n${" ".repeat(Math.max(0, depth - 1))}$1`)}`
			.trim()
			.replace(/\s+\n/g, "\n")
			.replace(/\n\s+/g, "\n  ")
	}

	#contextToSql(context: SqlContext<P>): string {
		let sql = ""

		// Handle values property if present
		if (context.values) {
			const { sql: valuesSql } = buildValuesStatement(
				context.values,
				this.#params
			)
			sql += Sql.formatSql(valuesSql)
		}

		// Future context properties will be handled here
		// if (context.where) { ... }
		// if (context.orderBy) { ... }
		// etc.

		return sql
	}

	get sql(): string {
		let result = this.#strings[0]

		for (let i = 0; i < this.#paramOperators.length; i++) {
			const op = this.#paramOperators[i]

			if (isSqlContext<P>(op)) {
				const contextSql = this.#contextToSql(op)
				result += contextSql + this.#strings[i + 1]
			} else if (typeof op === "string") {
				if (op.endsWith(".toJson")) {
					result += `jsonb(${op.split(".")[0]}) ${this.#strings[i + 1]}`
				} else if (op.endsWith(".fromJson")) {
					const columnName = op.split(".")[0].substring(1)
					result += `json_extract(${columnName}, '$') ${this.#strings[i + 1]}`
				} else {
					result += `${op} ${this.#strings[i + 1]}`
				}
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

	#toNamedParams(): Record<string, SupportedValueType> {
		const namedParams: Record<string, SupportedValueType> = {}

		for (const op of this.#paramOperators) {
			if (typeof op !== "string" || op.endsWith(".fromJson")) {
				continue
			}

			const paramName = op.split(".")[0].substring(1)
			const value = this.#params[paramName]

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

	prepare(): {
		sql: string
		namedParams: Record<string, SupportedValueType>
		hasJsonColumns: boolean
	} {
		// First collect all SqlContext objects
		const contexts = this.#paramOperators.filter(
			(op): op is SqlContext<P> => typeof op === "object" && !Array.isArray(op)
		)

		// Validate individual contexts first
		const validationErrors = contexts.flatMap((context) =>
			validateSqlContext<P>(context)
		)

		if (validationErrors.length > 0) {
			throw new NodeSqliteError(
				"ERR_SQLITE_CONTEXT",
				SqlitePrimaryResultCode.SQLITE_MISUSE,
				"Invalid SQL context",
				validationErrors.map((e) => e.message).join("\n"),
				undefined
			)
		}

		// Then validate the combination of contexts
		const combinationErrors = validateContextCombination(contexts)

		if (combinationErrors.length > 0) {
			throw new NodeSqliteError(
				"ERR_SQLITE_CONTEXT",
				SqlitePrimaryResultCode.SQLITE_MISUSE,
				"Invalid SQL context combination",
				combinationErrors.map((e) => e.message).join("\n"),
				undefined
			)
		}

		return {
			sql: this.sql,
			namedParams: this.#toNamedParams(),
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
	iterate<R = RET>(params: P): Iterator<R>
	get<R = RET>(params: P): R | undefined
	run(params: P): StatementResultingChanges
	expandedSQL(params: P): string
	sourceSQL: (params: P) => string
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

		sourceSQL(params: P) {
			try {
				const { stmt } = props(params)
				return stmt.sourceSQL
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

		expandedSQL(params: P) {
			try {
				const { stmt } = props(params)
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
	}
}
