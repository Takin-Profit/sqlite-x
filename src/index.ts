/**
 * @module @takinprofit/sqlitex
 *
 * A type-safe SQLite query builder and database wrapper for Node.js
 *
 * Features:
 * - Type-safe SQL template literals
 * - Prepared statement caching
 * - JSON column support
 * - Strongly typed table schemas
 * - SQL query composition
 * - Full SQLite PRAGMA configuration
 *
 * @example
 * ```ts
 * import { DB } from '@takinprofit/sqlitex'
 *
 * const db = new DB({ location: ':memory:' })
 *
 * // Type-safe queries
 * const users = db.sql<{id: number}>`
 *   SELECT * FROM users
 *   WHERE id = ${'$id'}
 * `
 * const result = users.get({ id: 1 })
 * ```
 *
 * @see {@link https://github.com/takinprofit/sqlitex/blob/main/README.md|Documentation}
 */
export type { WhereClause } from "#where"
export type { ValidationError } from "#validate"
export type { CleanupPragmas, DBOptions, SqlFn, DataRow } from "#types"
export { Sql } from "#sql"
export type {
	XStatementSync,
	SqlOptions,
	FormatterConfig,
	SqlTemplateValues,
} from "#sql"

export { PragmaDefaults } from "#pragmas"
export type {
	JournalMode,
	JournalModes,
	SynchronousMode,
	SynchronousModes,
	TempStore,
	TempStores,
	LockingMode,
	LockingModes,
} from "#pragmas"

export type { SqlContext } from "#context"

export type {
	Columns,
	ValidColumnTypeMap,
	ConstraintPatterns,
	DataType,
	BaseConstraint,
} from "#columns"

export { DB } from "#database"

export * from "#logger"
export * from "#errors"
