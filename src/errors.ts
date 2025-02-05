// Copyright 2025 Takin Profit. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

/**
 * SQLite primary result codes (least significant 8 bits)
 * @see https://www.sqlite.org/rescode.html
 */
export enum SqlitePrimaryResultCode {
	SQLITE_OK = 0,
	SQLITE_ERROR = 1,
	SQLITE_INTERNAL = 2,
	SQLITE_PERM = 3,
	SQLITE_ABORT = 4,
	SQLITE_BUSY = 5,
	SQLITE_LOCKED = 6,
	SQLITE_NOMEM = 7,
	SQLITE_READONLY = 8,
	SQLITE_INTERRUPT = 9,
	SQLITE_IOERR = 10,
	SQLITE_CORRUPT = 11,
	SQLITE_NOTFOUND = 12,
	SQLITE_FULL = 13,
	SQLITE_CANTOPEN = 14,
	SQLITE_PROTOCOL = 15,
	SQLITE_SCHEMA = 17,
	SQLITE_CONSTRAINT = 19,
	SQLITE_MISMATCH = 20,
	SQLITE_MISUSE = 21,
}

/**
 * Maps error codes to their type strings for better error reporting
 */
export const SqliteErrorTypes = {
	[SqlitePrimaryResultCode.SQLITE_OK]: "OK",
	[SqlitePrimaryResultCode.SQLITE_ERROR]: "ERROR",
	[SqlitePrimaryResultCode.SQLITE_INTERNAL]: "INTERNAL_ERROR",
	[SqlitePrimaryResultCode.SQLITE_PERM]: "PERMISSION_DENIED",
	[SqlitePrimaryResultCode.SQLITE_ABORT]: "OPERATION_ABORTED",
	[SqlitePrimaryResultCode.SQLITE_BUSY]: "DATABASE_BUSY",
	[SqlitePrimaryResultCode.SQLITE_LOCKED]: "DATABASE_LOCKED",
	[SqlitePrimaryResultCode.SQLITE_NOMEM]: "OUT_OF_MEMORY",
	[SqlitePrimaryResultCode.SQLITE_READONLY]: "DATABASE_READONLY",
	[SqlitePrimaryResultCode.SQLITE_INTERRUPT]: "OPERATION_INTERRUPTED",
	[SqlitePrimaryResultCode.SQLITE_IOERR]: "IO_ERROR",
	[SqlitePrimaryResultCode.SQLITE_CORRUPT]: "DATABASE_CORRUPT",
	[SqlitePrimaryResultCode.SQLITE_NOTFOUND]: "NOT_FOUND",
	[SqlitePrimaryResultCode.SQLITE_FULL]: "DATABASE_FULL",
	[SqlitePrimaryResultCode.SQLITE_CANTOPEN]: "CANNOT_OPEN",
	[SqlitePrimaryResultCode.SQLITE_PROTOCOL]: "PROTOCOL_ERROR",
	[SqlitePrimaryResultCode.SQLITE_SCHEMA]: "SCHEMA_CHANGED",
	[SqlitePrimaryResultCode.SQLITE_CONSTRAINT]: "CONSTRAINT_VIOLATION",
	[SqlitePrimaryResultCode.SQLITE_MISMATCH]: "TYPE_MISMATCH",
	[SqlitePrimaryResultCode.SQLITE_MISUSE]: "LIBRARY_MISUSE",
} as const

export type SqliteErrorType =
	(typeof SqliteErrorTypes)[keyof typeof SqliteErrorTypes]

/**
 * Error interface for node:sqlite errors
 */
export interface NodeSqliteErrorData {
	code: string
	errcode: number
	errstr: string
	message: string
	errorType: SqliteErrorType
	originalError?: Error
}

/**
 * Custom error class for node:sqlite errors with enhanced type information
 */
export class NodeSqliteError extends Error implements NodeSqliteErrorData {
	public readonly errorType: SqliteErrorType

	constructor(
		public readonly code: string,
		public readonly errcode: number,
		public readonly errstr: string,
		message: string,
		public readonly originalError?: Error
	) {
		super(message)
		this.name = "NodeSqliteError"
		this.errorType =
			SqliteErrorTypes[errcode as keyof typeof SqliteErrorTypes] || "ERROR"
		Object.setPrototypeOf(this, NodeSqliteError.prototype)
	}

	/**
	 * Gets the primary result code (least significant 8 bits)
	 */
	getPrimaryResultCode(): SqlitePrimaryResultCode {
		return this.errcode & 0xff
	}

	override toString(): string {
		return `NodeSqliteError: [${this.errorType}] ${this.message} (code: ${this.code}, errcode: ${this.errcode})`
	}

	static fromNodeSqlite(
		error: Error & {
					code?: string
			errcode?: number
			errstr?: string
		}
	): NodeSqliteError {
		return new NodeSqliteError(
			error.code || "ERR_SQLITE_ERROR",
			error.errcode || SqlitePrimaryResultCode.SQLITE_ERROR,
			error.errstr || "unknown error",
			error.message,
			error
		)
	}
}

export function isNodeSqliteError(error: unknown): error is NodeSqliteError {
	return (
		error instanceof NodeSqliteError ||
		(error instanceof Error &&
			"code" in error &&
			"errcode" in error &&
			"errstr" in error &&
			error.code === "ERR_SQLITE_ERROR")
	)
}
