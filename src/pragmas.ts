// Copyright 2025 Takin Profit. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

import { validationErr, type ValidationError } from "./validate.js"

export const JournalModes = [
	"DELETE",
	"TRUNCATE",
	"PERSIST",
	"MEMORY",
	"WAL",
	"OFF",
] as const
export type JournalMode = (typeof JournalModes)[number]

export const SynchronousModes = ["OFF", "NORMAL", "FULL", "EXTRA"] as const
export type SynchronousMode = (typeof SynchronousModes)[number]

export const TempStores = ["DEFAULT", "FILE", "MEMORY"] as const
export type TempStore = (typeof TempStores)[number]

export const LockingModes = ["NORMAL", "EXCLUSIVE"] as const
export type LockingMode = (typeof LockingModes)[number]

export type PragmaConfig = Partial<{
	journalMode: JournalMode
	synchronous: SynchronousMode
	cacheSize: number
	mmapSize: number
	tempStore: TempStore
	lockingMode: LockingMode
	busyTimeout: number
	foreignKeys: boolean
	walAutocheckpoint: number
	trustedSchema: boolean
}>

export function validatePragmaConfig(config: unknown): ValidationError[] {
	const errors: ValidationError[] = []

	if (typeof config !== "object" || config === null) {
		return [validationErr({ msg: "PragmaConfig must be an object" })]
	}

	const pragmaConfig = config as Record<string, unknown>

	if (
		"journalMode" in pragmaConfig &&
		!JournalModes.includes(pragmaConfig.journalMode as JournalMode)
	) {
		errors.push(
			validationErr({
				msg: `Invalid journal mode: ${pragmaConfig.journalMode}`,
				path: "journalMode",
			})
		)
	}

	if (
		"synchronous" in pragmaConfig &&
		!SynchronousModes.includes(pragmaConfig.synchronous as SynchronousMode)
	) {
		errors.push(
			validationErr({
				msg: `Invalid synchronous mode: ${pragmaConfig.synchronous}`,
				path: "synchronous",
			})
		)
	}

	if (
		"tempStore" in pragmaConfig &&
		!TempStores.includes(pragmaConfig.tempStore as TempStore)
	) {
		errors.push(
			validationErr({
				msg: `Invalid temp store: ${pragmaConfig.tempStore}`,
				path: "tempStore",
			})
		)
	}

	if (
		"lockingMode" in pragmaConfig &&
		!LockingModes.includes(pragmaConfig.lockingMode as LockingMode)
	) {
		errors.push(
			validationErr({
				msg: `Invalid locking mode: ${pragmaConfig.lockingMode}`,
				path: "lockingMode",
			})
		)
	}

	if (
		"cacheSize" in pragmaConfig &&
		typeof pragmaConfig.cacheSize !== "number"
	) {
		errors.push(
			validationErr({
				msg: "cacheSize must be a number",
				path: "cacheSize",
			})
		)
	}

	if ("mmapSize" in pragmaConfig && typeof pragmaConfig.mmapSize !== "number") {
		errors.push(
			validationErr({
				msg: "mmapSize must be a number",
				path: "mmapSize",
			})
		)
	}

	if (
		"busyTimeout" in pragmaConfig &&
		typeof pragmaConfig.busyTimeout !== "number"
	) {
		errors.push(
			validationErr({
				msg: "busyTimeout must be a number",
				path: "busyTimeout",
			})
		)
	}

	if (
		"foreignKeys" in pragmaConfig &&
		typeof pragmaConfig.foreignKeys !== "boolean"
	) {
		errors.push(
			validationErr({
				msg: "foreignKeys must be a boolean",
				path: "foreignKeys",
			})
		)
	}

	if (
		"walAutocheckpoint" in pragmaConfig &&
		typeof pragmaConfig.walAutocheckpoint !== "number"
	) {
		errors.push(
			validationErr({
				msg: "walAutocheckpoint must be a number",
				path: "walAutocheckpoint",
			})
		)
	}

	if (
		"trustedSchema" in pragmaConfig &&
		typeof pragmaConfig.trustedSchema !== "boolean"
	) {
		errors.push(
			validationErr({
				msg: "trustedSchema must be a boolean",
				path: "trustedSchema",
			})
		)
	}

	return errors
}

/**
 * Default pragma configurations for different environments
 */
export const PragmaDefaults: Record<
	"development" | "testing" | "production",
	PragmaConfig
> = {
	/**
	 * Development environment defaults - optimized for development workflow
	 */
	development: {
		journalMode: "WAL",
		synchronous: "NORMAL",
		cacheSize: -64000, // 64MB cache
		tempStore: "MEMORY",
		mmapSize: 64000000, // 64MB mmap
		lockingMode: "NORMAL",
		busyTimeout: 5000,
		foreignKeys: true,
		walAutocheckpoint: 1000,
		trustedSchema: true,
	},

	/**
	 * Testing environment defaults - optimized for in-memory testing
	 */
	testing: {
		journalMode: "WAL",
		synchronous: "OFF", // Less durable but faster for testing
		cacheSize: -32000, // 32MB cache is enough for testing
		tempStore: "MEMORY",
		lockingMode: "EXCLUSIVE", // Reduce lock conflicts
		busyTimeout: 5000,
		foreignKeys: true,
		walAutocheckpoint: 1000,
		trustedSchema: true,
	},

	/**
	 * Production environment defaults - optimized for durability and performance
	 */
	production: {
		journalMode: "WAL",
		synchronous: "NORMAL",
		cacheSize: -64000, // 64MB cache
		tempStore: "MEMORY",
		mmapSize: 268435456, // 256MB mmap
		lockingMode: "NORMAL",
		busyTimeout: 10000,
		foreignKeys: true,
		walAutocheckpoint: 1000,
		trustedSchema: false, // Safer default for production
	},
}

/**
 * Generates SQLite PRAGMA statements from configuration
 */
export function getPragmaStatements(config: PragmaConfig): string[] {
	const statements: string[] = []

	if (config.journalMode) {
		statements.push(`PRAGMA journal_mode=${config.journalMode};`)
	}

	if (config.synchronous) {
		statements.push(`PRAGMA synchronous=${config.synchronous};`)
	}

	if (config.cacheSize !== undefined) {
		statements.push(`PRAGMA cache_size=${config.cacheSize};`)
	}

	if (config.mmapSize !== undefined) {
		statements.push(`PRAGMA mmap_size=${config.mmapSize};`)
	}

	if (config.tempStore) {
		statements.push(`PRAGMA temp_store=${config.tempStore};`)
	}

	if (config.lockingMode) {
		statements.push(`PRAGMA locking_mode=${config.lockingMode};`)
	}

	if (config.busyTimeout !== undefined) {
		statements.push(`PRAGMA busy_timeout=${config.busyTimeout};`)
	}

	if (config.foreignKeys !== undefined) {
		statements.push(`PRAGMA foreign_keys=${config.foreignKeys ? "ON" : "OFF"};`)
	}

	if (config.walAutocheckpoint !== undefined) {
		statements.push(`PRAGMA wal_autocheckpoint=${config.walAutocheckpoint};`)
	}

	if (config.trustedSchema !== undefined) {
		statements.push(
			`PRAGMA trusted_schema=${config.trustedSchema ? "ON" : "OFF"};`
		)
	}

	return statements
}
