// Copyright 2025 Takin Profit. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.
// noinspection t

import {
	isSqlContext,
	type SqlContext,
	validateContextCombination,
	validateSqlContext,
} from "#context"
import { NodeSqliteError, SqlitePrimaryResultCode } from "#errors"
import { buildSetStatement, buildValuesStatement } from "#values"
import type stringifyLib from "fast-safe-stringify"
import { createRequire } from "node:module"
import type { Primitive } from "type-fest"
import type {
	StatementResultingChanges,
	StatementSync,
	SupportedValueType,
} from "node:sqlite"
import type { DataRow } from "#types"
import { buildColumnsStatement } from "#columns"
import { buildWhereStatement } from "#where.js"
import sqlFormatter from "@sqltools/formatter"

const stringify: typeof stringifyLib = createRequire(import.meta.url)(
	"fast-safe-stringify"
)

/**
 * Represents a parameter operator that references a property of type P
 */
export type ParameterOperator<P extends DataRow> = `$${keyof P & string}`

// Step 2: Get keys of non-primitive values
type NonPrimitiveKeys<T> = {
	[K in keyof T]: T[K] extends Primitive ? never : K
}[keyof T]

/**
 * Represents a parameter operator that converts a property to JSON
 * Only allows non-primitive values to be converted to JSON
 */
export type ToJson<P extends DataRow> =
	`$${NonPrimitiveKeys<P> & string}${"->json"}`

/**
 * Represents a parameter operator that parses a property from JSON
 * Only allows non-primitive values to be parsed from JSON
 */
export type FromJson<P extends DataRow> =
	`$${NonPrimitiveKeys<P> & string}${"<-json"}` // only supports json_extract
/**
 * Union type of all possible parameter operators
 */
export type ParamValue<P extends DataRow> =
	| ParameterOperator<P>
	| ToJson<P>
	| FromJson<P>

export type SqlTemplateValues<P extends DataRow> = ReadonlyArray<
	ParamValue<P> | SqlContext<P>
>

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

export class Sql<P extends DataRow> {
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

	#contextToSql(context: SqlContext<P>): string {
		let sql = ""

		if (context.columns) {
			sql += sqlFormatter.format(buildColumnsStatement(context.columns))
		}

		// Handle values property if present
		if (context.values) {
			const { sql: valuesSql } = buildValuesStatement(
				context.values,
				this.#params
			)
			sql += sqlFormatter.format(valuesSql)
		}

		if (context.set) {
			const { sql: setSql } = buildSetStatement(context.set, this.#params)
			sql += sqlFormatter.format(setSql)
		}

		if (context.where) {
			sql += sqlFormatter.format(buildWhereStatement(context.where).sql)
		}

		// Future context properties will be handled here
		// if (context.where) { ... }
		// if (context.orderBy) { ... }
		// etc.

		return sql
	}

	// SQL property update
	get sql(): string {
		let result = this.#strings[0]

		for (let i = 0; i < this.#paramOperators.length; i++) {
			const op = this.#paramOperators[i]

			if (isSqlContext<P>(op)) {
				const contextSql = this.#contextToSql(op)
				result += contextSql + this.#strings[i + 1]
			} else if (typeof op === "string") {
				if (op.endsWith("->json")) {
					const columnName = op.split("->")[0]
					result += `jsonb(${columnName}) ${this.#strings[i + 1]}`
				} else if (op.endsWith("<-json")) {
					const columnName = op.split("<-")[0].substring(1)
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
			// noinspection SuspiciousTypeOfGuard
			if (typeof op !== "string" || op.endsWith("<-json")) {
				continue
			}

			const paramName = op.split("->")[0].substring(1)
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

			if (op.endsWith("->json")) {
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
				result[key] = JSON.parse(value)
			} catch {
				// Keep original value if parsing fails
			}
		}
	}
	return result
}
type CreateXStatementSyncProps<P extends DataRow | undefined> = (params: P) => {
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
