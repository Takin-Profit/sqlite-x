import { test, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { DB } from "#database"

let db: DB

beforeEach(() => {
	db = new DB({
		location: ":memory:",
		environment: "testing",
	})

	db.exec(`
    CREATE TABLE json_test (
      id INTEGER PRIMARY KEY,
      simple_object JSON,
      nested_object JSON,
      array_data JSON,
      mixed_data JSON,
      nullable_json JSON
    )
  `)
})

afterEach(() => {
	db.close()
})

test("handles simple object JSON storage and retrieval", () => {
	interface SimpleObject {
		name: string
		age: number
		active: boolean
	}

	const simpleObject: SimpleObject = {
		name: "John",
		age: 30,
		active: true,
	}

	const insertData = db.mutation<{ data: SimpleObject }>(
		({ sql }) => sql`
      INSERT INTO json_test (simple_object)
      VALUES (${"@data.toJson"})
    `
	)

	insertData.run({ data: simpleObject })

	const getData = db.query<Record<string, never>>(
		({ sql }) => sql`
      SELECT json_extract(simple_object, '$') as data
      FROM json_test
    `
	)

	const result = getData.all<{ data: SimpleObject }>({})
	assert.deepEqual(result[0].data, simpleObject)
})

test("handles nested object JSON storage and retrieval", () => {
	interface NestedObject {
		user: {
			name: string
			address: {
				street: string
				city: string
				coords: { lat: number; lng: number }
			}
		}
		preferences: {
			theme: {
				dark: boolean
				colors: { primary: string; secondary: string }
			}
		}
	}

	const nestedObject: NestedObject = {
		user: {
			name: "John",
			address: {
				street: "123 Main St",
				city: "Boston",
				coords: {
					lat: 42.3601,
					lng: -71.0589,
				},
			},
		},
		preferences: {
			theme: {
				dark: true,
				colors: {
					primary: "#000000",
					secondary: "#ffffff",
				},
			},
		},
	}

	const insertData = db.mutation<{ data: NestedObject }>(
		({ sql }) => sql`
      INSERT INTO json_test (nested_object)
      VALUES (${"@data.toJson"})
    `
	)

	insertData.run({ data: nestedObject })

	const getData = db.query<Record<string, never>>(
		({ sql }) => sql`
      SELECT json_extract(nested_object, '$') as data
      FROM json_test
    `
	)

	const result = getData.all<{ data: NestedObject }>({})
	assert.deepEqual(result[0].data, nestedObject)
})

test("handles multiple row JSON operations", () => {
	interface RowData {
		id: number
		value: string
	}

	const rows: RowData[] = [
		{ id: 1, value: "first" },
		{ id: 2, value: "second" },
	]

	db.exec(`
    CREATE TABLE multi_test (
      id INTEGER PRIMARY KEY,
      data JSON,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `)

	const insertRows = db.mutation<{ data: RowData }>(
		({ sql }) => sql`
      INSERT INTO multi_test (data)
      VALUES (${"@data.toJson"})
    `
	)

	for (const row of rows) {
		insertRows.run({ data: row })
	}

	const getRows = db.query<Record<string, never>>(
		({ sql }) => sql`
    SELECT
      id,
      json_extract(data, '$') as data,
      created_at
    FROM multi_test
    ORDER BY id
  `
	)

	const result = getRows.all<{ id: number; data: RowData; created_at: string }>(
		{}
	)
	assert.equal(result.length, 2)
	assert.deepEqual(result[0].data, rows[0])
	assert.deepEqual(result[1].data, rows[1])
})

test("handles JSON path queries", () => {
	interface TestData {
		users: Array<{
			id: number
			name: string
			settings: { theme: string }
		}>
		config: {
			version: string
			features: {
				flag1: boolean
				flag2: boolean
			}
		}
	}

	const data: TestData = {
		users: [
			{ id: 1, name: "John", settings: { theme: "dark" } },
			{ id: 2, name: "Jane", settings: { theme: "light" } },
		],
		config: {
			version: "1.0",
			features: {
				flag1: true,
				flag2: false,
			},
		},
	}

	const insertData = db.mutation<{ data: TestData }>(
		({ sql }) => sql`
      INSERT INTO json_test (nested_object)
      VALUES (${"@data.toJson"})
    `
	)

	insertData.all({ data })

	const getData = db.query<Record<string, never>>(
		({ sql }) => sql`
      SELECT
        json_extract(nested_object, '$') as data,
        json_extract(nested_object, '$.users[0].name') as first_user_name,
        json_extract(nested_object, '$.config.version') as version,
        json_extract(nested_object, '$.users[1].settings.theme') as second_user_theme,
        json_extract(nested_object, '$.config.features.flag1') as feature_flag
      FROM json_test
    `
	)

	const result = getData.all<{
		data: TestData
		first_user_name: string
		version: string
		second_user_theme: string
		feature_flag: number
	}>({})

	assert.deepEqual(result[0].data, data)
	assert.strictEqual(result[0].first_user_name, "John")
	assert.strictEqual(result[0].version, "1.0")
	assert.strictEqual(result[0].second_user_theme, "light")
	assert.strictEqual(result[0].feature_flag, 1)
})

test("handles array of objects with mixed types", () => {
	interface ComplexArray {
		items: Array<{
			id: number
			name: string
			metadata: {
				tags: string[]
				counts: { [key: string]: number }
				active: boolean
				lastUpdated: string
			}
		}>
	}

	const testData: ComplexArray = {
		items: [
			{
				id: 1,
				name: "Item 1",
				metadata: {
					tags: ["important", "urgent"],
					counts: { views: 100, shares: 50 },
					active: true,
					lastUpdated: "2025-01-20",
				},
			},
			{
				id: 2,
				name: "Item 2",
				metadata: {
					tags: ["archived"],
					counts: { views: 75, shares: 25 },
					active: false,
					lastUpdated: "2025-01-19",
				},
			},
		],
	}

	const insertData = db.mutation<{ data: ComplexArray }>(
		({ sql }) => sql`
      INSERT INTO json_test (array_data)
      VALUES (${"@data.toJson"})
    `
	)

	insertData.run({ data: testData })

	const getData = db.query<Record<string, never>>(
		({ sql }) => sql`
      SELECT
        json_extract(array_data, '$') as full_data,
        json_extract(array_data, '$.items[0].metadata.tags[0]') as first_tag,
        json_extract(array_data, '$.items[0].metadata.counts.views') as view_count,
        json_extract(array_data, '$.items[1].metadata.active') as is_active
      FROM json_test
    `
	)

	const result = getData.all<{
		full_data: ComplexArray
		first_tag: string
		view_count: number
		is_active: number
	}>({})

	assert.deepEqual(result[0].full_data, testData)
	assert.strictEqual(result[0].first_tag, "important")
	assert.strictEqual(result[0].view_count, 100)
	assert.strictEqual(result[0].is_active, 0)
})

test("handles null and empty JSON values", () => {
	interface NullableData {
		required: string
		optional?: string
		nullValue: null
		emptyObject: Record<string, never>
		emptyArray: never[]
	}

	const testData: NullableData = {
		required: "present",
		nullValue: null,
		emptyObject: {},
		emptyArray: [],
	}

	const insertData = db.mutation<{ data: NullableData }>(
		({ sql }) => sql`
      INSERT INTO json_test (nullable_json)
      VALUES (${"@data.toJson"})
    `
	)

	insertData.run({ data: testData })

	const getData = db.query<Record<string, never>>(
		({ sql }) => sql`
      SELECT
        json_extract(nullable_json, '$') as data,
        json_extract(nullable_json, '$.optional') as missing_value,
        json_extract(nullable_json, '$.nullValue') as null_value,
        json_extract(nullable_json, '$.emptyObject') as empty_object,
        json_extract(nullable_json, '$.emptyArray') as empty_array
      FROM json_test
    `
	)

	const result = getData.all<{
		data: NullableData
		missing_value: unknown
		null_value: null
		empty_object: Record<string, never>
		empty_array: never[]
	}>({})

	assert.deepEqual(result[0].data, testData)
	assert.strictEqual(result[0].missing_value, null)
	assert.strictEqual(result[0].null_value, null)
	assert.deepEqual(result[0].empty_object, {})
	assert.deepEqual(result[0].empty_array, [])
})

test("handles JSON updates", () => {
	interface UpdateData {
		counter: number
		items: string[]
		metadata: {
			lastModified: string
			modifiedBy: string
		}
	}

	const initialData: UpdateData = {
		counter: 1,
		items: ["item1"],
		metadata: {
			lastModified: "2025-01-20",
			modifiedBy: "user1",
		},
	}

	// Insert initial data
	const insertData = db.mutation<{ data: UpdateData }>(
		({ sql }) => sql`
      INSERT INTO json_test (mixed_data)
      VALUES (${"@data.toJson"})
    `
	)

	insertData.run({ data: initialData })

	// Update the JSON data
	const updatedData: UpdateData = {
		counter: 2,
		items: ["item1", "item2"],
		metadata: {
			lastModified: "2025-01-21",
			modifiedBy: "user2",
		},
	}

	const updateData = db.mutation<{ data: UpdateData }>(
		({ sql }) => sql`
      UPDATE json_test
      SET mixed_data = ${"@data.toJson"}
    `
	)

	updateData.run({ data: updatedData })

	// Verify the update
	const getData = db.query<Record<string, never>>(
		({ sql }) => sql`
      SELECT json_extract(mixed_data, '$') as data
      FROM json_test
    `
	)

	const result = getData.all<{ data: UpdateData }>({})
	assert.deepEqual(result[0].data, updatedData)
})

test("handles nested JSON array operations", () => {
	interface NestedArrayData {
		matrix: number[][]
		objects: Array<{
			id: number
			nested: {
				values: string[]
			}
		}>
	}

	const testData: NestedArrayData = {
		matrix: [
			[1, 2, 3],
			[4, 5, 6],
			[7, 8, 9],
		],
		objects: [
			{ id: 1, nested: { values: ["a", "b"] } },
			{ id: 2, nested: { values: ["c", "d"] } },
		],
	}

	const insertData = db.mutation<{ data: NestedArrayData }>(
		({ sql }) => sql`
      INSERT INTO json_test (array_data)
      VALUES (${"@data.toJson"})
    `
	)

	insertData.run({ data: testData })

	const getData = db.query<Record<string, never>>(
		({ sql }) => sql`
      SELECT
        json_extract(array_data, '$') as data,
        json_extract(array_data, '$.matrix[1][1]') as center_value,
        json_extract(array_data, '$.objects[1].nested.values[0]') as nested_value
      FROM json_test
    `
	)

	const result = getData.all<{
		data: NestedArrayData
		center_value: number
		nested_value: string
	}>({})

	assert.deepEqual(result[0].data, testData)
	assert.strictEqual(result[0].center_value, 5)
	assert.strictEqual(result[0].nested_value, "c")
})

test("handles fromJson when querying stored JSON data", () => {
	interface UserData {
		name: string
		settings: {
			theme: string
			notifications: boolean
		}
	}

	const userData: UserData = {
		name: "John",
		settings: {
			theme: "dark",
			notifications: true,
		},
	}

	// First store the JSON data using toJson
	const insertUser = db.mutation<{ user_data: UserData }>(
		({ sql }) => sql`
    INSERT INTO json_test (simple_object)
    VALUES (${"@user_data.toJson"})
  `
	)

	insertUser.run({ user_data: userData })

	// Now query it back using fromJson
	const getUser = db.query<Record<string, never>>(
		({ sql }) => sql`
    SELECT ${"@simple_object.fromJson"} as user_data
    FROM json_test
  `
	)

	// biome-ignore lint/suspicious/noExplicitAny: <explanation>
	const result = getUser.all<any>({})
	assert.deepEqual(result[0].user_data, userData)
})

test("handles fromJson with nested JSON fields", () => {
	interface ComplexData {
		id: number
		metadata: {
			tags: string[]
			timestamp: string
			nested: {
				count: number
				flags: {
					active: boolean
					featured: boolean
				}
			}
		}
	}

	const testData: ComplexData = {
		id: 1,
		metadata: {
			tags: ["test", "json"],
			timestamp: "2025-01-20",
			nested: {
				count: 42,
				flags: {
					active: true,
					featured: false,
				},
			},
		},
	}

	// Store the data
	const insertData = db.mutation<{ data: ComplexData }>(
		({ sql }) => sql`
    INSERT INTO json_test (nested_object)
    VALUES (${"@data.toJson"})
  `
	)

	insertData.run({ data: testData })

	// Query specific nested fields using fromJson
	const getData = db.query<Record<string, never>>(
		({ sql }) => sql`
    SELECT
      ${"@nested_object.fromJson"} as full_data,
      json(json_extract(nested_object, '$.metadata.tags')) as tags,
      json(json_extract(nested_object, '$.metadata.nested.flags')) as flags
    FROM json_test
`
	)
	// biome-ignore lint/suspicious/noExplicitAny: <explanation>
	const result = getData.all<any>({})
	assert.deepEqual(result[0].full_data, testData)
	assert.deepEqual(result[0].tags, ["test", "json"])
	assert.deepEqual(result[0].flags, {
		active: true,
		featured: false,
	})
})

test("handles mixed query with multiple fromJson operations", () => {
	interface UserProfile {
		name: string
		preferences: { theme: string }
	}

	interface UserMetadata {
		lastLogin: string
		devices: string[]
	}

	const profile: UserProfile = {
		name: "Jane",
		preferences: { theme: "light" },
	}

	const metadata: UserMetadata = {
		lastLogin: "2025-01-20",
		devices: ["desktop", "mobile"],
	}

	// Store both JSON objects
	const insertData = db.mutation<{ profile: UserProfile; meta: UserMetadata }>(
		({ sql }) => sql`
    INSERT INTO json_test (simple_object, nested_object)
    VALUES (${"@profile.toJson"}, ${"@meta.toJson"})
  `
	)

	insertData.run({ profile, meta: metadata })

	// Query both JSON fields using fromJson
	const getData = db.query<Record<string, never>>(
		({ sql }) => sql`
    SELECT
      ${"@simple_object.fromJson"} as profile,
      ${"@nested_object.fromJson"} as metadata
    FROM json_test
  `
	)

	// biome-ignore lint/suspicious/noExplicitAny: <explanation>
	const result = getData.all<any>({})
	assert.deepEqual(result[0].profile, profile)
	assert.deepEqual(result[0].metadata, metadata)
})
