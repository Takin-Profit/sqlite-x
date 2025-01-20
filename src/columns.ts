// Copyright 2025 Takin Profit. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

// SQLite column types
export const SQLiteTypes = ["INTEGER", "REAL", "TEXT", "BLOB"] as const
export type SQLiteType = (typeof SQLiteTypes)[number]

// Map TypeScript types to valid SQLite types
type TypeToSQLite<T> = T extends string
	? "TEXT"
	: T extends number
		? "INTEGER" | "REAL"
		: T extends bigint | boolean
			? "INTEGER"
			: T extends Uint8Array | Buffer | object
				? "BLOB" | "TEXT"
				: "BLOB"

// Column configuration
export type ColumnConfig<T, K extends keyof T> = {
	name: K
	type: TypeToSQLite<T[K]>
	nullable?: T[K] extends undefined | null ? true : boolean
	unique?: boolean
	primaryKey?: boolean
	default?: T[K]
	check?: string
	references?: {
		table: string
		column: string
		onDelete?: "CASCADE" | "SET NULL" | "SET DEFAULT" | "RESTRICT"
		onUpdate?: "CASCADE" | "SET NULL" | "SET DEFAULT" | "RESTRICT"
	}
}

// Multiple columns configuration
export type ColumnsConfig<T> = {
	[K in keyof T]?: Omit<ColumnConfig<T, K>, "name">
}

// Column builder class for chaining
export class ColumnBuilder<T> {
	#definitions: string[] = []

	constructor(private formatter: (def: string) => string = (x) => x) {}

	column<K extends keyof T>(config: ColumnConfig<T, K>): this {
		const parts: string[] = [String(config.name), config.type]

		if (config.primaryKey) {
			parts.push("PRIMARY KEY")
		}
		if (!config.nullable) {
			parts.push("NOT NULL")
		}
		if (config.unique) {
			parts.push("UNIQUE")
		}

		if (config.default !== undefined) {
			const defaultValue =
				typeof config.default === "string"
					? `'${config.default}'`
					: String(config.default)
			parts.push(`DEFAULT ${defaultValue}`)
		}

		if (config.check) {
			parts.push(`CHECK (${config.check})`)
		}

		if (config.references) {
			const ref = config.references
			let constraint = `REFERENCES ${ref.table}(${ref.column})`
			if (ref.onDelete) {
				constraint += ` ON DELETE ${ref.onDelete}`
			}
			if (ref.onUpdate) {
				constraint += ` ON UPDATE ${ref.onUpdate}`
			}
			parts.push(constraint)
		}

		this.#definitions.push(parts.join(" "))
		return this
	}

	toString(): string {
		return this.formatter(this.#definitions.join(",\n  "))
	}
}

// Extended context type for DB class
export interface ColumnContext<T> {
	column: <K extends keyof T>(config: ColumnConfig<T, K>) => ColumnBuilder<T>
	columns: (config: ColumnsConfig<T>) => string
}

// Helper to build columns from object config
export function buildColumnsFromConfig<T>(config: ColumnsConfig<T>): string {
	const builder = new ColumnBuilder<T>()

	for (const [key, def] of Object.entries(config)) {
		builder.column({
			name: key as keyof T,
			...(def as Omit<ColumnConfig<T, keyof T>, "name">),
		})
	}

	return builder.toString()
}
