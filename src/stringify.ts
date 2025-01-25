// Copyright 2025 Takin Profit. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

type Options = {
	depthLimit: number
	edgesLimit: number
}

const LIMIT_REPLACE_NODE = "[...]"
const CIRCULAR_REPLACE_NODE = "[Circular]"

const arr: [any, string | number, any, PropertyDescriptor?][] = []
const replacerStack: [any, string | number, any][] = []

function defaultOptions(): Options {
	return {
		depthLimit: Number.MAX_SAFE_INTEGER,
		edgesLimit: Number.MAX_SAFE_INTEGER,
	}
}

// Regular stringify
function stringify(
	obj: any,
	replacer?: (key: string, value: any) => any,
	spacer?: string | number,
	options?: Options
): string {
	options = options ?? defaultOptions()

	decirc(obj, "", 0, [], undefined, 0, options)
	let res: string
	try {
		if (replacerStack.length === 0) {
			res = JSON.stringify(obj, replacer, spacer)
		} else {
			res = JSON.stringify(obj, replaceGetterValues(replacer), spacer)
		}
	} catch (_) {
		return JSON.stringify(
			"[unable to serialize, circular reference is too complex to analyze]"
		)
	} finally {
		while (arr.length !== 0) {
			const part = arr.pop()!
			if (part.length === 4) {
				Object.defineProperty(part[0], part[1], part[3]!)
			} else {
				part[0][part[1]] = part[2]
			}
		}
	}
	return res
}

function setReplace(
	replace: string,
	val: any,
	k: string | number,
	parent: any
): void {
	const propertyDescriptor = Object.getOwnPropertyDescriptor(parent, k)
	if (propertyDescriptor?.get !== undefined) {
		if (propertyDescriptor.configurable) {
			Object.defineProperty(parent, k, { value: replace })
			arr.push([parent, k, val, propertyDescriptor])
		} else {
			replacerStack.push([val, k, replace])
		}
	} else {
		parent[k] = replace
		arr.push([parent, k, val])
	}
}

function decirc(
	val: any,
	k: string | number,
	edgeIndex: number,
	stack: any[],
	parent: any,
	depth: number,
	options: Options
): void {
	depth += 1
	if (typeof val === "object" && val !== null) {
		for (let i = 0; i < stack.length; i++) {
			if (stack[i] === val) {
				setReplace(CIRCULAR_REPLACE_NODE, val, k, parent)
				return
			}
		}

		if (
			typeof options.depthLimit !== "undefined" &&
			depth > options.depthLimit
		) {
			setReplace(LIMIT_REPLACE_NODE, val, k, parent)
			return
		}

		if (
			typeof options.edgesLimit !== "undefined" &&
			edgeIndex + 1 > options.edgesLimit
		) {
			setReplace(LIMIT_REPLACE_NODE, val, k, parent)
			return
		}

		stack.push(val)
		// Optimize for Arrays. Big arrays could kill the performance otherwise!
		if (Array.isArray(val)) {
			for (let i = 0; i < val.length; i++) {
				decirc(val[i], i, i, stack, val, depth, options)
			}
		} else {
			const keys = Object.keys(val)
			for (let i = 0; i < keys.length; i++) {
				const key = keys[i]
				decirc(val[key], key, i, stack, val, depth, options)
			}
		}
		stack.pop()
	}
}

// Stable-stringify
function compareFunction(a: string, b: string): number {
	if (a < b) {
		return -1
	}
	if (a > b) {
		return 1
	}
	return 0
}

function deterministicStringify(
	obj: any,
	replacer?: (key: string, value: any) => any,
	spacer?: string | number,
	options?: Options
): string {
	options = options ?? defaultOptions()

	const tmp = deterministicDecirc(obj, "", 0, [], undefined, 0, options) || obj
	let res: string
	try {
		if (replacerStack.length === 0) {
			res = JSON.stringify(tmp, replacer, spacer)
		} else {
			res = JSON.stringify(tmp, replaceGetterValues(replacer), spacer)
		}
	} catch (_) {
		return JSON.stringify(
			"[unable to serialize, circular reference is too complex to analyze]"
		)
	} finally {
		while (arr.length !== 0) {
			const part = arr.pop()!
			if (part.length === 4) {
				Object.defineProperty(part[0], part[1], part[3]!)
			} else {
				part[0][part[1]] = part[2]
			}
		}
	}
	return res
}

function deterministicDecirc(
	val: any,
	k: string | number,
	edgeIndex: number,
	stack: any[],
	parent: any,
	depth: number,
	options: Options
): any {
	depth += 1
	if (typeof val === "object" && val !== null) {
		for (let i = 0; i < stack.length; i++) {
			if (stack[i] === val) {
				setReplace(CIRCULAR_REPLACE_NODE, val, k, parent)
				return
			}
		}
		try {
			if (typeof val.toJSON === "function") {
				return
			}
		} catch (_) {
			return
		}

		if (
			typeof options.depthLimit !== "undefined" &&
			depth > options.depthLimit
		) {
			setReplace(LIMIT_REPLACE_NODE, val, k, parent)
			return
		}

		if (
			typeof options.edgesLimit !== "undefined" &&
			edgeIndex + 1 > options.edgesLimit
		) {
			setReplace(LIMIT_REPLACE_NODE, val, k, parent)
			return
		}

		stack.push(val)
		if (Array.isArray(val)) {
			for (let i = 0; i < val.length; i++) {
				deterministicDecirc(val[i], i, i, stack, val, depth, options)
			}
		} else {
			const tmp: Record<string, any> = {}
			const keys = Object.keys(val).sort(compareFunction)
			for (let i = 0; i < keys.length; i++) {
				const key = keys[i]
				deterministicDecirc(val[key], key, i, stack, val, depth, options)
				tmp[key] = val[key]
			}
			if (typeof parent !== "undefined") {
				arr.push([parent, k, val])
				parent[k] = tmp
			} else {
				return tmp
			}
		}
		stack.pop()
	}
}

function replaceGetterValues(
	replacer?: (key: string, value: any) => any
): (key: string, value: any) => any {
	replacer = replacer ?? ((_, v) => v)

	return function (this: unknown, key: string, val: any): any {
		if (replacerStack.length > 0) {
			for (let i = 0; i < replacerStack.length; i++) {
				const part = replacerStack[i]
				if (part[1] === key && part[0] === val) {
					val = part[2]
					replacerStack.splice(i, 1)
					break
				}
			}
		}
		return replacer!.call(this, key, val)
	}
}

stringify.stable = deterministicStringify
stringify.stableStringify = deterministicStringify

export { stringify as default, deterministicStringify, stringify }
