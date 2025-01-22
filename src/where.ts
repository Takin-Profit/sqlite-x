import type { ComparisonOperator, LogicalOperator } from "#types.js"

// Single condition type
type SingleWhereCondition<P extends { [key: string]: unknown }> =
	| `${keyof P & string} ${ComparisonOperator} @${keyof P & string}`
	| `${keyof P & string} IS NULL`
	| `${keyof P & string} IS NOT NULL`

// Recursive type to enforce alternating condition/operator pattern
type ExtendedWhereCondition<P extends { [key: string]: unknown }> =
	| [SingleWhereCondition<P>, LogicalOperator, SingleWhereCondition<P>]
	| [
			...[SingleWhereCondition<P>, LogicalOperator, SingleWhereCondition<P>],
			LogicalOperator,
			SingleWhereCondition<P>,
	  ]

export type WhereClause<P extends { [key: string]: unknown }> =
	| SingleWhereCondition<P>
	| ExtendedWhereCondition<P>
