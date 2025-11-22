/* =============================================================================
 * UNIFIED BASE SCHEMA MAPPER SYSTEM
 * =============================================================================
 */

import type { ContainerShape, DocShape, Shape } from "./shape.js"

// Input type inference - what developers can pass to push/insert methods
export type InferPlainType<T> = T extends Shape<infer P, any> ? P : never

export type InferDraftType<T> = T extends Shape<any, infer D> ? D : never

// Draft-specific type inference that properly handles the draft context
export type Draft<T extends DocShape<Record<string, ContainerShape>>> =
  InferDraftType<T>
