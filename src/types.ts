// Copyright 2025 Takin Profit. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

export const COMPARISON_OPERATORS = [
	"=",
	"!=",
	">",
	"<",
	">=",
	"<=",
	"LIKE",
	"NOT LIKE",
	"IN",
	"NOT IN",
	"IS",
	"IS NOT",
] as const

export const LOGICAL_OPERATORS = ["AND", "OR"] as const

export type ComparisonOperator = (typeof COMPARISON_OPERATORS)[number]
export type LogicalOperator = (typeof LOGICAL_OPERATORS)[number]

/**
 * A row of data from a database query, or a row of data to be inserted, or a row of data used for query conditions.
 */
// biome-ignore lint/suspicious/noExplicitAny: <explanation>
export type DataRow = { [key: string]: any }
