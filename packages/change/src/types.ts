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
 * Mutable type for use within change() callbacks and direct mutations on doc.value.
 * This is the type-safe wrapper around CRDT containers that allows mutation.
 */
export type Mutable<T extends DocShape<Record<string, ContainerShape>>> =
  InferMutableType<T>

/**
 * @deprecated Use Mutable<T> instead. Draft is an alias kept for backwards compatibility.
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
