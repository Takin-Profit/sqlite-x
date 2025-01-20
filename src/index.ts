import { DatabaseSync, type StatementSync } from "node:sqlite"

export type SupportedValue = null | number | bigint | string | Uint8Array
type SqlParameter = SupportedValue | SupportedValue[]
export type Row = Record<string, SupportedValue>

// Helper type to ensure all properties are SQLite compatible
type SQLiteCompatible<T> = {
	[K in keyof T]: T[K] extends SupportedValue ? T[K] : never
}

type ColumnType<T, K> = readonly K[] | readonly ["*"]

// Type-safe comparison operators
export type ComparisonOperator =
	| "="
	| "!="
	| ">"
	| "<"
	| ">="
	| "<="
	| "LIKE"
	| "NOT LIKE"
	| "IN"
	| "NOT IN"
	| "IS"
	| "IS NOT"

export type LogicalOperator = "AND" | "OR"

export type WhereCondition<T> = [
	keyof T,
	ComparisonOperator,
	T[keyof T] | Array<T[keyof T]>,
]

// Allow nesting of `Where<T>` itself as a valid type
export type ComplexWhereCondition<T> = Array<
	WhereCondition<T> | LogicalOperator | Where<T>
>

// Union type for all possible where inputs
export type Where<T> = WhereCondition<T> | ComplexWhereCondition<T>

// Type guard for where condition tuple
function isWhereCondition<T>(value: unknown): value is WhereCondition<T> {
	return (
		Array.isArray(value) && value.length === 3 && typeof value[1] === "string"
	)
}

// Type guard for logical operator
function isLogicalOperator(value: unknown): value is LogicalOperator {
	return value === "AND" || value === "OR"
}

function buildWhereClause<T>(where: Where<T>): {
	sql: string
	params: SupportedValue[]
} {
	console.debug(
		"Building WHERE clause with input:",
		JSON.stringify(where, null, 2)
	)

	// Handle single condition
	if (isWhereCondition<T>(where)) {
		const [field, operator, value] = where
		console.debug("Processing single condition:", { field, operator, value })

		if (operator === "IN" || operator === "NOT IN") {
			if (!Array.isArray(value)) {
				throw new Error(`Operator ${operator} requires an array value`)
			}
			const placeholders = value.map(() => "?").join(", ")
			return {
				sql: `${String(field)} ${operator} (${placeholders})`,
				params: value as SupportedValue[],
			}
		}

		if (operator === "IS" || operator === "IS NOT") {
			if (value !== null) {
				throw new Error(`Operator ${operator} only works with NULL values`)
			}
			return {
				sql: `${String(field)} ${operator} NULL`,
				params: [],
			}
		}

		return {
			sql: `${String(field)} ${operator} ?`,
			params: [value as SupportedValue],
		}
	}

	// Handle complex conditions
	const parts: string[] = []
	const params: SupportedValue[] = []
	let currentOperator: LogicalOperator | null = null

	for (const item of where) {
		if (isLogicalOperator(item)) {
			currentOperator = item // Set the logical operator for subsequent conditions
		} else if (Array.isArray(item)) {
			// Recursive handling for nested conditions
			const { sql, params: nestedParams } = buildWhereClause(item as Where<T>)
			if (currentOperator) {
				parts.push(currentOperator)
				currentOperator = null
			}
			parts.push(`(${sql})`)
			params.push(...nestedParams)
		} else {
			throw new Error(`Invalid condition or operator: ${JSON.stringify(item)}`)
		}
	}

	if (parts.length === 0) {
		throw new Error("Invalid where clause: no valid conditions found")
	}

	const sql = parts.join(" ")
	console.debug("Final WHERE clause parts:", parts)
	console.debug("Final WHERE clause SQL:", sql)
	console.debug("Final WHERE clause params:", params)

	return { sql, params }
}
// Query builder with type safety
export class Query<T = Row> {
	constructor(
		private sql: string,
		private params: SupportedValue[] = []
	) {}

	where(condition: Where<T>): Query<T> {
		const { sql: whereSql, params: whereParams } = buildWhereClause(condition)
		return new Query<T>(`${this.sql} WHERE ${whereSql}`, [
			...this.params,
			...whereParams,
		])
	}

	and(condition: Where<T>): Query<T> {
		const { sql: whereSql, params: whereParams } = buildWhereClause(condition)
		return new Query<T>(`${this.sql} AND ${whereSql}`, [
			...this.params,
			...whereParams,
		])
	}

	or(condition: Where<T>): Query<T> {
		const { sql: whereSql, params: whereParams } = buildWhereClause(condition)
		return new Query<T>(`${this.sql} OR ${whereSql}`, [
			...this.params,
			...whereParams,
		])
	}

	text(): string {
		return this.sql
	}

	values(): SupportedValue[] {
		return this.params
	}
}

// Enhanced database class
export class Database {
	private db: DatabaseSync
	private transactionDepth = 0

	constructor(filename: string) {
		this.db = new DatabaseSync(filename)
	}

	table<T>(name: string): Table<SQLiteCompatible<T>> {
		return new Table<SQLiteCompatible<T>>(this, name)
	}

	query<T = Row>(query: Query<T>): T[] {
		const stmt = this.db.prepare(query.text())
		return stmt.all(...query.values()) as T[]
	}

	queryOne<T = Row>(query: Query<T>): T | undefined {
		const stmt = this.db.prepare(query.text())
		const result = stmt.get(...query.values())
		return result as T | undefined
	}

	transaction<T>(fn: (db: Database) => T): T {
		const isOutermostTransaction = this.transactionDepth === 0
		this.transactionDepth++

		try {
			if (isOutermostTransaction) {
				this.db.exec("BEGIN")
			} else {
				this.db.exec(`SAVEPOINT sp_${this.transactionDepth}`)
			}

			const result = fn(this)

			if (isOutermostTransaction) {
				this.db.exec("COMMIT")
			} else {
				this.db.exec(`RELEASE sp_${this.transactionDepth}`)
			}

			return result
		} catch (error) {
			if (isOutermostTransaction) {
				this.db.exec("ROLLBACK")
			} else {
				this.db.exec(`ROLLBACK TO sp_${this.transactionDepth}`)
			}
			throw error
		} finally {
			this.transactionDepth--
		}
	}

	prepare<T = Row>(sql: string): PreparedStatement<T> {
		return new PreparedStatement<T>(this.db.prepare(sql))
	}

	exec(sql: string): void {
		this.db.exec(sql)
	}

	close(): void {
		this.db.close()
	}
}

export class Table<T> {
	constructor(
		private db: Database,
		private tableName: string
	) {}

	insert(data: Partial<T>): T[] {
		const columns = Object.keys(data)
		const values = Object.values(data).filter(
			(v): v is SupportedValue => v !== undefined
		)
		const placeholders = Array(values.length).fill("?").join(",")

		const query = new Query<T>(
			`INSERT INTO ${this.tableName} (${columns.join(",")}) VALUES (${placeholders}) RETURNING *`,
			values
		)

		return this.db.query<T>(query)
	}

	insertOne(data: Partial<T>): T | undefined {
		return this.insert(data)[0]
	}

	update(params: {
		data: Partial<T>
		where: Where<T>
	}): T[] {
		const { data, where } = params
		const sets = Object.keys(data)
			.map((key) => `${key} = ?`)
			.join(",")
		const values = Object.values(data).filter(
			(v): v is SupportedValue => v !== undefined
		)

		const whereClause = buildWhereClause(where)
		const query = new Query<T>(
			`UPDATE ${this.tableName} SET ${sets} WHERE ${whereClause.sql} RETURNING *`,
			[...values, ...whereClause.params]
		)

		return this.db.query<T>(query)
	}

	updateOne(params: {
		data: Partial<T>
		where: Where<T>
	}): T | undefined {
		return this.update(params)[0]
	}

	select<K extends keyof T>(params?: {
		columns?: ColumnType<T, K>
		where?: Where<T>
	}): Pick<T, K>[] {
		const { columns = ["*"] as ColumnType<T, K>, where } = params || {}

		let baseQuery = ""
		let values: SupportedValue[] = []

		if (columns.length === 1 && columns[0] === "*") {
			baseQuery = `SELECT * FROM ${this.tableName}`
		} else {
			const columnsList = (columns as K[]).join(",")
			baseQuery = `SELECT ${columnsList} FROM ${this.tableName}`
		}

		if (where) {
			const whereClause = buildWhereClause(where)
			baseQuery += ` WHERE ${whereClause.sql}`
			values = whereClause.params
		}

		const query = new Query<Pick<T, K>>(baseQuery, values)
		const rawResults = this.db.query(query)

		if (columns.length === 1 && columns[0] === "*") {
			return rawResults
		}

		return rawResults.map((row) => {
			const filteredRow = Object.create(null) as Pick<T, K>
			for (const col of columns as K[]) {
				if (col !== "*" && col in row) {
					const value = row[col as keyof typeof row]
					if (value !== undefined) {
						;(filteredRow[col] as T[K]) = value as T[K]
					}
				}
			}
			return filteredRow
		})
	}

	selectOne<K extends keyof T>(params?: {
		columns?: ColumnType<T, K>
		where?: Where<T>
	}): Pick<T, K> | undefined {
		return this.select(params)[0]
	}

	delete(params: { where: Where<T> }): void {
		const whereClause = buildWhereClause(params.where)
		const query = new Query(
			`DELETE FROM ${this.tableName} WHERE ${whereClause.sql}`,
			whereClause.params
		)
		this.db.query(query)
	}

	query<R = T>(query: Query<R>): R[] {
		return this.db.query<R>(query)
	}

	queryOne<R = T>(query: Query<R>): R | undefined {
		return this.db.queryOne<R>(query)
	}
}

export class PreparedStatement<T = Row> {
	constructor(private stmt: StatementSync) {}

	all(...params: SupportedValue[]): T[] {
		return this.stmt.all(...params) as T[]
	}

	get(...params: SupportedValue[]): T | undefined {
		const result = this.stmt.get(...params)
		return result as T | undefined
	}

	run(...params: SupportedValue[]): {
		changes: number | bigint
		lastInsertRowid: number | bigint
	} {
		return this.stmt.run(...params)
	}
}

export function sql<T = Row>(
	strings: TemplateStringsArray,
	...values: SqlParameter[]
): Query<T> {
	let sqlText = ""
	const params: SupportedValue[] = []

	for (let i = 0; i < strings.length; i++) {
		sqlText += strings[i]
		if (i < values.length && values[i] !== undefined) {
			const value = values[i]
			if (Array.isArray(value)) {
				if (value.length === 0) {
					sqlText += "(NULL)"
				} else {
					const validValues = value.filter(
						(v): v is SupportedValue => v !== undefined
					)
					sqlText += `(${validValues.map(() => "?").join(",")})`
					params.push(...validValues)
				}
			} else {
				sqlText += "?"
				params.push(value as SupportedValue)
			}
		}
	}

	return new Query<T>(sqlText, params)
}
