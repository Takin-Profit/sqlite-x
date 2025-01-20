// Copyright 2025 Takin Profit. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

import {
	DatabaseSync,
	type SupportedValueType,
	type StatementSync,
} from "node:sqlite"
import type { UnknownRecord, PartialDeep } from "type-fest"
import {
	NodeSqliteError,
	SqlitePrimaryResultCode,
	isNodeSqliteError,
} from "./errors.js"
import {
	createStatementCache,
	type StatementCache,
	type CacheStats,
	type StatementCacheOptions,
} from "./cache.js"
import { join } from "node:path"
import {
	type PragmaConfig,
	PragmaDefaults,
	getPragmaStatements,
} from "./pragmas.js"
import { tmpdir } from "node:os"
import { accessSync, renameSync, unlinkSync } from "node:fs"
import { type Logger, NoopLogger } from "./logger.js"
import {
	buildColumnsFromConfig,
	ColumnBuilder,
	type ColumnConfig,
	type ColumnContext,
	type ColumnsConfig,
} from "#columns.js"

class Sql<P extends UnknownRecord> {
	constructor(
		readonly strings: readonly string[],
		readonly paramNames: ReadonlyArray<keyof P>,
		readonly defaultParams: PartialDeep<P> = {} as PartialDeep<P>
	) {}

	get sql(): string {
		const len = this.strings.length
		let i = 1
		let value = this.strings[0]
		while (i < len) {
			value += `?${this.strings[i++]}`
		}
		return value
	}

	withParams(params: P): { sql: string; values: SupportedValueType[] } {
		const values = this.paramNames.map((name) => {
			const value = params[name]
			if (value === undefined) {
				throw new NodeSqliteError(
					"ERR_SQLITE_PARAM",
					SqlitePrimaryResultCode.SQLITE_ERROR,
					"Missing parameter",
					`Parameter '${String(name)}' is undefined`,
					undefined
				)
			}
			return value as SupportedValueType
		})

		return { sql: this.sql, values }
	}
}

type SqlFn<P extends UnknownRecord> = (
	strings: TemplateStringsArray,
	...params: Array<keyof P> | string[]
) => Sql<P>

type QueryFunction<P extends UnknownRecord> = <R>(params: PartialDeep<P>) => R

export interface MutationResult {
	changes: number | bigint
	lastInsertRowid: number | bigint
}

export type MutationFunction<P extends UnknownRecord> = (
	params: PartialDeep<P>
) => MutationResult

export interface DBOptions {
	location?: string
	statementCache?: boolean | StatementCacheOptions
	pragma?: PragmaConfig
	environment?: "development" | "testing" | "production"
	logger?: Logger
}

export class DB {
	#db: DatabaseSync
	readonly #statementCache?: StatementCache
	readonly #location: string
	readonly #logger: Logger

	constructor(options: DBOptions = {}) {
		const location = options.location ?? ":memory:"
		this.#location = location
		this.#logger = options.logger ?? new NoopLogger()

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

	query<P extends UnknownRecord>(
		builder: (ctx: { sql: SqlFn<P> } & P) => Sql<P>
	): QueryFunction<P> {
		const sqlFn: SqlFn<P> = (strings, ...params) => {
			return new Sql<P>(strings, params)
		}

		return <R>(params: PartialDeep<P>): R => {
			const ctx = { sql: sqlFn, ...params } as { sql: SqlFn<P> } & P
			const statement = builder(ctx)
			const { sql, values } = statement.withParams(params as P)

			try {
				const stmt = this.prepareStatement(sql)
				return stmt.all(...values) as R
			} catch (error) {
				throw new NodeSqliteError(
					"ERR_SQLITE_QUERY",
					SqlitePrimaryResultCode.SQLITE_ERROR,
					"Query execution failed",
					error instanceof Error ? error.message : String(error),
					error instanceof Error ? error : undefined
				)
			}
		}
	}

	mutate<P extends UnknownRecord>(
		builder: (
			ctx: {
				sql: SqlFn<P>
				column: ColumnContext<P>["column"]
				columns: ColumnContext<P>["columns"]
			} & P
		) => Sql<P>
	): MutationFunction<P> {
		const sqlFn: SqlFn<P> = (strings, ...params) => {
			return new Sql<P>(strings, params)
		}

		return (params: PartialDeep<P>): MutationResult => {
			const columnBuilder = <K extends keyof P>(config: ColumnConfig<P, K>) =>
				new ColumnBuilder<P>()

			const ctx = {
				sql: sqlFn,
				column: columnBuilder,
				columns: (config: ColumnsConfig<P>) => buildColumnsFromConfig(config),
				...params,
			} as {
				sql: SqlFn<P>
				column: ColumnContext<P>["column"]
				columns: ColumnContext<P>["columns"]
			} & P

			const statement = builder(ctx)
			const { sql, values } = statement.withParams(params as P)

			try {
				const stmt = this.prepareStatement(sql)
				const result = stmt.run(...values)
				return {
					changes: result.changes,
					lastInsertRowid: result.lastInsertRowid,
				}
			} catch (error) {
				throw new NodeSqliteError(
					"ERR_SQLITE_MUTATE",
					SqlitePrimaryResultCode.SQLITE_ERROR,
					"Mutation failed",
					error instanceof Error ? error.message : String(error),
					error instanceof Error ? error : undefined
				)
			}
		}
	}

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

	getCacheStats(): CacheStats | undefined {
		this.#logger.debug("Retrieving cache statistics")
		return this.#statementCache?.getStats()
	}

	clearStatementCache(): void {
		if (this.#statementCache) {
			this.#logger.debug("Clearing statement cache")
			this.#statementCache.clear()
			this.#logger.debug("Statement cache cleared")
		}
	}

	close(): void {
		this.#logger.info("Closing database connection")
		this.clearStatementCache()
		this.#db.close()
		this.#logger.info("Database connection closed")
	}

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
					error.getPrimaryResultCode() === SqlitePrimaryResultCode.SQLITE_BUSY
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
