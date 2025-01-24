// Copyright 2025 Takin Profit. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

/**
 * Represents a validation error with a message and optional path indicating where the error occurred.
 * @property _validation_error - Internal flag to identify validation errors
 * @property message - Human-readable error message
 * @property path - Optional path indicating where the error occurred (e.g. "user.name")
 */
export type ValidationError = {
	_validation_error: true
	message: string
	path?: string
}

export const isValidationErr = (value: unknown): value is ValidationError => {
	return (
		typeof value === "object" && value !== null && "_validation_error" in value
	)
}

export const isValidationErrs = (value: unknown): value is ValidationError[] =>
	Array.isArray(value) && value.length > 0 && value.every(isValidationErr)

export const validationErr = ({
	msg: message,
	path,
}: {
	msg: string
	path?: string
}): ValidationError => ({
	_validation_error: true,
	message,
	path,
})
