// Copyright 2025 Takin Profit. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

import type { DataRow } from "#types"
import { NodeSqliteError, SqlitePrimaryResultCode } from "#errors"

export function buildOrderByStatement<P extends DataRow>(
	orderBy: Partial<Record<keyof P, "ASC" | "DESC">>
): { sql: string } {
	if (!orderBy || Object.keys(orderBy).length === 0) {
		throw new NodeSqliteError(
			"ERR_SQLITE_PARAM",
			SqlitePrimaryResultCode.SQLITE_ERROR,
			"Invalid orderBy configuration",
			"OrderBy must be a non-empty object with column names as keys and 'ASC' or 'DESC' as values",
			undefined
		)
	}

	const orderClauses = Object.entries(orderBy).map(([column, direction]) => {
		if (direction !== "ASC" && direction !== "DESC") {
			throw new NodeSqliteError(
				"ERR_SQLITE_PARAM",
				SqlitePrimaryResultCode.SQLITE_ERROR,
				"Invalid sort direction",
				`Sort direction must be 'ASC' or 'DESC', got '${direction}'`,
				undefined
			)
		}
		return `${column} ${direction}`
	})

	return {
		sql: `ORDER BY ${orderClauses.join(", ")}`,
	}
}
