/**
 * Pure path operations for traversing and modifying nested objects.
 * These are functional core utilities with no side effects.
 *
 * @module path-ops
 */

/**
 * Get a value at a nested path. Pure function.
 *
 * @param obj - The object to traverse
 * @param path - Array of string keys representing the path
 * @returns The value at the path, or undefined if not found
 *
 * @example
 * ```typescript
 * getAtPath({ a: { b: { c: 1 } } }, ["a", "b", "c"]) // => 1
 * getAtPath({ a: 1 }, ["b"]) // => undefined
 * ```
 */
export function getAtPath(obj: unknown, path: string[]): unknown {
  let current = obj
  for (const key of path) {
    if (current == null) return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

/**
 * Set a value at a nested path, returning a new object. Pure function.
 * Creates intermediate objects as needed. Does not mutate the original.
 *
 * @param obj - The object to update (will not be mutated)
 * @param path - Array of string keys representing the path
 * @param value - The value to set at the path
 * @returns A new object with the value set at the path
 *
 * @example
 * ```typescript
 * setAtPath({ a: 1 }, ["a"], 2) // => { a: 2 }
 * setAtPath({}, ["a", "b", "c"], 1) // => { a: { b: { c: 1 } } }
 * ```
 */
export function setAtPath(
  obj: unknown,
  path: string[],
  value: unknown,
): unknown {
  if (path.length === 0) return value

  const cloned = deepClone(obj) ?? {}
  let target = cloned as Record<string, unknown>

  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i]
    if (target[key] == null || typeof target[key] !== "object") {
      target[key] = {}
    }
    target = target[key] as Record<string, unknown>
  }

  target[path[path.length - 1]] = value
  return cloned
}

/**
 * Apply a transform function at a nested path, returning a new object.
 * Uses structural sharing for efficiency. Pure function.
 *
 * @param obj - The object to transform (will not be mutated)
 * @param path - Array of string keys representing the path to the transform target
 * @param transform - Function to apply at the target path
 * @returns A new object with the transform applied at the path
 *
 * @example
 * ```typescript
 * // Update a value
 * transformAtPath({ a: { b: 1 } }, ["a", "b"], x => x + 1) // => { a: { b: 2 } }
 *
 * // Delete a key
 * transformAtPath({ a: { b: 1, c: 2 } }, ["a"], obj => {
 *   const { b, ...rest } = obj
 *   return rest
 * }) // => { a: { c: 2 } }
 *
 * // Transform at root
 * transformAtPath({ x: 1 }, [], obj => ({ ...obj, y: 2 })) // => { x: 1, y: 2 }
 * ```
 */
export function transformAtPath<T extends Record<string, unknown>>(
  obj: T,
  path: string[],
  transform: (target: Record<string, unknown>) => Record<string, unknown>,
): T {
  if (path.length === 0) {
    return transform(obj) as T
  }

  const [head, ...tail] = path
  const child = (obj[head] as Record<string, unknown>) ?? {}
  return {
    ...obj,
    [head]: transformAtPath(child, tail, transform),
  } as T
}

/**
 * Deep clone an object. Pure function.
 * Uses JSON serialization for simplicity and correctness.
 *
 * @param obj - The object to clone
 * @returns A deep copy of the object
 *
 * @example
 * ```typescript
 * const original = { a: { b: [1, 2, 3] } }
 * const cloned = deepClone(original)
 * cloned.a.b.push(4)
 * original.a.b // => [1, 2, 3] (unchanged)
 * ```
 */
export function deepClone<T>(obj: T): T {
  if (obj === null || typeof obj !== "object") return obj
  return JSON.parse(JSON.stringify(obj))
}
