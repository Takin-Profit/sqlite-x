// Copyright 2025 Takin Profit. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

// Copyright 2025 Takin Profit. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

import { DatabaseSync, type StatementSync } from "node:sqlite"
import {
	NodeSqliteError,
	SqlitePrimaryResultCode,
	isNodeSqliteError,
} from "#errors"
import {
	createStatementCache,
	type StatementCache,
	type CacheStats,
} from "#cache"
import { join } from "node:path"
import {
	type PragmaConfig,
	PragmaDefaults,
	getPragmaStatements,
} from "#pragmas"
import { tmpdir } from "node:os"
import { accessSync, renameSync, unlinkSync } from "node:fs"
import { type Logger, NoopLogger } from "#logger"
import {
	createXStatementSync,
	Sql,
	type SqlTemplateValues,
	type FormatterConfig,
} from "#sql"
import type { CleanupPragmas, DataRow, DBOptions } from "#types"
import { buildIndexStatement, type IndexDef } from "#idx.js"
import stringify from "#stringify.js"

/**
 * Type-safe SQLite database wrapper with prepared statement caching, SQL template literals,
 * and JSON support.
 */
export class DB {
	#db: DatabaseSync
	readonly #statementCache?: StatementCache
	readonly #location: string
	readonly #logger: Logger
	readonly #formatConfig?: FormatterConfig | false
	/**
	 * Creates a new database connection with optional configuration.
	 * @param options Database configuration options
	 * @throws {NodeSqliteError} If database cannot be opened or initialized
	 */

	constructor(options: DBOptions = {}) {
		const location = options.location ?? ":memory:"
		this.#location = location
		this.#logger = options.logger ?? new NoopLogger()
		this.#formatConfig = options.format

		this.#logger.debug("Initializing database", { location })

		try {
			this.#db = new DatabaseSync(location, { open: true })
			this.#logger.info("Database opened successfully", { location })

			// Configure pragmas based on environment and custom settings
			const environment = options.environment || "development"
			this.#logger.debug("Configuring pragmas", { environment })

			const defaultPragmas = PragmaDefaults[environment]
			const customPragmas = options.pragma || {}
			const finalPragmas: PragmaConfig = {
				...defaultPragmas,
				...customPragmas,
			}
			this.#configurePragmas(finalPragmas)

			// Initialize statement cache if enabled
			if (options.statementCache) {
				this.#logger.debug("Initializing statement cache")
				if (typeof options.statementCache === "object") {
					this.#statementCache = createStatementCache(options.statementCache)
					this.#logger.debug(
						"Created statement cache with custom options",
						options.statementCache
					)
				} else {
					this.#statementCache = createStatementCache({ maxSize: 1000 })
					this.#logger.debug("Created statement cache with default options")
				}
			}
		} catch (error) {
			this.#logger.error("Failed to initialize database", error)
			throw new NodeSqliteError(
				"ERR_SQLITE_OPEN",
				SqlitePrimaryResultCode.SQLITE_CANTOPEN,
				"Cannot open database",
				`Failed to open database at ${location}`,
				error instanceof Error ? error : undefined
			)
		}
	}
	/**
	 * Prepares an SQL statement with optional caching.
	 * @param sql The SQL statement to prepare
	 * @returns Prepared statement
	 * @throws {NodeSqliteError} If statement preparation fails
	 */

	prepareStatement(sql: string): StatementSync {
		this.#logger.debug("Preparing statement", { sql })
		try {
			if (this.#statementCache) {
				const cached = this.#statementCache.get(sql)
				if (cached) {
					this.#logger.trace("Statement cache hit", { sql })
					return cached
				}
				this.#logger.trace("Statement cache miss", { sql })
			}

			const stmt = this.#db.prepare(sql)
			this.#logger.trace("Statement prepared successfully", { sql })

			if (this.#statementCache) {
				this.#statementCache.set(sql, stmt)
				this.#logger.trace("Statement cached", { sql })
			}

			return stmt
		} catch (error) {
			if (
				this.#statementCache &&
				error instanceof Error &&
				error.message.toLowerCase().includes("memory")
			) {
				this.#logger.warn("Memory pressure detected, clearing statement cache")
				this.#statementCache.clear()
			}

			this.#logger.error("Failed to prepare statement", { sql, error })
			throw new NodeSqliteError(
				"ERR_SQLITE_PREPARE",
				SqlitePrimaryResultCode.SQLITE_ERROR,
				"Failed to prepare statement",
				error instanceof Error ? error.message : String(error),
				error instanceof Error ? error : undefined
			)
		}
	}
	/**
	 * Creates a type-safe SQL query builder using template literals.
	 * @param strings SQL template strings
	 * @param params SQL template parameters and contexts
	 * @returns Type-safe statement executor
	 */
	sql<P extends DataRow, R = unknown>(
		strings: TemplateStringsArray,
		...params: SqlTemplateValues<P>
	) {
		const builder = new Sql<P>({
			strings,
			paramOperators: params,
			formatterConfig: this.#formatConfig,
		})
		return createXStatementSync<P, R>({
			build: finalParams => {
				const { sql, namedParams, hasJsonColumns } =
					builder.prepare(finalParams)

				const stmt = this.prepareStatement(sql)

				return { stmt, namedParams, hasJsonColumns }
			},
			prepare: sql => this.prepareStatement(sql),
			sql: builder,
		})
	}

	createIndex<T extends DataRow>(def: IndexDef<T>): void {
		this.#logger.debug("Creating index", stringify(def))
		const stmt = buildIndexStatement(def)
		this.exec(stmt)
		this.#logger.info("Index created successfully", stringify(def))
	}

	/**
	 * Creates a backup of the database.
	 * @param filename Path where backup will be saved
	 * @throws {NodeSqliteError} If backup creation fails
	 */

	backup(filename: string): void {
		this.#logger.info("Starting database backup", { filename })
		try {
			this.#db.exec(`VACUUM INTO '${filename}'`)
			this.#logger.info("Database backup completed successfully", {
				filename,
			})
		} catch (error) {
			this.#logger.error("Backup failed", { filename, error })
			throw new NodeSqliteError(
				"ERR_SQLITE_BACKUP",
				SqlitePrimaryResultCode.SQLITE_CANTOPEN,
				"Cannot create backup file",
				`Failed to create backup at ${filename}. Check permissions and ensure directory exists.`,
				error instanceof Error ? error : undefined
			)
		}
	}

	/**
	 * Restores database from a backup file.
	 * @param filename Path to backup file
	 * @throws {NodeSqliteError} If restore fails or file is inaccessible
	 */

	restore(filename: string): void {
		this.#logger.info("Starting database restore", { filename })
		try {
			if (this.#location === ":memory:") {
				this.#logger.error("Cannot restore in-memory database")
				throw new NodeSqliteError(
					"ERR_SQLITE_RESTORE",
					SqlitePrimaryResultCode.SQLITE_MISUSE,
					"Cannot restore in-memory database",
					"Restore operation is not supported for in-memory databases",
					undefined
				)
			}

			try {
				accessSync(filename)
			} catch (error) {
				this.#logger.error("Backup file inaccessible", { filename, error })
				throw new NodeSqliteError(
					"ERR_SQLITE_CANTOPEN",
					SqlitePrimaryResultCode.SQLITE_CANTOPEN,
					"Cannot open backup file",
					`Failed to restore from ${filename}. File may not exist or be inaccessible.`,
					error instanceof Error ? error : undefined
				)
			}

			this.#logger.debug("Creating temporary backup")
			this.close()

			const tempBackup = join(tmpdir(), `temp-${Date.now()}.db`)
			try {
				renameSync(this.#location, tempBackup)
				this.#logger.debug("Created temporary backup", { tempBackup })

				renameSync(filename, this.#location)
				this.#logger.debug("Moved new database into place")

				this.#db = new DatabaseSync(this.#location, { open: true })
				this.#logger.debug("Opened restored database")

				unlinkSync(tempBackup)
				this.#logger.debug("Removed temporary backup")

				this.#logger.info("Database restore completed successfully")
			} catch (error) {
				this.#logger.error("Restore failed, attempting rollback", { error })
				if (error instanceof Error && error.message.includes("ENOENT")) {
					throw new NodeSqliteError(
						"ERR_SQLITE_CANTOPEN",
						SqlitePrimaryResultCode.SQLITE_CANTOPEN,
						"Cannot open backup file",
						`Failed to restore from ${filename}`,
						error
					)
				}
				throw error
			}
		} catch (error) {
			throw error instanceof NodeSqliteError
				? error
				: NodeSqliteError.fromNodeSqlite(
						error instanceof Error ? error : new Error(String(error))
					)
		}
	}

	/**
	 * Executes raw SQL directly.
	 * @param sql SQL statement to execute
	 * @throws {NodeSqliteError} If execution fails
	 */

	exec(sql: string): void {
		try {
			this.#logger.debug("Executing raw SQL", { sql })
			this.#db.exec(sql)
			this.#logger.trace("Raw SQL executed successfully", { sql })
		} catch (error) {
			this.#logger.error("Raw SQL execution failed", { sql, error })
			throw new NodeSqliteError(
				"ERR_SQLITE_EXEC",
				SqlitePrimaryResultCode.SQLITE_ERROR,
				"Execution failed",
				error instanceof Error ? error.message : String(error),
				error instanceof Error ? error : undefined
			)
		}
	}

	/**
	 * Retrieves prepared statement cache statistics.
	 * @returns Cache statistics if caching is enabled, undefined otherwise
	 */

	getCacheStats(): CacheStats | undefined {
		this.#logger.debug("Retrieving cache statistics")
		return this.#statementCache?.getStats()
	}

	/**
	 * Clears the prepared statement cache if enabled.
	 */

	clearStatementCache(): void {
		if (this.#statementCache) {
			this.#logger.debug("Clearing statement cache")
			this.#statementCache.clear()
			this.#logger.debug("Statement cache cleared")
		}
	}

	/**
	 * Closes database connection and optionally runs cleanup pragmas.
	 * @param pragmas Optional cleanup operations to perform before closing
	 */
	close(pragmas?: CleanupPragmas): void {
		this.#logger.info("Closing database connection", pragmas)

		try {
			if (pragmas) {
				if (pragmas.optimize) {
					this.#db.exec("PRAGMA optimize;")
				}
				if (pragmas.shrinkMemory) {
					this.#db.exec("PRAGMA shrink_memory;")
				}
				if (pragmas.walCheckpoint) {
					this.#db.exec(`PRAGMA wal_checkpoint(${pragmas.walCheckpoint});`)
				}
			}
		} catch (error) {
			this.#logger.error("Error executing cleanup pragmas", error)
		} finally {
			this.clearStatementCache()
			this.#db.close()
			this.#logger.info("Database connection closed")
		}
	}

	/**
	 * Configures database pragmas.
	 * @param config PRAGMA configuration settings
	 * @throws {NodeSqliteError} If pragma configuration fails
	 * @private
	 */

	#configurePragmas(config: PragmaConfig): void {
		try {
			this.#logger.debug("Configuring pragmas", config)
			const statements = getPragmaStatements(config)

			for (const stmt of statements) {
				this.#logger.trace("Executing pragma statement", { stmt })
				this.#db.exec(stmt)
			}

			this.#logger.debug("Pragma configuration completed")
		} catch (error) {
			this.#logger.error("Failed to configure pragmas", { error })
			if (isNodeSqliteError(error)) {
				if (
					NodeSqliteError.fromNodeSqlite(error).getPrimaryResultCode() ===
					SqlitePrimaryResultCode.SQLITE_BUSY
				) {
					throw new NodeSqliteError(
						"ERR_SQLITE_BUSY",
						SqlitePrimaryResultCode.SQLITE_BUSY,
						"Database is locked while configuring pragmas",
						"Failed to configure database pragmas: database is locked",
						error
					)
				}
				throw error
			}
			throw NodeSqliteError.fromNodeSqlite(
				error instanceof Error ? error : new Error(String(error))
			)
		}
	}
}
