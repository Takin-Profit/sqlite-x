/* // Copyright 2025 Takin Profit. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

import type { DataRow, IDatabase } from "#types.js"

class Table<T extends DataRow> {
	constructor(
		private readonly db: IDatabase<T>,
		private readonly name: string
	) {}
}
 */
