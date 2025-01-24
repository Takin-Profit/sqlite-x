// Copyright 2025 Takin Profit. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.
import type { StatementSync } from "node:sqlite"
import type {
	FormatterConfig,
	Sql,
	SqlTemplateValues,
	XStatementSync,
} from "#sql"
import type { CacheStats, StatementCacheOptions } from "#cache"
import type { PragmaConfig } from "#pragmas"
import type { Logger } from "#logger"

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
