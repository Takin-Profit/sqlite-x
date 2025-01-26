// Copyright 2025 Takin Profit. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

import { test, describe } from "node:test"
import assert from "node:assert/strict"
import {
	combineContexts,
	validateContextCombination,
	validateSqlContext,
	type SqlContext,
} from "./context.js"
import { buildColumnsStatement, type Columns } from "#columns.js"

type TestUser = {
	id: number
	name: string
	age: number
	email: string
	createdAt: string
	isActive: boolean
	metadata: Record<string, unknown>
}

describe("SQL Context Validation", async () => {
	describe("Basic Structure", () => {
		test("accepts empty object", () => {
			const context = {}
			const errors = validateSqlContext<TestUser>(context)
			assert.equal(errors.length, 0)
		})

		test("rejects non-object values", () => {
			const values = [null, undefined, 42, "string", true, []]
			for (const value of values) {
				const errors = validateSqlContext<TestUser>(value)
				assert.equal(errors.length, 1)
				assert.equal(errors[0].message, "SqlContext must be an object")
			}
		})

		test("rejects unknown properties", () => {
			const context = {
				unknownProp: "value",
				anotherUnknown: 123,
			}
			const errors = validateSqlContext<TestUser>(context)
			assert.equal(errors.length, 2)
			assert.ok(errors.every(e => e.message.startsWith("Unknown property:")))
		})
	})

	describe("Values and Set Validation", () => {
		test("accepts '*' for values", () => {
			const context: SqlContext<TestUser> = {
				values: "*",
			}
			const errors = validateSqlContext<TestUser>(context)
			assert.equal(errors.length, 0)
		})

		test("accepts valid parameter operators", () => {
			const context: SqlContext<TestUser> = {
				values: ["$name", "$age", "$email"],
			}
			const errors = validateSqlContext<TestUser>(context)
			assert.equal(errors.length, 0)
		})

		test("accepts toJson operators", () => {
			const context: SqlContext<TestUser> = {
				values: ["$metadata->json"],
			}
			const errors = validateSqlContext<TestUser>(context)
			assert.equal(errors.length, 0)
		})

		test("accepts valid JSON columns configuration", () => {
			const context: SqlContext<TestUser> = {
				values: ["*", { jsonColumns: ["metadata"] }],
			}
			const errors = validateSqlContext<TestUser>(context)
			assert.equal(errors.length, 0)
		})

		test("rejects invalid parameter operators", () => {
			const context = {
				values: ["name", "no-at-sign", "$invalid.wrong"],
			}
			const errors = validateSqlContext<TestUser>(context)
			assert.ok(errors.length > 0)
			assert.ok(
				errors.every(e =>
					e.message.includes("Invalid parameter operator format")
				)
			)
		})

		test("rejects invalid JSON columns configuration", () => {
			const context = {
				values: ["*", { wrongKey: ["metadata"] }],
			}
			const errors = validateSqlContext<TestUser>(context)
			assert.ok(errors.length > 0)
		})
	})

	describe("Where Clause Validation", () => {
		test("accepts valid single condition", () => {
			const context: SqlContext<TestUser> = {
				where: "age != $age",
			}
			const errors = validateSqlContext<TestUser>(context)
			assert.equal(errors.length, 0)
		})

		test("accepts IS NULL conditions", () => {
			const context: SqlContext<TestUser> = {
				where: "email IS NULL",
			}
			const errors = validateSqlContext<TestUser>(context)
			assert.equal(errors.length, 0)
		})

		test("accepts valid compound conditions", () => {
			const context: SqlContext<TestUser> = {
				where: ["age != $age", "AND", "age != $createdAt"],
			}
			const errors = validateSqlContext<TestUser>(context)
			assert.equal(errors.length, 0)
		})

		test("rejects invalid conditions", () => {
			const invalidConditions = [
				"invalid condition",
				"age >== $minAge",
				"name LIKES $pattern",
				["age >= $minAge", "INVALID_OP", "name LIKE $pattern"],
			]

			for (const condition of invalidConditions) {
				const context = { where: condition }
				const errors = validateSqlContext<TestUser>(context)
				assert.ok(errors.length > 0)
			}
		})
	})

	describe("Order By Validation", () => {
		test("accepts valid order by clause", () => {
			const context: SqlContext<TestUser> = {
				orderBy: {
					name: "ASC",
					age: "DESC",
				},
			}
			const errors = validateSqlContext<TestUser>(context)
			assert.equal(errors.length, 0)
		})

		test("rejects invalid order directions", () => {
			const context = {
				orderBy: {
					name: "ASCENDING",
					age: "DOWN",
				},
			}
			const errors = validateSqlContext<TestUser>(context)
			assert.equal(errors.length, 2)
			assert.ok(
				errors.every(e => e.message.includes("Order direction must be"))
			)
		})
	})

	describe("Limit and Offset Validation", () => {
		test("accepts valid limit and offset", () => {
			const context: SqlContext<TestUser> = {
				limit: 10,
				offset: 20,
			}
			const errors = validateSqlContext<TestUser>(context)
			assert.equal(errors.length, 0)
		})

		test("rejects non-numeric limit and offset", () => {
			const context = {
				limit: "10",
				offset: "20",
			}
			const errors = validateSqlContext<TestUser>(context)
			assert.equal(errors.length, 2)
			assert.ok(errors.some(e => e.message.includes("limit must be a number")))
			assert.ok(errors.some(e => e.message.includes("offset must be a number")))
		})
	})

	describe("Returning Clause Validation", () => {
		test("accepts '*' as returning value", () => {
			const context: SqlContext<TestUser> = {
				returning: "*",
			}
			const errors = validateSqlContext<TestUser>(context)
			assert.equal(errors.length, 0)
		})

		test("accepts array of column names", () => {
			const context: SqlContext<TestUser> = {
				returning: ["id", "name", "age"],
			}
			const errors = validateSqlContext<TestUser>(context)
			assert.equal(errors.length, 0)
		})

		test("rejects invalid returning values", () => {
			const invalidReturning = [
				42,
				{ columns: ["id", "name"] },
				["id", 42, "name"],
			]

			for (const returning of invalidReturning) {
				const context = { returning }
				const errors = validateSqlContext<TestUser>(context)
				assert.ok(errors.length > 0)
			}
		})
	})

	describe("Complex Scenarios", () => {
		test("accepts valid complex context", () => {
			const context: SqlContext<TestUser> = {
				values: ["$name", "$age", "$metadata->json"],
				where: ["age != $createdAt", "AND", "isActive > $age"],
				orderBy: { name: "ASC", createdAt: "DESC" },
				limit: 10,
				offset: 20,
				returning: ["id", "name", "age"],
			}
			const errors = validateSqlContext<TestUser>(context)
			assert.equal(errors.length, 0)
		})

		test("accumulates multiple errors", () => {
			const context = {
				values: ["invalid", 123],
				where: "invalid where",
				orderBy: { name: "INVALID" },
				limit: "10",
				returning: [42],
			}
			const errors = validateSqlContext<TestUser>(context)
			assert.ok(errors.length > 3, "Should collect multiple validation errors")
		})
	})
})

describe("Context Combination Validation", () => {
	test("rejects duplicate unique clauses", () => {
		const contexts: SqlContext<TestUser>[] = [
			{ values: ["$name", "$age"] },
			{ values: ["$email"] },
		]
		const errors = validateContextCombination(contexts)
		assert.equal(errors.length, 1)
	})

	test("rejects incompatible clause combinations", () => {
		const contexts: SqlContext<TestUser>[] = [
			{ values: ["$name"] },
			{ set: ["$age"] },
		]
		const errors = validateContextCombination(contexts)
		assert.equal(errors.length, 1)
	})

	test("allows valid combinations", () => {
		const contexts: SqlContext<TestUser>[] = [
			{ where: "age != $age" },
			{ orderBy: { name: "ASC" } },
			{ limit: 10, offset: 20 },
		]
		const errors = validateContextCombination(contexts)
		assert.equal(errors.length, 0)
	})

	test("combines where clauses correctly", () => {
		const contexts: SqlContext<TestUser>[] = [
			{ where: "age != $createdAt" },
			{ where: "name LIKE $age" },
		]
		const combined = combineContexts(contexts)
		assert.deepEqual(combined.where, [
			"age != $createdAt",
			"AND",
			"name LIKE $age",
		])
	})
})

describe("Foreign Key Column Definitions", () => {
	test("validates basic foreign key", () => {
		interface TestTable {
			id: number
			userId: number
		}

		const columns: Columns<TestTable> = {
			id: "INTEGER PRIMARY KEY",
			userId: "INTEGER NOT NULL",
			$$foreignKeys: [
				{
					key: "userId",
					references: {
						table: "users",
						columns: ["id"],
					},
				},
			],
		}

		const sql = buildColumnsStatement(columns)
		assert.equal(
			sql,
			"(\n  id INTEGER PRIMARY KEY,\n  userId INTEGER NOT NULL,\n  FOREIGN KEY(userId) REFERENCES users(id)\n)"
		)
	})

	test("validates composite foreign key", () => {
		interface TestTable {
			id: number
			firstName: string
			lastName: string
		}

		const columns: Columns<TestTable> = {
			id: "INTEGER PRIMARY KEY",
			firstName: "TEXT NOT NULL",
			lastName: "TEXT NOT NULL",
			$$foreignKeys: [
				{
					key: "firstName,lastName",
					references: {
						table: "users",
						columns: ["first", "last"],
					},
				},
			],
		}

		const sql = buildColumnsStatement(columns)
		assert.equal(
			sql,
			"(\n  id INTEGER PRIMARY KEY,\n  firstName TEXT NOT NULL,\n  lastName TEXT NOT NULL,\n  FOREIGN KEY(firstName, lastName) REFERENCES users(first, last)\n)"
		)
	})

	test("validates foreign key with actions", () => {
		interface TestTable {
			id: number
			departmentId: number
		}

		const columns: Columns<TestTable> = {
			id: "INTEGER PRIMARY KEY",
			departmentId: "INTEGER NOT NULL",
			$$foreignKeys: [
				{
					key: "departmentId",
					references: {
						table: "departments",
						columns: ["id"],
					},
					onDelete: "CASCADE",
					onUpdate: "SET NULL",
				},
			],
		}

		const sql = buildColumnsStatement(columns)
		assert.equal(
			sql,
			"(\n  id INTEGER PRIMARY KEY,\n  departmentId INTEGER NOT NULL,\n  FOREIGN KEY(departmentId) REFERENCES departments(id) ON DELETE CASCADE ON UPDATE SET NULL\n)"
		)
	})

	test("validates multiple foreign keys", () => {
		interface TestTable {
			id: number
			userId: number
			groupId: number
		}

		const columns: Columns<TestTable> = {
			id: "INTEGER PRIMARY KEY",
			userId: "INTEGER NOT NULL",
			groupId: "INTEGER NOT NULL",
			$$foreignKeys: [
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
			],
		}

		const sql = buildColumnsStatement(columns)
		assert.equal(
			sql,
			"(\n  id INTEGER PRIMARY KEY,\n  userId INTEGER NOT NULL,\n  groupId INTEGER NOT NULL,\n  FOREIGN KEY(userId) REFERENCES users(id),\n  FOREIGN KEY(groupId) REFERENCES groups(id) ON DELETE CASCADE\n)"
		)
	})

	test("validates deferrable foreign key", () => {
		interface TestTable {
			id: number
			parentId: number
		}

		const columns: Columns<TestTable> = {
			id: "INTEGER PRIMARY KEY",
			parentId: "INTEGER",
			$$foreignKeys: [
				{
					key: "parentId",
					references: {
						table: "test_table",
						columns: ["id"],
					},
					deferrable: "DEFERRABLE INITIALLY DEFERRED",
				},
			],
		}

		const sql = buildColumnsStatement(columns)
		assert.equal(
			sql,
			"(\n  id INTEGER PRIMARY KEY,\n  parentId INTEGER,\n  FOREIGN KEY(parentId) REFERENCES test_table(id) DEFERRABLE INITIALLY DEFERRED\n)"
		)
	})
})
