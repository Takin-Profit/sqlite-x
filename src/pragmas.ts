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
	tempStore: TempStore
	lockingMode: LockingMode
	busyTimeout: number
	foreignKeys: boolean
}>

export function validatePragmaConfig(config: unknown): ValidationError[] {
	const errors: ValidationError[] = []

	if (typeof config !== "object" || config === null) {
		return [validationErr({ msg: "PragmaConfig must be an object" })]
	}

	const pragmaConfig = config as object

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

	return errors
}

/**
 * Default pragma configurations for different environments
 */
export const PragmaDefaults: Record<
	"development" | "testing" | "production",
	PragmaConfig
> = {
	development: {
		journalMode: "WAL",
		synchronous: "NORMAL",
		cacheSize: -64000,
		tempStore: "MEMORY",
		lockingMode: "NORMAL",
		busyTimeout: 5000,
		foreignKeys: true,
	},
	testing: {
		journalMode: "WAL",
		synchronous: "OFF",
		cacheSize: -32000,
		tempStore: "MEMORY",
		lockingMode: "EXCLUSIVE",
		busyTimeout: 5000,
		foreignKeys: true,
	},
	production: {
		journalMode: "WAL",
		synchronous: "NORMAL",
		cacheSize: -64000,
		tempStore: "MEMORY",
		lockingMode: "NORMAL",
		busyTimeout: 10000,
		foreignKeys: true,
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

	return statements
}
