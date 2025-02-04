// Copyright 2025 Takin Profit. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

import { validateSchema } from "#schema.js"
import { NodeSqliteError, SqlitePrimaryResultCode } from "#errors"
import {
	type ColumnOptions,
	isRawValue,
	type SqlContext,
	type DataRow,
	type WhereClause,
} from "#types"
import { validationErr, type ValidationError } from "#validate"
import { validateWhereClause } from "#where"

export function validateSqlContext<P extends DataRow, R = P>(
	value: unknown
): ValidationError[] {
	const errors: ValidationError[] = []

	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return [validationErr({ msg: "SqlContext must be an object" })]
	}

	const context = value as Record<string, unknown>

	for (const key in context) {
		switch (key) {
			case "values": {
				const valueErrors = validateInsertOrSetOptions<P>(context[key])
				if (valueErrors.length > 0) {
					errors.push(
						...valueErrors.map(err => ({
							...err,
							path: `values${err.path ? `.${err.path}` : ""}`,
						}))
					)
				}
				break
			}
			case "set": {
				const setErrors = validateSetOptions<P>(context[key])
				if (setErrors.length > 0) {
					errors.push(
						...setErrors.map(err => ({
							...err,
							path: `set${err.path ? `.${err.path}` : ""}`,
						}))
					)
				}
				break
			}
			case "columns": {
				const value = context[key]
				if (value !== "*" && !Array.isArray(value)) {
					errors.push(
						validationErr({
							msg: "columns must be '*' or an array",
							path: "columns",
						})
					)
				} else if (Array.isArray(value)) {
					if (!value.every(item => typeof item === "string")) {
						errors.push(
							validationErr({
								msg: "columns array must contain only strings",
								path: "columns",
							})
						)
					}
					// Validate format of each column spec
					value.forEach((col, index) => {
						if (!isValidColumnSpec(col)) {
							errors.push(
								validationErr({
									msg: "Invalid column format",
									path: `columns[${index}]`,
								})
							)
						}
					})
				}
				break
			}

			case "where": {
				const whereErrors = validateWhereClause<P>(
					context[key] as WhereClause<P>
				)
				if (whereErrors.length > 0) {
					errors.push(
						...whereErrors.map(err => ({
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
						...orderErrors.map(err => ({
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
			case "schema": {
				const columnErrors = validateSchema<P>(context[key])
				if (columnErrors.length > 0) {
					errors.push(
						...columnErrors.map(err => ({
							...err,
							path: `schema${err.path ? `.${err.path}` : ""}`,
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
				} else if (Array.isArray(value)) {
					// Check for ["*", { jsonColumns: [...] }] format
					if (value.length === 2 && value[0] === "*") {
						const config = value[1]
						if (!isJsonColumns(config)) {
							errors.push(
								validationErr({
									msg: "jsonColumns must be a non-empty array of strings",
									path: "returning[1]",
								})
							)
						}
					} else {
						// Regular column array validation
						if (!value.every(item => typeof item === "string")) {
							errors.push(
								validationErr({
									msg: "returning array must contain only strings",
									path: "returning",
								})
							)
						}
						// Check for duplicates
						const seen = new Set<string>()
						const duplicates = value.filter(item => {
							if (seen.has(item)) {
								return true
							}
							seen.add(item)
							return false
						})
						if (duplicates.length > 0) {
							errors.push(
								validationErr({
									msg: `Duplicate columns in RETURNING clause: ${duplicates.join(", ")}`,
									path: "returning",
								})
							)
						}
					}
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

function isValidColumnSpec(value: string): boolean {
	return (
		!value.includes(" ") && // No spaces allowed
		(value.endsWith("->json") ||
			value.endsWith("<-json") ||
			!value.includes("->")) // Basic column or JSON operation
	)
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

	// Check if it's a tuple with configuration
	if (value.length === 2 && value[0] === "*") {
		const [, config] = value
		if (typeof config !== "object" || config === null) {
			return [
				validationErr({
					msg: "Second element must be a configuration object",
					path: "[1]",
				}),
			]
		}

		// Check for at least one valid config option
		if (!("jsonColumns" in config) && !("batch" in config)) {
			return [
				validationErr({
					msg: "Configuration must include either jsonColumns or batch",
					path: "[1]",
				}),
			]
		}

		if (
			"jsonColumns" in config &&
			(!Array.isArray(config.jsonColumns) ||
				!config.jsonColumns.every((col: unknown) => typeof col === "string"))
		) {
			return [
				validationErr({
					msg: "jsonColumns must be an array of strings",
					path: "[1].jsonColumns",
				}),
			]
		}

		if ("batch" in config && typeof config.batch !== "boolean") {
			return [
				validationErr({
					msg: "batch must be a boolean value",
					path: "[1].batch",
				}),
			]
		}

		return []
	}

	// Validate parameter operators array
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

function isValidValueType(value: string): boolean {
	return (
		value.startsWith("$") &&
		(value.includes(".toJson") ? value.endsWith(".toJson") : true)
	)
}

export function isSqlContext<P extends DataRow, R = P>(
	value: unknown
): value is SqlContext<P, R> {
	return validateSqlContext<P>(value).length === 0
}

type ContextValidationError = {
	type: "DUPLICATE_CLAUSE" | "INCOMPATIBLE_CLAUSE" | "INVALID_COMBINATION"
	message: string
	clauses?: string[]
}

export function validateContextCombination<P extends DataRow, R = P>(
	contexts: SqlContext<P, R>[]
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

			const clauseKey = clause as keyof SqlContext<P, R>

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
					if (seenClauses.has(otherClause as keyof SqlContext<P, R>)) {
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

export function combineContexts<P extends DataRow, R = P>(
	contexts: SqlContext<P, R>[]
): SqlContext<P, R> {
	// First validate the combination
	const errors = validateContextCombination(contexts)
	if (errors.length > 0) {
		throw new NodeSqliteError(
			"ERR_SQLITE_CONTEXT",
			SqlitePrimaryResultCode.SQLITE_MISUSE,
			"Invalid SQL context combination",
			errors.map(e => e.message).join("\n"),
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

	return contexts.reduce<SqlContext<P, R>>(
		(combined, current) => {
			// Create new object with explicit property assignments
			const result: SqlContext<P, R> = {}

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
		{} as SqlContext<P, R>
	)
}

export function buildColsStatement<P extends DataRow>(
	cols: ColumnOptions<P>
): string {
	if (cols === "*") {
		return "*"
	}

	// Handle array of column specifications
	if (Array.isArray(cols)) {
		// Remove duplicates while preserving order
		const seen = new Set<string>()
		return cols
			.filter(col => {
				const colStr = String(col)
				if (seen.has(colStr)) {
					return false
				}
				seen.add(colStr)
				return true
			})
			.map(col => {
				if (typeof col === "string") {
					if (col.endsWith("->json")) {
						const columnName = col.slice(0, -6)
						return `jsonb(${columnName})`
					}
					if (col.endsWith("<-json")) {
						const columnName = col.slice(0, -6)
						return `json_extract(${columnName}, '$') as ${columnName}`
					}
					return col
				}
				return String(col)
			})
			.join(", ")
	}

	throw new NodeSqliteError(
		"ERR_SQLITE_PARAM",
		SqlitePrimaryResultCode.SQLITE_ERROR,
		"Invalid columns format",
		"Columns must be '*' or an array of columns",
		undefined
	)
}

export function validateSetOptions<P extends DataRow>(
	value: unknown
): ValidationError[] {
	const errors: ValidationError[] = []

	// Handle "*" case
	if (value === "*") {
		return []
	}

	// Handle ["*", { jsonColumns: [...] }] case
	if (Array.isArray(value)) {
		if (value.length !== 2 || value[0] !== "*") {
			return [
				validationErr({
					msg: "Array format must be ['*', { jsonColumns: [...] }]",
					path: "",
				}),
			]
		}

		const [, config] = value
		if (!config || typeof config !== "object" || !("jsonColumns" in config)) {
			return [
				validationErr({
					msg: "Second element must be an object with jsonColumns",
					path: "[1]",
				}),
			]
		}

		const { jsonColumns } = config
		if (!Array.isArray(jsonColumns) || jsonColumns.length === 0) {
			return [
				validationErr({
					msg: "jsonColumns must be a non-empty array",
					path: "[1].jsonColumns",
				}),
			]
		}

		if (!jsonColumns.every(col => typeof col === "string")) {
			return [
				validationErr({
					msg: "jsonColumns must contain only strings",
					path: "[1].jsonColumns",
				}),
			]
		}

		return []
	}

	// Handle object format
	if (typeof value === "object" && value !== null) {
		const entries = Object.entries(value)

		for (const [key, val] of entries) {
			if (isRawValue(val)) {
				// RawValue is always valid
				continue
			}

			if (typeof val !== "string") {
				errors.push(
					validationErr({
						msg: `Value for '${key}' must be a string parameter or RawValue`,
						path: key,
					})
				)
				continue
			}

			// Validate parameter format
			if (val.startsWith("$")) {
				// Check for ->json format
				if (val.endsWith("->json")) {
					const paramPart = val.slice(1, -6)
					if (!paramPart) {
						errors.push(
							validationErr({
								msg: "Invalid JSON parameter format",
								path: key,
							})
						)
					}
				} else {
					// Regular parameter
					const paramPart = val.slice(1)
					if (!paramPart) {
						errors.push(
							validationErr({
								msg: "Invalid parameter format",
								path: key,
							})
						)
					}
				}
			} else {
				errors.push(
					validationErr({
						msg: "Value must start with $ or be a RawValue",
						path: key,
					})
				)
			}
		}

		return errors
	}

	return [
		validationErr({
			msg: "SET must be an object, '*', or ['*', { jsonColumns: [...] }]",
			path: "",
		}),
	]
}

export const isJsonColumns = (
	value: unknown
): value is { jsonColumns: string[] } =>
	typeof value === "object" &&
	value !== null &&
	Array.isArray((value as { jsonColumns: unknown }).jsonColumns) &&
	(value as { jsonColumns: unknown[] }).jsonColumns.length > 0 &&
	(value as { jsonColumns: unknown[] }).jsonColumns.every(
		col => typeof col === "string"
	)
