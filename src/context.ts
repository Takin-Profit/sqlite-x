// Copyright 2025 Takin Profit. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

import type { ToJson, ValueOfOperator } from "#sql.js"
import {
	COMPARISON_OPERATORS,
	LOGICAL_OPERATORS,
	type LogicalOperator,
} from "#types.js"
import { validationErr, type ValidationError } from "#validate.js"
import type { WhereClause } from "#where.js"

type ValueType<P extends { [key: string]: unknown }> =
	| ValueOfOperator<P>
	| ToJson<P>

type ValuesWithJsonColumns<P extends { [key: string]: unknown }> = [
	"*",
	{ jsonColumns: (keyof P)[] },
]

type InsertOrSetOptions<P extends { [key: string]: unknown }> =
	| ValueType<P>[]
	| "*"
	| ValuesWithJsonColumns<P>

// Core SQL context type
type SqlContext<P extends { [key: string]: unknown }> = Partial<{
	values: InsertOrSetOptions<P>
	set: InsertOrSetOptions<P>
	where: WhereClause<P>
	orderBy: Partial<Record<keyof P, "ASC" | "DESC">>
	limit: number
	offset: number
	returning: (keyof P)[] | "*"
}>

export function validateSqlContext<P extends { [key: string]: unknown }>(
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

function validateInsertOrSetOptions<P extends { [key: string]: unknown }>(
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

function validateWhereClause<P extends { [key: string]: unknown }>(
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

	// Match basic pattern: "column operator @param" or "column IS [NOT] NULL"
	const basicPattern = new RegExp(
		`^[\\w]+\\s+(${COMPARISON_OPERATORS.join("|")})\\s+@[\\w]+$|^[\\w]+\\s+IS(\\s+NOT)?\\s+NULL$`
	)
	return basicPattern.test(value)
}

function isValidValueType(value: string): boolean {
	return (
		value.startsWith("@") &&
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

export function isSqlContext<P extends { [key: string]: unknown }>(
	value: unknown
): value is SqlContext<P> {
	return validateSqlContext<P>(value).length === 0
}

export type { SqlContext }
