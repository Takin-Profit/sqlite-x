// Copyright 2025 Takin Profit. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.
// noinspection t

// Copyright 2025 Takin Profit. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.
// noinspection t

import {
	buildColsStatement,
	isSqlContext,
	type SqlContext,
	validateContextCombination,
	validateSqlContext,
} from "#context"
import { NodeSqliteError, SqlitePrimaryResultCode } from "#errors"
import { buildSetStatement, buildValuesStatement } from "#values"
import type { Primitive } from "type-fest"
import type {
	StatementResultingChanges,
	StatementSync,
	SupportedValueType,
} from "node:sqlite"
import { isRawValue, type DataRow, type RawValue } from "#types"
import { buildWhereStatement } from "#where.js"
import sqlFormatter from "@sqltools/formatter"
import { buildOrderByStatement } from "#order-by"
import { buildColumnsStatement } from "#columns"
import type { Config } from "@sqltools/formatter/lib/core/types"
import stringify from "#stringify"

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
/**
 * Parameter values and contexts that can be used in SQL template literals
 */
export type SqlTemplateValues<P extends DataRow> = Array<
	ParamValue<P> | SqlContext<P> | RawValue
>

/**
 * Configuration for SQL formatting
 */
export type FormatterConfig =
	| false
	| {
			/** Indentation string (default: two spaces) */
			indent?: string

			/** Case for SQL keywords */
			reservedWordCase?: "upper" | "lower"

			/** Lines between queries */
			linesBetweenQueries?: number | "preserve"
	  }

/**
 * Options for initializing SQL builder
 */
export type SqlOptions<P extends DataRow> = {
	strings: readonly string[]
	paramOperators: SqlTemplateValues<P>
	formatterConfig?: FormatterConfig
	generatedSql?: string
}

export const raw = (
	strings: TemplateStringsArray,
	...values: (string | number | boolean | bigint | null)[]
) => {
	// Add validation
	for (const value of values) {
		if (typeof value === "object" && value !== null) {
			throw new NodeSqliteError(
				"ERR_SQLITE_PARAM",
				SqlitePrimaryResultCode.SQLITE_ERROR,
				"Invalid parameter",
				"Raw SQL values must be primitives (string | number | boolean | bigint | null)",
				undefined
			)
		}
	}

	return {
		type: "__x_literal__" as const,
		value: String.raw(strings, ...values),
	} as RawValue
}

export class Sql<P extends DataRow> {
	readonly strings: readonly string[]
	readonly paramOperators = new Set<ParamValue<P> | SqlContext<P> | RawValue>()

	readonly #contextOperators = new Set<string>()

	readonly formatterConfig?: Readonly<Config> | false
	#generatedSql = ""

	#params: P = {} as P

	constructor({
		strings,
		paramOperators,
		generatedSql,
		formatterConfig,
	}: SqlOptions<P>) {
		this.strings = strings

		for (const op of paramOperators) {
			this.paramOperators.add(op)
		}

		if (formatterConfig === false) {
			this.formatterConfig = false
		} else {
			this.formatterConfig = {
				indent: "  ",
				reservedWordCase: "upper",
				linesBetweenQueries: 1,
				...formatterConfig,
				language: "sql",
			}
		}

		this.#generatedSql = generatedSql ? `${generatedSql} ` : ""
	}

	#fmt(sql: string): string {
		if (this.formatterConfig) {
			return sqlFormatter.format(sql, this.formatterConfig)
		}
		return sql
	}

	#contextToSql(context: SqlContext<P>): string {
		const parts: string[] = []

		if (context.cols) {
			parts.push(buildColsStatement(context.cols))
		}

		if (context.columns) {
			parts.push(buildColumnsStatement(context.columns))
			parts[parts.length - 1] += ";" // Add semicolon after table creation
		}

		if (context.values) {
			const result = buildValuesStatement(context.values, this.#params)
			for (const op of result.parameterOperators) {
				this.#contextOperators.add(op)
			}
			parts.push(result.sql)
		}

		if (context.set) {
			const result = buildSetStatement(context.set, this.#params)
			for (const op of result.parameterOperators) {
				this.#contextOperators.add(op)
			}
			parts.push(result.sql)
		}

		if (context.where) {
			parts.push(buildWhereStatement(context.where))
		}

		if (context.orderBy) {
			parts.push(buildOrderByStatement(context.orderBy))
		}

		if (context.limit !== undefined) {
			parts.push(`LIMIT ${context.limit}`)
			if (context.offset !== undefined) {
				parts.push(`OFFSET ${context.offset}`)
			}
		} else if (context.offset !== undefined) {
			parts.push("LIMIT -1")
			parts.push(`OFFSET ${context.offset}`)
		}

		if (context.returning) {
			parts.push(
				context.returning === "*"
					? "RETURNING *"
					: `RETURNING ${context.returning.join(", ")}`
			)
		}

		return parts.join("\n")
	}

	get sql(): string {
		let result = this.#generatedSql
		result += this.strings[0]

		let i = 0
		for (const op of this.paramOperators) {
			if (isSqlContext<P>(op)) {
				result += this.#contextToSql(op)
				result += this.strings[i + 1]
			} else if (isRawValue(op)) {
				result += `${op.value}${this.strings[i + 1]}`
			} else if (typeof op === "string") {
				if (op.endsWith("->json")) {
					const columnName = op.split("->")[0]
					result += `jsonb(${columnName}) ${this.strings[i + 1]}`
				} else if (op.endsWith("<-json")) {
					const columnName = op.split("<-")[0].substring(1)
					result += `json_extract(${columnName}, '$') ${this.strings[i + 1]}`
				} else {
					result += `${op} ${this.strings[i + 1]}`
				}
			}
			i++
		}

		return this.#fmt(result.trim())
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
		const operators = new Set([
			...this.paramOperators,
			...this.#contextOperators,
		])

		// Handle batch params
		if (Array.isArray(this.#params) || this.#params instanceof Set) {
			const items = Array.isArray(this.#params)
				? this.#params
				: Array.from(this.#params)
			for (let index = 0; index < items.length; index++) {
				const row = items[index]
				for (const [key, value] of Object.entries(row)) {
					const operator = operators.has(`$${key}->json`)
						? `$${key}_${index}->json`
						: `$${key}_${index}`

					if (operator.endsWith("->json")) {
						if (
							typeof value !== "object" &&
							!Array.isArray(value) &&
							value !== null
						) {
							throw new NodeSqliteError(
								"ERR_SQLITE_PARAM",
								SqlitePrimaryResultCode.SQLITE_ERROR,
								"Invalid parameter",
								`Parameter '${key}' must be an object or array for JSON conversion`,
								undefined
							)
						}
						namedParams[`$${key}_${index}`] = stringify(value)
					} else {
						namedParams[`$${key}_${index}`] = toSupportedValue(value)
					}
				}
			}
			return namedParams
		}

		// Handle single record params
		for (const op of operators) {
			if (typeof op !== "string" || op.endsWith("<-json")) {
				continue
			}

			const paramName = op.split("->")[0].substring(1)
			const value = (this.#params as P)[paramName]

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

	prepare(params: P): {
		sql: string
		namedParams: Record<string, SupportedValueType>
		hasJsonColumns: boolean
	} {
		this.#params = params

		// Convert Set to array just for context filtering
		const contexts = Array.from(this.paramOperators).filter(
			op => typeof op === "object" && !Array.isArray(op) && !isRawValue(op)
		)

		const validationErrors = contexts.flatMap(context =>
			validateSqlContext<P>(context)
		)

		if (validationErrors.length > 0) {
			throw new NodeSqliteError(
				"ERR_SQLITE_CONTEXT",
				SqlitePrimaryResultCode.SQLITE_MISUSE,
				"Invalid SQL context",
				validationErrors.map(e => e.message).join("\n"),
				undefined
			)
		}

		const combinationErrors = validateContextCombination(
			contexts as SqlContext<P>[]
		)

		if (combinationErrors.length > 0) {
			throw new NodeSqliteError(
				"ERR_SQLITE_CONTEXT",
				SqlitePrimaryResultCode.SQLITE_MISUSE,
				"Invalid SQL context combination",
				combinationErrors.map(e => e.message).join("\n"),
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
type SingleRow<P extends DataRow> = {
	[K in keyof P]: P[K]
}

// Type for values params that can be single row or multiple rows
type ValuesParam<P extends DataRow> =
	| SingleRow<P>
	| SingleRow<P>[]
	| Set<SingleRow<P>>

/**
 * Interface for prepared SQL statements with type safety and chaining support.
 * @template P Type of parameters object
 * @template RET Type of returned rows
 */
export interface XStatementSync<P extends DataRow, RET = unknown> {
	/** Execute query and return all result rows */
	all<R = RET>(params?: ValuesParam<P>): R[]

	/** Execute query and return an iterator over result rows */
	iter<R = RET>(params?: ValuesParam<P>): Iterator<R> & Iterable<R>

	/** Execute query and return a generator that yields result rows */
	rows<R = RET>(params?: ValuesParam<P>): Generator<R>

	/** Execute query and return first result row or undefined */
	get<R = RET>(params?: ValuesParam<P>): R | undefined

	/** Execute query and return statement result info */
	run(params?: ValuesParam<P>): StatementResultingChanges

	/** Get SQL with parameters expanded */
	expandedSQL(params?: ValuesParam<P>): string

	/** Get original SQL source */
	sourceSQL: (params?: ValuesParam<P>) => string

	/** Chain another SQL template literal */
	sql(
		strings: TemplateStringsArray,
		...params: SqlTemplateValues<P>
	): XStatementSync<P, RET>
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
export function parseJsonColumns(row: DataRow): DataRow {
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
type CreateXStatementSyncProps<P extends DataRow> = {
	build: (params: P) => {
		stmt: StatementSync
		namedParams: Record<string, SupportedValueType>
		hasJsonColumns: boolean
	}
	prepare: (sql: string) => StatementSync
	sql: Sql<P>
}

const createErrorMessage = <P extends DataRow>(
	error: unknown,
	params?: P | P[]
) => {
	let paramStr = ""

	if (Array.isArray(params) && params.length > 1) {
		const item1 = params[0]
		const item2 = params[1]

		paramStr = `{${Object.keys(item1).join(", ")}, ...} + ${Object.keys(
			item2
		).join(", ")}`
	} else if (typeof params === "object") {
		paramStr = stringify(params)
	} else {
		paramStr = String(params)
	}
	return error instanceof Error
		? `${error.message}: params: ${paramStr}`
		: `${String(error)}: params: ${paramStr}`
}

/**
 * Creates a type-safe prepared statement
 */
// Update the factory function
export function createXStatementSync<P extends DataRow, RET = unknown>(
	props: CreateXStatementSyncProps<P>
): XStatementSync<P, RET> {
	return {
		all<R = RET>(params: ValuesParam<P> = {} as P) {
			try {
				const { stmt, namedParams, hasJsonColumns } = props.build(params as P)
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
					return results.map(row => parseJsonColumns(row as DataRow)) as R
				}

				if (typeof results === "object") {
					// Single object result case
					return parseJsonColumns(results as DataRow) as R
				}

				// Primitive value case
				return results as R
			} catch (error) {
				throw new NodeSqliteError(
					"ERR_SQLITE_QUERY",
					SqlitePrimaryResultCode.SQLITE_ERROR,
					"Query execution failed",
					createErrorMessage(error, params)
				)
			}
		},

		get<R = RET>(params: ValuesParam<P> = {} as P) {
			try {
				const { stmt, namedParams, hasJsonColumns } = props.build(params as P)
				const row = stmt.get(namedParams)

				if (!row) {
					return undefined
				}

				if (!hasJsonColumns) {
					return row as R
				}

				return parseJsonColumns(row as DataRow) as R
			} catch (error) {
				throw new NodeSqliteError(
					"ERR_SQLITE_QUERY",
					SqlitePrimaryResultCode.SQLITE_ERROR,
					"Query execution failed",
					createErrorMessage(error, params)
				)
			}
		},

		run(params: ValuesParam<P> = {} as P) {
			try {
				const { stmt, namedParams } = props.build(params as P)
				return stmt.run(namedParams)
			} catch (error) {
				throw new NodeSqliteError(
					"ERR_SQLITE_MUTATE",
					SqlitePrimaryResultCode.SQLITE_ERROR,
					"Mutation failed",
					createErrorMessage(error, params)
				)
			}
		},

		iter<R = RET>(params: ValuesParam<P> = {} as P): Iterable<R> & Iterator<R> {
			try {
				const { stmt, namedParams, hasJsonColumns } = props.build(params as P)
				// @ts-expect-error - @types/node is behind
				const baseIterator = stmt.iterate(namedParams)

				return {
					// Iterator protocol
					next(): IteratorResult<R> {
						const result = baseIterator.next()
						if (result.done) {
							return { done: true, value: undefined }
						}
						return {
							done: false,
							value: hasJsonColumns
								? (parseJsonColumns(result.value as DataRow) as R)
								: (result.value as R),
						}
					},

					// Iterable protocol
					[Symbol.iterator]() {
						return this
					},
				}
			} catch (error) {
				throw new NodeSqliteError(
					"ERR_SQLITE_QUERY",
					SqlitePrimaryResultCode.SQLITE_ERROR,
					"Query execution failed",
					createErrorMessage(error, params)
				)
			}
		},

		*rows<R = RET>(params: ValuesParam<P> = {} as P): Generator<R> {
			try {
				const { stmt, namedParams, hasJsonColumns } = props.build(params as P)
				// @ts-expect-error - @types/node is behind
				const iterator = stmt.iterate(namedParams)

				let result = iterator.next()
				while (!result.done) {
					const value = hasJsonColumns
						? (parseJsonColumns(result.value as DataRow) as R)
						: (result.value as R)
					yield value
					result = iterator.next()
				}
			} catch (error) {
				throw new NodeSqliteError(
					"ERR_SQLITE_QUERY",
					SqlitePrimaryResultCode.SQLITE_ERROR,
					"Query execution failed",
					createErrorMessage(error, params)
				)
			}
		},

		sourceSQL(params: ValuesParam<P> = {} as P) {
			try {
				const { stmt } = props.build(params as P)

				return stmt.sourceSQL
			} catch (error) {
				throw new NodeSqliteError(
					"ERR_SQLITE_QUERY",
					SqlitePrimaryResultCode.SQLITE_ERROR,
					"Failed to get expanded SQL",
					createErrorMessage(error, params)
				)
			}
		},

		expandedSQL(params: ValuesParam<P> = {} as P) {
			try {
				const { stmt } = props.build(params as P)
				return stmt.expandedSQL
			} catch (error) {
				throw new NodeSqliteError(
					"ERR_SQLITE_QUERY",
					SqlitePrimaryResultCode.SQLITE_ERROR,
					"Failed to get expanded SQL",
					createErrorMessage(error, params)
				)
			}
		},

		sql(strings: TemplateStringsArray, ...params: SqlTemplateValues<P>) {
			const newBuilder = new Sql({
				strings,
				paramOperators: params,
				generatedSql: props.sql.sql,
				formatterConfig: props.sql.formatterConfig,
			})
			return createXStatementSync({
				build: finalParams => {
					const {
						sql: sqlString,
						namedParams,
						hasJsonColumns,
					} = newBuilder.prepare(finalParams)
					const stmt = props.prepare(sqlString)
					return { stmt, namedParams, hasJsonColumns }
				},
				prepare: props.prepare,
				sql: newBuilder,
			})
		},
	}
}
