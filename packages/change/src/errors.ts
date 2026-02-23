/**
 * Custom error types for @loro-extended/change
 *
 * All errors extend LoroExtendedError for unified catch handling.
 *
 * @module errors
 */

/**
 * Base error class for all loro-extended errors.
 * Provides a context object for structured error information.
 */
export class LoroExtendedError extends Error {
  constructor(
    message: string,
    public context?: Record<string, unknown>,
  ) {
    super(message)
    this.name = "LoroExtendedError"
  }
}

/**
 * Thrown when a PlainValueRef for a list item is accessed after the list has been mutated.
 * The stored index may no longer point to the same item.
 *
 * @example
 * ```typescript
 * const ref = list.get(0)
 * list.delete(0, 1)
 * ref.get() // Throws StaleRefError - index 0 now points to different item
 * ```
 */
export class StaleRefError extends LoroExtendedError {
  constructor(
    public listId: string,
    public originalIndex: number,
  ) {
    super(
      `Stale PlainValueRef: list "${listId}" was mutated after this ref was created at index ${originalIndex}. ` +
        `Capture values with .get() before mutating the list.`,
      { listId, originalIndex },
    )
    this.name = "StaleRefError"
  }
}

/**
 * Thrown when path navigation fails (e.g., in JSON Patch operations or path evaluation).
 *
 * @example
 * ```typescript
 * // Attempting to navigate to a non-existent path segment
 * applyPatch(doc, [{ op: "add", path: "/nonexistent/field", value: 1 }])
 * // Throws PathNavigationError
 * ```
 */
export class PathNavigationError extends LoroExtendedError {
  constructor(
    public path: (string | number)[],
    public failedSegment: string | number,
    message?: string,
  ) {
    super(message ?? `Cannot navigate to path segment: ${failedSegment}`, {
      path,
      failedSegment,
    })
    this.name = "PathNavigationError"
  }
}

/**
 * Thrown when a value doesn't match its expected schema type.
 * Used by validateValue() when validation is enabled.
 *
 * @example
 * ```typescript
 * const doc = createTypedDoc(schema, { validate: true })
 * doc.count.set("not a number") // Throws SchemaViolationError
 * ```
 */
export class SchemaViolationError extends LoroExtendedError {
  constructor(
    public schemaPath: string,
    public expectedType: string,
    public actualValue: unknown,
  ) {
    super(
      `Schema violation at ${schemaPath}: expected ${expectedType}, got ${typeof actualValue}`,
      { schemaPath, expectedType, actualValue },
    )
    this.name = "SchemaViolationError"
  }
}

/**
 * Thrown when an operation is not supported on a particular container type.
 *
 * @example
 * ```typescript
 * // Attempting to delete from a struct (structs have fixed keys)
 * delete structRef.fixedKey // Throws ContainerTypeError
 * ```
 */
export class ContainerTypeError extends LoroExtendedError {
  constructor(
    public containerType: string,
    public operation: string,
  ) {
    super(`Cannot perform ${operation} on container type: ${containerType}`, {
      containerType,
      operation,
    })
    this.name = "ContainerTypeError"
  }
}
