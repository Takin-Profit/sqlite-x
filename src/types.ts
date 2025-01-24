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

export type CleanupPragmas = {
	optimize?: boolean
	shrinkMemory?: boolean
	walCheckpoint?: "PASSIVE" | "FULL" | "RESTART" | "TRUNCATE"
}

export interface DBOptions {
	location?: string | ":memory:"
	statementCache?: boolean | StatementCacheOptions
	pragma?: PragmaConfig
	environment?: "development" | "testing" | "production"
	logger?: Logger
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
