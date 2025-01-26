// Copyright 2025 Takin Profit. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

import { test, describe } from "node:test"
import assert from "node:assert/strict"
import {
	validateForeignKeys,
	isForeignKeys,
	buildForeignKeyStatement,
} from "#fk"

describe("Foreign Key Validation", () => {
	test("validates basic foreign key", () => {
		const fk = {
			key: "userId",
			references: {
				table: "users",
				columns: ["id"],
			},
		}
		assert.equal(validateForeignKeys(fk).length, 0)
		assert.equal(isForeignKeys(fk), true)
	})

	test("validates composite key", () => {
		const fk = {
			key: "firstName,lastName",
			references: {
				table: "users",
				columns: ["first", "last"],
			},
		}
		assert.equal(validateForeignKeys(fk).length, 0)
	})

	test("rejects more than 3 keys", () => {
		const fk = {
			key: "a,b,c,d",
			references: {
				table: "users",
				columns: ["id"],
			},
		}
		const errors = validateForeignKeys(fk)
		assert.equal(errors.length, 1)
		assert.equal(
			errors[0].message,
			"Maximum of 3 keys allowed in foreign key constraint"
		)
	})

	test("validates actions", () => {
		const fk = {
			key: "userId",
			references: {
				table: "users",
				columns: ["id"],
			},
			onDelete: "CASCADE",
			onUpdate: "SET NULL",
		}
		assert.equal(validateForeignKeys(fk).length, 0)
	})

	test("rejects invalid actions", () => {
		const fk = {
			key: "userId",
			references: {
				table: "users",
				columns: ["id"],
			},
			onDelete: "INVALID",
			onUpdate: "WRONG",
		}
		const errors = validateForeignKeys(fk)
		assert.equal(errors.length, 2)
		assert.ok(errors[0].message.includes("Invalid ON DELETE"))
		assert.ok(errors[1].message.includes("Invalid ON UPDATE"))
	})

	test("validates deferrable status", () => {
		const fk = {
			key: "userId",
			references: {
				table: "users",
				columns: ["id"],
			},
			deferrable: "DEFERRABLE INITIALLY DEFERRED",
		}
		assert.equal(validateForeignKeys(fk).length, 0)
	})

	test("rejects invalid deferrable status", () => {
		const fk = {
			key: "userId",
			references: {
				table: "users",
				columns: ["id"],
			},
			deferrable: "INVALID",
		}
		const errors = validateForeignKeys(fk)
		assert.equal(errors.length, 1)
		assert.ok(errors[0].message.includes("Invalid deferrable status"))
	})

	test("requires references", () => {
		const fk = {
			key: "userId",
		}
		const errors = validateForeignKeys(fk)
		assert.equal(errors.length, 1)
		assert.equal(errors[0].message, "References is required")
	})

	test("validates references structure", () => {
		const fk = {
			key: "userId",
			references: {
				table: 123,
				columns: "not an array",
			},
		}
		const errors = validateForeignKeys(fk)
		assert.equal(errors.length, 2)
		assert.ok(errors[0].message.includes("table must be a string"))
		assert.ok(errors[1].message.includes("columns must be an array"))
	})
})

describe("Foreign Key Statement Building", () => {
	test("builds basic foreign key", () => {
		const fk = {
			key: "userId",
			references: {
				table: "users",
				columns: ["id"],
			},
		}
		const sql = buildForeignKeyStatement([fk])
		assert.equal(sql, "FOREIGN KEY(userId) REFERENCES users(id)")
	})

	test("builds composite foreign key", () => {
		const fk = {
			key: "firstName,lastName",
			references: {
				table: "users",
				columns: ["first", "last"],
			},
		}
		const sql = buildForeignKeyStatement([fk])
		assert.equal(
			sql,
			"FOREIGN KEY(firstName, lastName) REFERENCES users(first, last)"
		)
	})

	test("includes ON DELETE and ON UPDATE", () => {
		const fk = {
			key: "userId",
			references: {
				table: "users",
				columns: ["id"],
			},
			onDelete: "CASCADE",
			onUpdate: "SET NULL",
		}
		// biome-ignore lint/suspicious/noExplicitAny: <explanation>
		const sql = buildForeignKeyStatement([fk as any])
		assert.equal(
			sql,
			"FOREIGN KEY(userId) REFERENCES users(id) ON DELETE CASCADE ON UPDATE SET NULL"
		)
	})

	test("includes deferrable status", () => {
		const fk = {
			key: "userId",
			references: {
				table: "users",
				columns: ["id"],
			},
			deferrable: "DEFERRABLE INITIALLY DEFERRED",
		}
		// biome-ignore lint/suspicious/noExplicitAny: <explanation>
		const sql = buildForeignKeyStatement([fk as any])
		assert.equal(
			sql,
			"FOREIGN KEY(userId) REFERENCES users(id) DEFERRABLE INITIALLY DEFERRED"
		)
	})

	test("handles multiple foreign keys", () => {
		const fks = [
			{
				key: "userId",
				references: {
					table: "users",
					columns: ["id"],
				},
			},
			{
				key: "groupId",
				references: {
					table: "groups",
					columns: ["id"],
				},
				onDelete: "CASCADE",
			},
		]
		// biome-ignore lint/suspicious/noExplicitAny: <explanation>
		const sql = buildForeignKeyStatement(fks as any)
		assert.equal(
			sql,
			"FOREIGN KEY(userId) REFERENCES users(id),\n  FOREIGN KEY(groupId) REFERENCES groups(id) ON DELETE CASCADE"
		)
	})

	test("throws on column count mismatch", () => {
		const fk = {
			key: "firstName,lastName",
			references: {
				table: "users",
				columns: ["id"],
			},
		}
		assert.throws(() => buildForeignKeyStatement([fk]), {
			name: "NodeSqliteError",
			message:
				"Foreign key columns count (2) does not match referenced columns count (1)",
		})
	})
})
