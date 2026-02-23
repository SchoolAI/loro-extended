/** biome-ignore-all lint/suspicious/noExplicitAny: JSON Patch values can be any type */

import { PathNavigationError } from "./errors.js"
import { isPlainValueRef } from "./plain-value-ref/index.js"
import type { DocShape } from "./shape.js"
import { INTERNAL_SYMBOL } from "./typed-refs/base.js"
import type { Draft } from "./types.js"

/**
 * Unwrap a value that may be a PlainValueRef to get the raw value.
 * This is critical for move/copy operations where we need to capture
 * the value BEFORE mutating the source location.
 */
function unwrapValue(value: any): any {
  if (isPlainValueRef(value)) {
    return value.get()
  }
  return value
}

// =============================================================================
// JSON PATCH TYPES - Discriminated Union for Type Safety
// =============================================================================

export type JsonPatchAddOperation = {
  op: "add"
  path: string | (string | number)[]
  value: any
}

export type JsonPatchRemoveOperation = {
  op: "remove"
  path: string | (string | number)[]
}

export type JsonPatchReplaceOperation = {
  op: "replace"
  path: string | (string | number)[]
  value: any
}

export type JsonPatchMoveOperation = {
  op: "move"
  path: string | (string | number)[]
  from: string | (string | number)[]
}

export type JsonPatchCopyOperation = {
  op: "copy"
  path: string | (string | number)[]
  from: string | (string | number)[]
}

export type JsonPatchTestOperation = {
  op: "test"
  path: string | (string | number)[]
  value: any
}

export type JsonPatchOperation =
  | JsonPatchAddOperation
  | JsonPatchRemoveOperation
  | JsonPatchReplaceOperation
  | JsonPatchMoveOperation
  | JsonPatchCopyOperation
  | JsonPatchTestOperation

export type JsonPatch = JsonPatchOperation[]

// =============================================================================
// PATH NAVIGATION UTILITIES
// =============================================================================

/**
 * Normalize JSON Pointer string to path array
 * Handles RFC 6901 escaping: ~1 -> /, ~0 -> ~
 */
export function normalizePath(
  path: string | (string | number)[],
): (string | number)[] {
  if (Array.isArray(path)) {
    return path
  }

  // Handle JSON Pointer format (RFC 6901)
  if (path.startsWith("/")) {
    return path
      .slice(1) // Remove leading slash
      .split("/")
      .map(segment => {
        // Handle JSON Pointer escaping
        const unescaped = segment.replace(/~1/g, "/").replace(/~0/g, "~")
        // Try to parse as number for array indices
        const asNumber = Number(unescaped)
        return Number.isInteger(asNumber) && asNumber >= 0
          ? asNumber
          : unescaped
      })
  }

  // Handle simple dot notation or single segment
  return path.split(".").map(segment => {
    const asNumber = Number(segment)
    return Number.isInteger(asNumber) && asNumber >= 0 ? asNumber : segment
  })
}

/**
 * Navigate to a target path using natural DraftNode property access
 * This follows the existing patterns from the test suite
 */
function navigateToPath<T extends DocShape>(
  draft: Draft<T>,
  path: (string | number)[],
): { parent: any; key: string | number } {
  if (path.length === 0) {
    throw new PathNavigationError([], "", "Cannot navigate to empty path")
  }

  let current = draft as any

  // Navigate to parent of target
  for (let i = 0; i < path.length - 1; i++) {
    const segment = path[i]

    if (typeof segment === "string") {
      // Use natural property access - this leverages existing DraftNode lazy creation
      current = current[segment]
      if (current === undefined) {
        throw new PathNavigationError(path, segment)
      }
    } else if (typeof segment === "number") {
      // List/array access using get() method (following existing patterns)
      if (current.get && typeof current.get === "function") {
        current = current.get(segment)
        if (current === undefined) {
          throw new PathNavigationError(
            path,
            segment,
            `List index ${segment} does not exist`,
          )
        }
      } else {
        throw new PathNavigationError(
          path,
          segment,
          `Cannot use numeric index ${segment} on non-list`,
        )
      }
    } else {
      throw new PathNavigationError(
        path,
        segment,
        `Invalid path segment type: ${typeof segment}`,
      )
    }
  }

  const targetKey = path[path.length - 1]
  return { parent: current, key: targetKey }
}

/**
 * Get value at path using natural DraftNode access patterns
 */
function getValueAtPath<T extends DocShape>(
  draft: Draft<T>,
  path: (string | number)[],
): any {
  if (path.length === 0) {
    return draft
  }

  const { parent, key } = navigateToPath(draft, path)

  if (typeof key === "string") {
    // Use natural property access or get() method
    if (parent.get && typeof parent.get === "function") {
      return parent.get(key)
    }
    return parent[key]
  } else if (typeof key === "number") {
    // List access using get() method
    if (parent.get && typeof parent.get === "function") {
      return parent.get(key)
    }
    throw new Error(`Cannot use numeric index ${key} on non-list`)
  }

  throw new Error(`Invalid key type: ${typeof key}`)
}

// =============================================================================
// OPERATION HANDLERS - Following existing DraftNode patterns
// =============================================================================

/**
 * Handle 'add' operation using existing DraftNode methods
 */
function handleAdd<T extends DocShape>(
  draft: Draft<T>,
  operation: JsonPatchAddOperation,
): void {
  const path = normalizePath(operation.path)
  const { parent, key } = navigateToPath(draft, path)

  if (typeof key === "string") {
    // Map-like operations - use natural assignment or set() method
    // Check if parent is a PlainValueRef (has PLAIN_VALUE_REF_SYMBOL or specific shape)
    // PlainValueRef.set() takes ONE argument, RecordRef.set() takes TWO arguments
    if (isPlainValueRef(parent)) {
      // Parent is a PlainValueRef (e.g., a struct value in a list) - access nested property
      const ref = (parent as any)[key]
      if (ref && typeof ref.set === "function") {
        ref.set(operation.value)
      } else {
        throw new Error(`Cannot add property "${key}" on PlainValueRef parent`)
      }
    } else if (parent.set && typeof parent.set === "function") {
      // RecordRef: parent.set(key, value)
      parent.set(key, operation.value)
    } else {
      // StructRef: navigate to property PlainValueRef, then .set()
      const ref = parent[key]
      if (ref && typeof ref.set === "function") {
        ref.set(operation.value)
      } else {
        throw new Error(`Cannot add property "${key}" on parent`)
      }
    }
  } else if (typeof key === "number") {
    // List operations - use insert() method (follows existing patterns)
    if (parent.insert && typeof parent.insert === "function") {
      parent.insert(key, operation.value)
    } else {
      throw new Error(`Cannot insert at numeric index ${key} on non-list`)
    }
  } else {
    throw new Error(`Invalid key type: ${typeof key}`)
  }
}

/**
 * Handle 'remove' operation using existing DraftNode methods
 */
function handleRemove<T extends DocShape>(
  draft: Draft<T>,
  operation: JsonPatchRemoveOperation,
): void {
  const path = normalizePath(operation.path)
  const { parent, key } = navigateToPath(draft, path)

  if (typeof key === "string") {
    // Map-like operations - use delete() method (follows existing patterns)
    // This works for both RecordRef.delete(key) and StructRef internals
    if (parent.delete && typeof parent.delete === "function") {
      parent.delete(key)
    } else {
      // StructRef proxy doesn't expose delete directly, but we can access
      // the underlying LoroMap via the internals
      const internals = (parent as any)[INTERNAL_SYMBOL]
      if (internals && typeof internals.deleteProperty === "function") {
        internals.deleteProperty(key)
      } else {
        throw new Error(`Cannot remove property "${key}" on parent`)
      }
    }
  } else if (typeof key === "number") {
    // List operations - use delete() method with count (follows existing patterns)
    if (parent.delete && typeof parent.delete === "function") {
      parent.delete(key, 1)
    } else {
      throw new Error(`Cannot remove at numeric index ${key} on non-list`)
    }
  } else {
    throw new Error(`Invalid key type: ${typeof key}`)
  }
}

/**
 * Handle 'replace' operation using existing DraftNode methods
 */
function handleReplace<T extends DocShape>(
  draft: Draft<T>,
  operation: JsonPatchReplaceOperation,
): void {
  const path = normalizePath(operation.path)
  const { parent, key } = navigateToPath(draft, path)

  if (typeof key === "string") {
    // Map-like operations - use set() method or natural assignment
    // Check if parent is a PlainValueRef (has PLAIN_VALUE_REF_SYMBOL or specific shape)
    // PlainValueRef.set() takes ONE argument, RecordRef.set() takes TWO arguments
    if (isPlainValueRef(parent)) {
      // Parent is a PlainValueRef (e.g., a struct value in a list) - access nested property
      const ref = (parent as any)[key]
      if (ref && typeof ref.set === "function") {
        ref.set(operation.value)
      } else {
        throw new Error(
          `Cannot replace property "${key}" on PlainValueRef parent`,
        )
      }
    } else if (parent.set && typeof parent.set === "function") {
      // RecordRef: parent.set(key, value)
      parent.set(key, operation.value)
    } else {
      // StructRef: navigate to property PlainValueRef, then .set()
      const ref = parent[key]
      if (ref && typeof ref.set === "function") {
        ref.set(operation.value)
      } else {
        throw new Error(`Cannot replace property "${key}" on parent`)
      }
    }
  } else if (typeof key === "number") {
    // List operations - delete then insert (follows existing patterns)
    if (
      parent.delete &&
      parent.insert &&
      typeof parent.delete === "function" &&
      typeof parent.insert === "function"
    ) {
      parent.delete(key, 1)
      parent.insert(key, operation.value)
    } else {
      throw new Error(`Cannot replace at numeric index ${key} on non-list`)
    }
  } else {
    throw new Error(`Invalid key type: ${typeof key}`)
  }
}

/**
 * Handle 'move' operation using existing DraftNode methods
 */
function handleMove<T extends DocShape>(
  draft: Draft<T>,
  operation: JsonPatchMoveOperation,
): void {
  const fromPath = normalizePath(operation.from)
  const toPath = normalizePath(operation.path)

  // For list moves within the same parent, we need special handling
  if (
    fromPath.length === toPath.length &&
    fromPath.slice(0, -1).every((segment, i) => segment === toPath[i])
  ) {
    // Same parent container - use list move operation if available
    const fromIndex = fromPath[fromPath.length - 1]
    const toIndex = toPath[toPath.length - 1]

    if (typeof fromIndex === "number" && typeof toIndex === "number") {
      const { parent } = navigateToPath(draft, fromPath.slice(0, -1))

      // Check if the parent has a move method (like LoroMovableList)
      if (parent.move && typeof parent.move === "function") {
        parent.move(fromIndex, toIndex)
        return
      }

      // Otherwise, get value, remove, then add at target index
      // CRITICAL: Unwrap PlainValueRef BEFORE removal to capture the raw value.
      // PlainValueRef is a LIVE reference - after removal, indices shift and
      // the ref would read from the wrong position.
      const value = unwrapValue(getValueAtPath(draft, fromPath))
      handleRemove(draft, { op: "remove", path: operation.from })

      // For JSON Patch move semantics, the target index refers to the position
      // in the final array, not the intermediate array after removal.
      // No index adjustment needed - use the original target index.
      handleAdd(draft, { op: "add", path: operation.path, value })
      return
    }
  }

  // Different parents or non-numeric indices - standard move
  // CRITICAL: Unwrap PlainValueRef BEFORE removal to capture the raw value.
  const value = unwrapValue(getValueAtPath(draft, fromPath))
  handleRemove(draft, { op: "remove", path: operation.from })
  handleAdd(draft, { op: "add", path: operation.path, value })
}

/**
 * Handle 'copy' operation using existing DraftNode methods
 */
function handleCopy<T extends DocShape>(
  draft: Draft<T>,
  operation: JsonPatchCopyOperation,
): void {
  const fromPath = normalizePath(operation.from)

  // Get the value to copy
  // Unwrap PlainValueRef to get the raw value for copying
  const value = unwrapValue(getValueAtPath(draft, fromPath))

  // Add to destination (no removal)
  handleAdd(draft, { op: "add", path: operation.path, value })
}

/**
 * Handle 'test' operation using existing DraftNode value access
 */
function handleTest<T extends DocShape>(
  draft: Draft<T>,
  operation: JsonPatchTestOperation,
): boolean {
  const path = normalizePath(operation.path)
  const actualValue = getValueAtPath(draft, path)

  // Deep equality check for test operation
  return JSON.stringify(actualValue) === JSON.stringify(operation.value)
}

// =============================================================================
// MAIN APPLICATOR - Simple orchestration following existing patterns
// =============================================================================

/**
 * Main JSON Patch applicator - follows existing change() patterns
 */
export class JsonPatchApplicator<T extends DocShape> {
  constructor(private rootDraft: Draft<T>) {}

  /**
   * Apply a single JSON Patch operation
   */
  applyOperation(operation: JsonPatchOperation): void {
    switch (operation.op) {
      case "add":
        handleAdd(this.rootDraft, operation)
        break
      case "remove":
        handleRemove(this.rootDraft, operation)
        break
      case "replace":
        handleReplace(this.rootDraft, operation)
        break
      case "move":
        handleMove(this.rootDraft, operation)
        break
      case "copy":
        handleCopy(this.rootDraft, operation)
        break
      case "test":
        if (!handleTest(this.rootDraft, operation)) {
          throw new Error(`JSON Patch test failed at path: ${operation.path}`)
        }
        break
      default:
        // TypeScript will catch this at compile time with proper discriminated union
        throw new Error(
          `Unsupported JSON Patch operation: ${(operation as any).op}`,
        )
    }
  }

  /**
   * Apply multiple JSON Patch operations in sequence
   */
  applyPatch(patch: JsonPatch): void {
    for (const operation of patch) {
      this.applyOperation(operation)
    }
  }
}
