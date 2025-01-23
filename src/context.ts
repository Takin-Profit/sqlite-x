// Copyright 2025 Takin Profit. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

import { validateColumns, type Columns } from "#columns.js"
import { NodeSqliteError, SqlitePrimaryResultCode } from "#errors"
import type { ToJson, ParameterOperator } from "#sql"
import {
	COMPARISON_OPERATORS,
	type DataRow,
	LOGICAL_OPERATORS,
	type LogicalOperator,
} from "#types"
import { validationErr, type ValidationError } from "#validate"
import type { WhereClause } from "#where"

export type ValueType<P extends DataRow> = ParameterOperator<P> | ToJson<P>

type ValuesWithJsonColumns<P extends DataRow> = [
	"*",
	{ jsonColumns: (keyof P)[] },
]

export type InsertOrSetOptions<P extends DataRow> =
	| ValueType<P>[]
	| "*"
	| ValuesWithJsonColumns<P>

// Core SQL context type
type SqlContext<P extends DataRow> = Partial<{
	values: InsertOrSetOptions<P>
	set: InsertOrSetOptions<P>
	where: WhereClause<P>
	orderBy: Partial<Record<keyof P, "ASC" | "DESC">>
	limit: number
	offset: number
	returning: (keyof P)[] | "*"
	columns: Columns<P>
}>

export function validateSqlContext<P extends DataRow>(
	value: unknown
): ValidationError[] {
	const errors: ValidationError[] = []

	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return [validationErr({ msg: "SqlContext must be an object" })]
	}

	const context = value as Record<string, unknown>

	for (const key in context) {
		switch (key) {
			case "values":
			case "set": {
				const valueErrors = validateInsertOrSetOptions<P>(context[key])
				if (valueErrors.length > 0) {
					errors.push(
						...valueErrors.map((err) => ({
							...err,
							path: `${key}${err.path ? `.${err.path}` : ""}`,
						}))
					)
				}
				break
			}

			case "where": {
				const whereErrors = validateWhereClause<P>(context[key])
				if (whereErrors.length > 0) {
					errors.push(
						...whereErrors.map((err) => ({
							...err,
							path: `where${err.path ? `.${err.path}` : ""}`,
						}))
					)
				}
				break
			}

			case "orderBy": {
				const orderErrors = validateOrderByClause(context[key])
				if (orderErrors.length > 0) {
					errors.push(
						...orderErrors.map((err) => ({
							...err,
							path: `orderBy${err.path ? `.${err.path}` : ""}`,
						}))
					)
				}
				break
			}

			case "limit":
			case "offset":
				if (typeof context[key] !== "number") {
					errors.push(
						validationErr({
							msg: `${key} must be a number`,
							path: key,
						})
					)
				}
				break
			case "columns": {
				const columnErrors = validateColumns<P>(context[key])
				if (columnErrors.length > 0) {
					errors.push(
						...columnErrors.map((err) => ({
							...err,
							path: `columns${err.path ? `.${err.path}` : ""}`,
						}))
					)
				}
				break
			}

			case "returning": {
				const value = context[key]
				if (value !== "*" && !Array.isArray(value)) {
					errors.push(
						validationErr({
							msg: "returning must be '*' or an array",
							path: "returning",
						})
					)
				} else if (
					Array.isArray(value) &&
					!value.every((item) => typeof item === "string")
				) {
					errors.push(
						validationErr({
							msg: "returning array must contain only strings",
							path: "returning",
						})
					)
				}
				break
			}

			default:
				errors.push(
					validationErr({
						msg: `Unknown property: ${key}`,
						path: key,
					})
				)
		}
	}

	return errors
}

function validateInsertOrSetOptions<P extends DataRow>(
	value: unknown
): ValidationError[] {
	if (value === "*") {
		return []
	}

	if (!Array.isArray(value)) {
		return [validationErr({ msg: "Must be '*' or an array" })]
	}

	// Check if it's a ValuesWithJsonColumns tuple
	if (value.length === 2 && value[0] === "*") {
		const [, jsonConfig] = value
		if (!isJsonColumnsObject(jsonConfig)) {
			return [
				validationErr({
					msg: "Invalid JSON columns configuration",
					path: "[1]",
				}),
			]
		}
		return []
	}

	// Validate ValueType array format
	const errors: ValidationError[] = []
	value.forEach((item, index) => {
		if (typeof item !== "string") {
			errors.push(
				validationErr({
					msg: "Parameter operator must be a string",
					path: `[${index}]`,
				})
			)
		} else if (!isValidValueType(item)) {
			errors.push(
				validationErr({
					msg: "Invalid parameter operator format",
					path: `[${index}]`,
				})
			)
		}
	})

	return errors
}

function validateWhereClause<P extends DataRow>(
	value: unknown
): ValidationError[] {
	if (typeof value !== "string" && !Array.isArray(value)) {
		return [validationErr({ msg: "Where clause must be a string or array" })]
	}

	if (typeof value === "string") {
		// Validate single condition
		if (!isValidSingleWhereCondition(value)) {
			return [validationErr({ msg: "Invalid where condition format" })]
		}
		return []
	}

	// Validate array format
	const errors: ValidationError[] = []
	for (let i = 0; i < value.length; i++) {
		const item = value[i]
		if (i % 2 === 0) {
			// Should be a condition
			if (!isValidSingleWhereCondition(item)) {
				errors.push(
					validationErr({
						msg: "Invalid where condition format",
						path: `[${i}]`,
					})
				)
			}
		} else if (!LOGICAL_OPERATORS.includes(item as LogicalOperator)) {
			errors.push(
				validationErr({
					msg: "Invalid logical operator",
					path: `[${i}]`,
				})
			)
		}
	}
	return errors
}

function validateOrderByClause(value: unknown): ValidationError[] {
	if (typeof value !== "object" || value === null) {
		return [
			validationErr({
				msg: "orderBy must be an object",
			}),
		]
	}

	const errors: ValidationError[] = []
	for (const [key, direction] of Object.entries(value)) {
		if (direction !== "ASC" && direction !== "DESC") {
			errors.push(
				validationErr({
					msg: "Order direction must be 'ASC' or 'DESC'",
					path: key,
				})
			)
		}
	}

	return errors
}

function isValidSingleWhereCondition(value: unknown): boolean {
	if (typeof value !== "string") {
		return false
	}

	// Match basic pattern: "column operator $param" or "column IS [NOT] NULL"
	const basicPattern = new RegExp(
		`^[\\w]+\\s+(${COMPARISON_OPERATORS.join("|")})\\s+\\$[\\w]+$|^[\\w]+\\s+IS(\\s+NOT)?\\s+NULL$`
	)
	return basicPattern.test(value)
}

function isValidValueType(value: string): boolean {
	return (
		value.startsWith("$") &&
		(value.includes(".toJson") ? value.endsWith(".toJson") : true)
	)
}

function isJsonColumnsObject(
	value: unknown
): value is { jsonColumns: string[] } {
	return (
		typeof value === "object" &&
		value !== null &&
		"jsonColumns" in value &&
		Array.isArray((value as { jsonColumns: unknown }).jsonColumns) &&
		(value as { jsonColumns: unknown[] }).jsonColumns.every(
			(col) => typeof col === "string"
		)
	)
}

export function isSqlContext<P extends DataRow>(
	value: unknown
): value is SqlContext<P> {
	return validateSqlContext<P>(value).length === 0
}

export type { SqlContext }

type ContextValidationError = {
	type: "DUPLICATE_CLAUSE" | "INCOMPATIBLE_CLAUSE" | "INVALID_COMBINATION"
	message: string
	clauses?: string[]
}

export function validateContextCombination<P extends DataRow>(
	contexts: SqlContext<P>[]
): ContextValidationError[] {
	const errors: ContextValidationError[] = []

	// Track which clauses we've seen
	const seenClauses = new Set<keyof SqlContext<P>>()

	// These clauses can only appear once
	const uniqueClauses = new Set([
		"values",
		"set",
		"returning",
		"limit",
		"offset",
	])

	// Track clause combinations that don't make sense together
	const incompatiblePairs = new Map([
		["values", new Set(["set"])],
		["set", new Set(["values"])],
	])

	// Check for duplicate clauses and track what we've seen
	for (const context of contexts) {
		for (const [clause, value] of Object.entries(context)) {
			if (value === undefined) {
				continue
			}

			const clauseKey = clause as keyof SqlContext<P>

			// Check if this is a unique clause that we've seen before
			if (uniqueClauses.has(clauseKey) && seenClauses.has(clauseKey)) {
				errors.push({
					type: "DUPLICATE_CLAUSE",
					message: `Clause "${clause}" cannot appear multiple times in a SQL statement`,
					clauses: [clause],
				})
			}

			// Check for incompatible clause combinations
			const incompatibleWith = incompatiblePairs.get(clause)
			if (incompatibleWith) {
				for (const otherClause of incompatibleWith) {
					if (seenClauses.has(otherClause as keyof SqlContext<P>)) {
						errors.push({
							type: "INCOMPATIBLE_CLAUSE",
							message: `Clauses "${clause}" and "${otherClause}" cannot be used together`,
							clauses: [clause, otherClause],
						})
					}
				}
			}

			seenClauses.add(clauseKey)
		}
	}

	return errors
}

export function combineContexts<P extends DataRow>(
	contexts: SqlContext<P>[]
): SqlContext<P> {
	// First validate the combination
	const errors = validateContextCombination(contexts)
	if (errors.length > 0) {
		throw new NodeSqliteError(
			"ERR_SQLITE_CONTEXT",
			SqlitePrimaryResultCode.SQLITE_MISUSE,
			"Invalid SQL context combination",
			errors.map((e) => e.message).join("\n"),
			undefined
		)
	}

	// Helper function to combine where clauses safely
	const combineWhereClauses = (
		clause1: WhereClause<P> | undefined,
		clause2: WhereClause<P> | undefined
	): WhereClause<P> | undefined => {
		if (!clause1) {
			return clause2
		}
		if (!clause2) {
			return clause1
		}

		const clause1Array = Array.isArray(clause1) ? clause1 : [clause1]
		const clause2Array = Array.isArray(clause2) ? clause2 : [clause2]

		// Ensure we're not exceeding the maximum allowed conditions
		return [...clause1Array, "AND", ...clause2Array] as WhereClause<P>
	}

	// Helper function to combine orderBy clauses safely
	const combineOrderByClauses = (
		orderBy1: Partial<Record<keyof P, "ASC" | "DESC">> | undefined,
		orderBy2: Partial<Record<keyof P, "ASC" | "DESC">> | undefined
	): Partial<Record<keyof P, "ASC" | "DESC">> | undefined => {
		if (!orderBy1) {
			return orderBy2
		}
		if (!orderBy2) {
			return orderBy1
		}

		return {
			...orderBy1,
			...orderBy2,
		} as Partial<Record<keyof P, "ASC" | "DESC">>
	}

	return contexts.reduce<SqlContext<P>>(
		(combined, current) => {
			// Create new object with explicit property assignments
			const result: SqlContext<P> = {}

			// Assign values from combined if they exist
			// sourcery skip: use-braces
			if (combined.values !== undefined) result.values = combined.values
			if (combined.set !== undefined) result.set = combined.set
			if (combined.limit !== undefined) result.limit = combined.limit
			if (combined.offset !== undefined) result.offset = combined.offset
			if (combined.returning !== undefined)
				result.returning = combined.returning

			// Assign values from current if they exist
			if (current.values !== undefined) result.values = current.values
			if (current.set !== undefined) result.set = current.set
			if (current.limit !== undefined) result.limit = current.limit
			if (current.offset !== undefined) result.offset = current.offset
			if (current.returning !== undefined) result.returning = current.returning

			// Handle special cases with combine functions
			result.where = combineWhereClauses(combined.where, current.where)
			result.orderBy = combineOrderByClauses(combined.orderBy, current.orderBy)

			return result
		},
		{} as SqlContext<P>
	)
}
