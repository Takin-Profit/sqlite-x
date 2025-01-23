import type { ComparisonOperator, DataRow, LogicalOperator } from "#types"

// Single condition type
type SingleWhereCondition<P extends DataRow> =
	| `${keyof P & string} ${ComparisonOperator} $${keyof P & string}`
	| `${keyof P & string} IS NULL`
	| `${keyof P & string} IS NOT NULL`

// Recursive type to enforce alternating condition/operator pattern
type ExtendedWhereCondition<P extends DataRow> =
	| [SingleWhereCondition<P>, LogicalOperator, SingleWhereCondition<P>]
	| [
			...[SingleWhereCondition<P>, LogicalOperator, SingleWhereCondition<P>],
			LogicalOperator,
			SingleWhereCondition<P>,
	  ]

export type WhereClause<P extends DataRow> =
	| SingleWhereCondition<P>
	| ExtendedWhereCondition<P>
