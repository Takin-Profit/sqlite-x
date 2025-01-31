import {
	COMPARISON_OPERATORS,
	LOGICAL_OPERATORS,
	type RawValue,
	type ComparisonOperator,
	type DataRow,
	type LogicalOperator,
	isRawValue,
} from "#types"
import { validationErr, type ValidationError } from "#validate.js"

type SingleWhereCondition<P extends DataRow> =
	| `${keyof P & string} ${ComparisonOperator} $${keyof P & string}`
	| `${keyof P & string} IS NULL`
	| `${keyof P & string} IS NOT NULL`
	| [keyof P & string, ComparisonOperator, RawValue] // New tuple format for RawValue
// Recursive type to enforce alternating condition/operator pattern
type ExtendedWhereCondition<P extends DataRow> =
	| [SingleWhereCondition<P>, LogicalOperator, SingleWhereCondition<P>]
	| [
			SingleWhereCondition<P>,
			LogicalOperator,
			SingleWhereCondition<P>,
			LogicalOperator,
			SingleWhereCondition<P>,
	  ]
	| [
			SingleWhereCondition<P>,
			LogicalOperator,
			SingleWhereCondition<P>,
			LogicalOperator,
			SingleWhereCondition<P>,
			LogicalOperator,
			SingleWhereCondition<P>,
	  ]
	| [
			SingleWhereCondition<P>,
			LogicalOperator,
			SingleWhereCondition<P>,
			LogicalOperator,
			SingleWhereCondition<P>,
			LogicalOperator,
			SingleWhereCondition<P>,
			LogicalOperator,
			SingleWhereCondition<P>,
	  ]
	| [
			SingleWhereCondition<P>,
			LogicalOperator,
			SingleWhereCondition<P>,
			LogicalOperator,
			SingleWhereCondition<P>,
			LogicalOperator,
			SingleWhereCondition<P>,
			LogicalOperator,
			SingleWhereCondition<P>,
			LogicalOperator,
			SingleWhereCondition<P>,
	  ]
	| [
			SingleWhereCondition<P>,
			LogicalOperator,
			SingleWhereCondition<P>,
			LogicalOperator,
			SingleWhereCondition<P>,
			LogicalOperator,
			SingleWhereCondition<P>,
			LogicalOperator,
			SingleWhereCondition<P>,
			LogicalOperator,
			SingleWhereCondition<P>,
			LogicalOperator,
			SingleWhereCondition<P>,
	  ]
	| [
			SingleWhereCondition<P>,
			LogicalOperator,
			SingleWhereCondition<P>,
			LogicalOperator,
			SingleWhereCondition<P>,
			LogicalOperator,
			SingleWhereCondition<P>,
			LogicalOperator,
			SingleWhereCondition<P>,
			LogicalOperator,
			SingleWhereCondition<P>,
			LogicalOperator,
			SingleWhereCondition<P>,
			LogicalOperator,
			SingleWhereCondition<P>,
	  ]
	| [
			SingleWhereCondition<P>,
			LogicalOperator,
			SingleWhereCondition<P>,
			LogicalOperator,
			SingleWhereCondition<P>,
			LogicalOperator,
			SingleWhereCondition<P>,
			LogicalOperator,
			SingleWhereCondition<P>,
			LogicalOperator,
			SingleWhereCondition<P>,
			LogicalOperator,
			SingleWhereCondition<P>,
			LogicalOperator,
			SingleWhereCondition<P>,
			LogicalOperator,
			SingleWhereCondition<P>,
	  ]
	| [
			SingleWhereCondition<P>,
			LogicalOperator,
			SingleWhereCondition<P>,
			LogicalOperator,
			SingleWhereCondition<P>,
			LogicalOperator,
			SingleWhereCondition<P>,
			LogicalOperator,
			SingleWhereCondition<P>,
			LogicalOperator,
			SingleWhereCondition<P>,
			LogicalOperator,
			SingleWhereCondition<P>,
			LogicalOperator,
			SingleWhereCondition<P>,
			LogicalOperator,
			SingleWhereCondition<P>,
			LogicalOperator,
			SingleWhereCondition<P>,
	  ]
	| [
			SingleWhereCondition<P>,
			LogicalOperator,
			SingleWhereCondition<P>,
			LogicalOperator,
			SingleWhereCondition<P>,
			LogicalOperator,
			SingleWhereCondition<P>,
			LogicalOperator,
			SingleWhereCondition<P>,
			LogicalOperator,
			SingleWhereCondition<P>,
			LogicalOperator,
			SingleWhereCondition<P>,
			LogicalOperator,
			SingleWhereCondition<P>,
			LogicalOperator,
			SingleWhereCondition<P>,
			LogicalOperator,
			SingleWhereCondition<P>,
			LogicalOperator,
			SingleWhereCondition<P>,
	  ]

/**
 * Represents a WHERE clause condition for SQL queries with strongly-typed column references and parameter bindings.
 * Supports single conditions and compound conditions with logical operators (AND/OR).
 * @example
 * // Single condition
 * const where: WhereClause<User> = "age > $minAge"
 *
 * // Compound condition
 * const where: WhereClause<User> = ["age > $minAge", "AND", "isActive = $active"]
 */
export type WhereClause<P extends DataRow> =
	| SingleWhereCondition<P>
	| ExtendedWhereCondition<P>

export function validateWhereClause<P extends DataRow>(
	where: WhereClause<P>
): ValidationError[] {
	const errors: ValidationError[] = []

	if (typeof where === "string") {
		return validateSingleCondition(where)
	}

	// Handle tuple format for RawValue
	if (
		Array.isArray(where) &&
		where.length === 3 &&
		!LOGICAL_OPERATORS.includes(where[1] as (typeof LOGICAL_OPERATORS)[number])
	) {
		const [column, operator, value] = where
		if (
			typeof column !== "string" ||
			!COMPARISON_OPERATORS.includes(operator as ComparisonOperator) ||
			!isRawValue(value)
		) {
			return [
				validationErr({
					msg: "Invalid RawValue condition format",
					path: "",
				}),
			]
		}
		return []
	}

	if (!Array.isArray(where)) {
		return [
			validationErr({
				msg: "Where clause must be a string, array, or RawValue condition",
			}),
		]
	}

	// Check for minimum length and odd number of elements for logical combinations
	if (where.length < 3 || where.length % 2 === 0) {
		return [
			validationErr({
				msg: "Where array must have odd number of elements with minimum length 3",
			}),
		]
	}

	// Validate conditions and operators alternate correctly
	for (let i = 0; i < where.length; i++) {
		if (i % 2 === 0) {
			// Should be condition
			if (Array.isArray(where[i])) {
				// Handle RawValue condition
				const condition = where[i] as [string, ComparisonOperator, RawValue]
				if (condition.length !== 3 || !isRawValue(condition[2])) {
					errors.push(
						validationErr({
							msg: `Invalid RawValue condition at position ${i}`,
							path: `[${i}]`,
						})
					)
				}
			} else {
				const conditionErrors = validateSingleCondition(where[i] as string)
				errors.push(...conditionErrors)
			}
		} else if (!LOGICAL_OPERATORS.includes(where[i] as LogicalOperator)) {
			errors.push(
				validationErr({
					msg: `Invalid logical operator at position ${i}`,
					path: `[${i}]`,
				})
			)
		}
	}

	return errors
}

function validateSingleCondition<P extends DataRow>(
	condition: string
): ValidationError[] {
	const pattern = new RegExp(
		`^[\\w]+\\s+(${COMPARISON_OPERATORS.join("|")})\\s+\\$[\\w->json]+$|^[\\w]+\\s+IS(\\s+NOT)?\\s+NULL$`
	)

	if (!pattern.test(condition)) {
		return [
			validationErr({
				msg: `Invalid condition format: ${condition}`,
				path: condition,
			}),
		]
	}

	return []
}

export function buildWhereStatement<P extends DataRow>(
	where: WhereClause<P>,
	params?: P
): { sql: string; parameterOperators: string[] } {
	const paramOps: string[] = []

	if (typeof where === "string") {
		// Extract parameter names from where clause
		const matches = where.match(/\$\w+/g) || []
		paramOps.push(...matches)
		return {
			sql: `WHERE ${where}`,
			parameterOperators: paramOps,
		}
	}

	// Handle RawValue tuple format
	if (
		Array.isArray(where) &&
		where.length === 3 &&
		!LOGICAL_OPERATORS.includes(where[1] as (typeof LOGICAL_OPERATORS)[number])
	) {
		const [column, operator, value] = where
		return {
			sql: `WHERE ${column} ${operator} ${(value as RawValue).value}`,
			parameterOperators: [],
		}
	}

	// Handle array case
	const conditions = where
		.map((part, i) => {
			if (i % 2 === 0) {
				if (Array.isArray(part)) {
					// Handle RawValue condition
					const [column, operator, value] = part
					return `${column} ${operator} ${value.value}`
				}
				const matches = (part as string).match(/\$\w+/g) || []
				paramOps.push(...matches)
				// Handle JSON operator
				if ((part as string).includes("->json")) {
					return (part as string).replace(/\$([\w]+)->json/, "jsonb($$$1)")
				}
				return part
			}
			return ` ${part} `
		})
		.join("")

	return {
		sql: `WHERE ${conditions}`,
		parameterOperators: paramOps,
	}
}
