import {
	COMPARISON_OPERATORS,
	LOGICAL_OPERATORS,
	type ComparisonOperator,
	type DataRow,
	type LogicalOperator,
} from "#types"
import { validationErr, type ValidationError } from "#validate.js"

// fields of boolean type should be comparable to other boolean fields, and number fields
// fields of number type should be comparable to other number fields, and boolean fields
// string fields should be comparable to other string fields, and boolean fields
// object fields, arrays, sets, and anything that is not a primitive type should be comparable to other object fields, and arrays and non primitive types
// more that 5 elements are allowed in the tuple, there is no limit

// Single condition type
type SingleWhereCondition<P extends DataRow> =
	| `${keyof P & string} ${ComparisonOperator} $${keyof P & string}`
	| `${keyof P & string} IS NULL`
	| `${keyof P & string} IS NOT NULL`

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

	if (!Array.isArray(where)) {
		return [validationErr({ msg: "Where clause must be a string or array" })]
	}

	// Check for minimum length and odd number of elements
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
			const conditionErrors = validateSingleCondition(where[i])
			errors.push(...conditionErrors)
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

// In validateSingleCondition
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

	// Handle array case...
	const conditions = where
		.map((part, i) => {
			if (i % 2 === 0) {
				const matches = part.match(/\$\w+/g) || []
				paramOps.push(...matches)
				// Handle JSON operator
				if (part.includes("->json")) {
					return part.replace(/\$([\w]+)->json/, "jsonb($$$1)")
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
