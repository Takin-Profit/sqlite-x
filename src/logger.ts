// Copyright 2025 Takin Profit. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

export enum LogLevel {
	ERROR = "error",
	WARN = "warn",
	INFO = "info",
	DEBUG = "debug",
	TRACE = "trace",
}

export type LogFn = (message: string, ...meta: unknown[]) => void

export interface Logger {
	error: LogFn
	warn: LogFn
	info: LogFn
	debug: LogFn
	trace: LogFn
}

export interface LogMessage {
	level: LogLevel
	message: string
	timestamp: string
	meta?: unknown[]
}

/**
 * Default logger that writes to console with timestamps
 */
export class ConsoleLogger implements Logger {
	#minLevel: LogLevel

	constructor(minLevel: LogLevel = LogLevel.INFO) {
		this.#minLevel = minLevel
	}

	#shouldLog(level: LogLevel): boolean {
		const levels = Object.values(LogLevel)
		return levels.indexOf(level) <= levels.indexOf(this.#minLevel)
	}

	#formatMessage(
		level: LogLevel,
		message: string,
		meta: unknown[] = []
	): LogMessage {
		return {
			level,
			message,
			timestamp: new Date().toISOString(),
			meta: meta.length > 0 ? meta : undefined,
		}
	}

	error(message: string, ...meta: unknown[]): void {
		if (this.#shouldLog(LogLevel.ERROR)) {
			console.error(this.#formatMessage(LogLevel.ERROR, message, meta))
		}
	}

	warn(message: string, ...meta: unknown[]): void {
		if (this.#shouldLog(LogLevel.WARN)) {
			console.warn(this.#formatMessage(LogLevel.WARN, message, meta))
		}
	}

	info(message: string, ...meta: unknown[]): void {
		if (this.#shouldLog(LogLevel.INFO)) {
			console.info(this.#formatMessage(LogLevel.INFO, message, meta))
		}
	}

	debug(message: string, ...meta: unknown[]): void {
		if (this.#shouldLog(LogLevel.DEBUG)) {
			console.debug(this.#formatMessage(LogLevel.DEBUG, message, meta))
		}
	}

	trace(message: string, ...meta: unknown[]): void {
		if (this.#shouldLog(LogLevel.TRACE)) {
			console.trace(this.#formatMessage(LogLevel.TRACE, message, meta))
		}
	}
}

/**
 * No-op logger that does nothing
 */
export class NoopLogger implements Logger {
	error = () => {}
	warn = () => {}
	info = () => {}
	debug = () => {}
	trace = () => {}
}
