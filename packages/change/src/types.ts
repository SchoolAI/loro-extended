/* =============================================================================
 * UNIFIED BASE SCHEMA MAPPER SYSTEM
 * =============================================================================
 */

import type { ContainerShape, DocShape, Shape } from "./shape.js"

/**
 * Infers the plain (JSON-serializable) type from any Shape.
 *
 * This is the recommended way to extract types from shapes.
 * Works with DocShape, ContainerShape, and ValueShape.
 *
 * @example
 * ```typescript
 * const ChatSchema = Shape.doc({
 *   messages: Shape.list(Shape.map({
 *     id: Shape.plain.string(),
 *     content: Shape.text(),
 *   })),
 * })
 *
 * // Extract the document type
 * type ChatDoc = Infer<typeof ChatSchema>
 * // Result: { messages: { id: string; content: string }[] }
 *
 * const PresenceSchema = Shape.plain.object({
 *   name: Shape.plain.string(),
 *   cursor: Shape.plain.object({ x: Shape.plain.number(), y: Shape.plain.number() }),
 * })
 *
 * // Extract the presence type
 * type Presence = Infer<typeof PresenceSchema>
 * // Result: { name: string; cursor: { x: number; y: number } }
 * ```
 */
export type Infer<T> = T extends Shape<infer P, any, any> ? P : never

/**
 * Infers the mutable type from any Shape.
 * This is the type used within change() callbacks for mutation.
 */
export type InferMutableType<T> = T extends Shape<any, infer M, any> ? M : never

/**
 * @deprecated Use InferMutableType<T> instead
 */
export type InferDraftType<T> = InferMutableType<T>

/**
 * Extracts the valid placeholder type from a shape.
 *
 * For dynamic containers (list, record, etc.), this will be constrained to
 * empty values ([] or {}) to prevent users from expecting per-entry merging.
 */
export type InferPlaceholderType<T> = T extends Shape<any, any, infer P>
  ? P
  : never

/**
 * Mutable type for use within change() callbacks.
 * This is the type-safe wrapper around CRDT containers that allows mutation.
 */
export type Mutable<T extends DocShape<Record<string, ContainerShape>>> =
  InferMutableType<T>

/**
 * @deprecated Use Mutable<T> instead
 */
export type Draft<T extends DocShape<Record<string, ContainerShape>>> =
  Mutable<T>

/**
 * Interface for objects that have a toJSON method.
 * This is separate from the data type to avoid polluting Object.values().
 */
export interface HasToJSON<T> {
  toJSON(): T
}

/**
 * Deep readonly wrapper for plain objects (no index signature).
 * Includes toJSON() method.
 */
export type DeepReadonlyObject<T extends object> = {
  readonly [P in keyof T]: DeepReadonly<T[P]>
} & HasToJSON<T>

/**
 * Deep readonly wrapper for Record types (with string index signature).
 * The toJSON() method is available but NOT part of the index signature,
 * so Object.values() returns clean types.
 */
export type DeepReadonlyRecord<T> = {
  readonly [K in keyof T]: DeepReadonly<T[K]>
} & HasToJSON<Record<string, T[keyof T]>>

/**
 * Deep readonly wrapper that makes all properties readonly recursively
 * and adds a toJSON() method for JSON serialization.
 *
 * For arrays: Returns ReadonlyArray with toJSON()
 * For objects with string index signature (Records): toJSON() is available
 *   but doesn't pollute Object.values() type inference
 * For plain objects: Returns readonly properties with toJSON()
 * For primitives: Returns as-is
 */
export type DeepReadonly<T> = T extends any[]
  ? ReadonlyArray<DeepReadonly<T[number]>> & HasToJSON<T>
  : T extends object
    ? string extends keyof T
      ? DeepReadonlyRecord<T>
      : DeepReadonlyObject<T>
    : T
