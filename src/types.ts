// Copyright 2025 Takin Profit. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.
import type { StatementSync } from "node:sqlite"
import type { Sql, XStatementSync } from "#sql"
import type { CacheStats, StatementCacheOptions } from "#cache"
import type { PragmaConfig } from "#pragmas"
import type { Logger } from "#logger"
import type { Primitive } from "type-fest"
import type { ForeignKeyDef } from "#fk"

/**
 * Configuration options for database cleanup operations when closing the connection.
 */
export interface CleanupPragmas {
	/** Runs PRAGMA optimize to optimize the database */
	optimize?: boolean

	/** Runs PRAGMA shrink_memory to release memory back to the system */
	shrinkMemory?: boolean

	/** WAL checkpoint mode to run before closing */
	walCheckpoint?: "PASSIVE" | "FULL" | "RESTART" | "TRUNCATE"
}

/**
 * Configuration options for database initialization.
 */
export interface DBOptions {
	/** Database file path or ":memory:" for in-memory database */
	location?: string | ":memory:"

	/** Statement cache configuration - boolean to use defaults or detailed options */
	statementCache?: boolean | StatementCacheOptions

	/** SQLite PRAGMA settings */
	pragma?: PragmaConfig

	/** Runtime environment affecting default PRAGMA settings */
	environment?: "development" | "testing" | "production"

	/** Custom logger implementation */
	logger?: Logger

	/** SQL formatting configuration */
	format?: FormatterConfig
}

/**
 * Function type for SQL template literal tag
 */
export type SqlFn<P extends DataRow> = (
	strings: TemplateStringsArray,
	...params: SqlTemplateValues<P>
) => Sql<P>

export interface IDatabase {
	prepareStatement(sql: string): StatementSync
	sql<P extends DataRow, R = unknown>(
		strings: TemplateStringsArray,
		...params: SqlTemplateValues<P>
	): XStatementSync<P, R>
	exec(sql: string): void
	backup(filename: string): void
	restore(filename: string): void
	getCacheStats(): CacheStats | undefined
	clearStatementCache(): void
	close(pragmas?: CleanupPragmas): void
}

export const COMPARISON_OPERATORS = [
	"=",
	"!=",
	">",
	"<",
	">=",
	"<=",
	"LIKE",
	"NOT LIKE",
	"IN",
	"NOT IN",
	"IS",
	"IS NOT",
] as const

export const LOGICAL_OPERATORS = ["AND", "OR"] as const

export type ComparisonOperator = (typeof COMPARISON_OPERATORS)[number]
export type LogicalOperator = (typeof LOGICAL_OPERATORS)[number]

/**
 * A row of data from a database query, or a row of data to be inserted, or a row of data used for query conditions.
 */
// biome-ignore lint/suspicious/noExplicitAny: <explanation>
export type DataRow = { [key: string]: any }

export type RawValue = { type: "__x_literal__"; value: string }

// Update isLiteral type guard
export function isRawValue(value: unknown): value is RawValue {
	return (
		typeof value === "object" &&
		value !== null &&
		Object.hasOwn(value, "type") &&
		(value as RawValue).type === "__x_literal__"
	)
}

/**
 * Represents a parameter operator that references a property of type P
 */
export type ParameterOperator<P extends DataRow> = `$${keyof P & string}`

// Step 2: Get keys of non-primitive values
export type NonPrimitiveKeys<T> = {
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

export type SqlTemplateValue<P extends DataRow, R = P> =
	| ParamValue<P>
	| SqlContext<P, R>
	| RawValue
	// biome-ignore lint/suspicious/noExplicitAny: <explanation>
	| XStatementSync<any, any>
/**
 * Parameter values and contexts that can be used in SQL template literals
 */
export type SqlTemplateValues<P extends DataRow, R = P> = Array<
	SqlTemplateValue<P, R>
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
export type SqlOptions<P extends DataRow, R = P> = {
	strings: readonly string[]
	paramOperators: SqlTemplateValues<P, R>
	formatterConfig?: FormatterConfig
	generatedSql?: string
}

export type ValueType<P extends DataRow> = ParameterOperator<P> | ToJson<P>

export type SetOptions<P extends DataRow> =
	| { [K in keyof P]?: ValueType<P> | RawValue }
	| ["*", { jsonColumns: (keyof P)[] }]
	| "*"

export type InsertOptions<P extends DataRow> =
	| ValueType<P>[]
	| "*"
	| ["*", { jsonColumns?: (keyof P)[]; batch?: boolean }]

export type ColumnOptions<P extends DataRow> =
	| (
			| keyof P
			| `${NonPrimitiveKeys<P> & string}${"<-json"}`
			| `${NonPrimitiveKeys<P> & string}${"->json"}`
	  )[]
	| "*"

// Core SQL context type
export type SqlContext<P extends DataRow, R = P> = Partial<{
	columns: ColumnOptions<P>
	values: InsertOptions<P>
	set: SetOptions<P>
	where: WhereClause<P>
	orderBy: Partial<Record<keyof P, "ASC" | "DESC">>
	limit: number
	offset: number
	returning: (keyof R)[] | "*" | ["*", { jsonColumns?: (keyof R)[] }]
	schema: Schema<P>
}>

export type SingleWhereCondition<P extends DataRow> =
	| `${keyof P & string} ${ComparisonOperator} $${keyof P & string}`
	| `${keyof P & string} IS NULL`
	| `${keyof P & string} IS NOT NULL`
	| [keyof P & string, ComparisonOperator, RawValue] // New tuple format for RawValue
// Recursive type to enforce alternating condition/operator pattern
export type ExtendedWhereCondition<P extends DataRow> =
	| [SingleWhereCondition<P>, LogicalOperator, SingleWhereCondition<P>]
	| [
			SingleWhereCondition<P>,
			LogicalOperator,
			SingleWhereCondition<P>,
			LogicalOperator,
			SingleWhereCondition<P>,
	  ]
	| [
			SingleWhereCondition<P>,
			LogicalOperator,
			SingleWhereCondition<P>,
			LogicalOperator,
			SingleWhereCondition<P>,
			LogicalOperator,
			SingleWhereCondition<P>,
	  ]
	| [
			SingleWhereCondition<P>,
			LogicalOperator,
			SingleWhereCondition<P>,
			LogicalOperator,
			SingleWhereCondition<P>,
			LogicalOperator,
			SingleWhereCondition<P>,
			LogicalOperator,
			SingleWhereCondition<P>,
	  ]
	| [
			SingleWhereCondition<P>,
			LogicalOperator,
			SingleWhereCondition<P>,
			LogicalOperator,
			SingleWhereCondition<P>,
			LogicalOperator,
			SingleWhereCondition<P>,
			LogicalOperator,
			SingleWhereCondition<P>,
			LogicalOperator,
			SingleWhereCondition<P>,
	  ]
	| [
			SingleWhereCondition<P>,
			LogicalOperator,
			SingleWhereCondition<P>,
			LogicalOperator,
			SingleWhereCondition<P>,
			LogicalOperator,
			SingleWhereCondition<P>,
			LogicalOperator,
			SingleWhereCondition<P>,
			LogicalOperator,
			SingleWhereCondition<P>,
			LogicalOperator,
			SingleWhereCondition<P>,
	  ]
	| [
			SingleWhereCondition<P>,
			LogicalOperator,
			SingleWhereCondition<P>,
			LogicalOperator,
			SingleWhereCondition<P>,
			LogicalOperator,
			SingleWhereCondition<P>,
			LogicalOperator,
			SingleWhereCondition<P>,
			LogicalOperator,
			SingleWhereCondition<P>,
			LogicalOperator,
			SingleWhereCondition<P>,
			LogicalOperator,
			SingleWhereCondition<P>,
	  ]
	| [
			SingleWhereCondition<P>,
			LogicalOperator,
			SingleWhereCondition<P>,
			LogicalOperator,
			SingleWhereCondition<P>,
			LogicalOperator,
			SingleWhereCondition<P>,
			LogicalOperator,
			SingleWhereCondition<P>,
			LogicalOperator,
			SingleWhereCondition<P>,
			LogicalOperator,
			SingleWhereCondition<P>,
			LogicalOperator,
			SingleWhereCondition<P>,
			LogicalOperator,
			SingleWhereCondition<P>,
	  ]
	| [
			SingleWhereCondition<P>,
			LogicalOperator,
			SingleWhereCondition<P>,
			LogicalOperator,
			SingleWhereCondition<P>,
			LogicalOperator,
			SingleWhereCondition<P>,
			LogicalOperator,
			SingleWhereCondition<P>,
			LogicalOperator,
			SingleWhereCondition<P>,
			LogicalOperator,
			SingleWhereCondition<P>,
			LogicalOperator,
			SingleWhereCondition<P>,
			LogicalOperator,
			SingleWhereCondition<P>,
			LogicalOperator,
			SingleWhereCondition<P>,
	  ]
	| [
			SingleWhereCondition<P>,
			LogicalOperator,
			SingleWhereCondition<P>,
			LogicalOperator,
			SingleWhereCondition<P>,
			LogicalOperator,
			SingleWhereCondition<P>,
			LogicalOperator,
			SingleWhereCondition<P>,
			LogicalOperator,
			SingleWhereCondition<P>,
			LogicalOperator,
			SingleWhereCondition<P>,
			LogicalOperator,
			SingleWhereCondition<P>,
			LogicalOperator,
			SingleWhereCondition<P>,
			LogicalOperator,
			SingleWhereCondition<P>,
			LogicalOperator,
			SingleWhereCondition<P>,
	  ]

/**
 * Represents a WHERE clause condition for SQL queries with strongly-typed column references and parameter bindings.
 * Supports single conditions and compound conditions with logical operators (AND/OR).
 * @example
 * // Single condition
 * const where: WhereClause<User> = "age > $minAge"
 *
 * // Compound condition
 * const where: WhereClause<User> = ["age > $minAge", "AND", "isActive = $active"]
 */
export type WhereClause<P extends DataRow> =
	| SingleWhereCondition<P>
	| ExtendedWhereCondition<P>

/**
 * SQLite column constraints for table definitions
 */
export type BaseConstraint =
	| "PRIMARY KEY"
	| "AUTOINCREMENT"
	| "UNIQUE"
	| `CHECK(${string})`
	| `CHECK (${string})` // Support both with and without space
	| `FOREIGN KEY REFERENCES ${string} (${string})`
	| `DEFAULT ${string}`
	| "NOT NULL"
/**
 * SQLite storage classes (data types)
 * @see https://www.sqlite.org/datatype3.html
 */
export type DataType = "TEXT" | "INTEGER" | "REAL" | "BLOB"

/**
 * Patterns for combining data types with constraints based on nullability
 * @template T Field type
 * @template D SQLite data type
 */
export type ConstraintPatterns<T, D extends DataType> = undefined extends T
	?
			| `${D} ${BaseConstraint}`
			| `${D} ${BaseConstraint} ${Exclude<BaseConstraint, "NOT NULL">}`
			| `${D} ${BaseConstraint} ${Exclude<BaseConstraint, "NOT NULL">} ${Exclude<BaseConstraint, "NOT NULL">}`
	:
			| `${D} ${BaseConstraint}`
			| `${D} ${BaseConstraint} ${BaseConstraint}`
			| `${D} ${BaseConstraint} ${BaseConstraint} ${BaseConstraint}`

/**
 * Maps TypeScript types to valid SQLite column definitions with constraints
 * @template T The TypeScript type to map
 */
export type ValidColumnTypeMap<T> = T extends string
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

/**
 * Type-safe column definitions for a table
 * @template T Table row type
 */
export type Schema<T extends DataRow> = {
	[K in keyof T]?: ValidColumnTypeMap<T[K]>
} & { $$foreignKeys?: ForeignKeyDef<T>[] }
