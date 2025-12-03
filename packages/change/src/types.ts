/* =============================================================================
 * UNIFIED BASE SCHEMA MAPPER SYSTEM
 * =============================================================================
 */

import type { ContainerShape, DocShape, Shape } from "./shape.js"

// Input type inference - what developers can pass to push/insert methods
export type InferPlainType<T> = T extends Shape<infer P, any, any> ? P : never

export type InferDraftType<T> = T extends Shape<any, infer D, any> ? D : never

/**
 * Extracts the valid empty state type from a shape.
 *
 * For dynamic containers (list, record, etc.), this will be constrained to
 * empty values ([] or {}) to prevent users from expecting per-entry merging.
 */
export type InferEmptyStateType<T> = T extends Shape<any, any, infer E>
  ? E
  : never

// Draft-specific type inference that properly handles the draft context
export type Draft<T extends DocShape<Record<string, ContainerShape>>> =
  InferDraftType<T>
