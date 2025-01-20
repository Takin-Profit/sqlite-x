// Copyright 2025 Takin Profit. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

const sql = <T extends { [key: string]: unknown }>(
	strings: TemplateStringsArray,
	...values: (keyof T)[]
) => {
	return values
}

type Person = {
	name: string
	person: number
	age: number
	address: string
	phone: string
}

sql<Person>`SELECT * from ${"name"} where ${"person"} ${"name"}`
