import type {
  LoroCounter,
  LoroDoc,
  LoroList,
  LoroMap,
  LoroMovableList,
  LoroText,
  LoroTree,
} from "loro-crdt"
import type { Draft } from "mutative"
import type { z } from "zod"

// Base schema types - leaf schemas (non-recursive)
export type LoroLeafShape =
  | LoroTextShape
  | LoroCounterShape
  | LoroTreeShape
  | z.ZodType // Zod schemas represent leaf values

export type LoroTextShape = { readonly _type: "text" }
export type LoroCounterShape = { readonly _type: "counter" }
export type LoroTreeShape = { readonly _type: "tree" }

// Container schemas using interfaces for recursive references
export interface LoroListShape<T = LoroIntermediateContainerShape> {
  readonly _type: "list"
  readonly item: T
}

export interface LoroMovableListShape<T = LoroIntermediateContainerShape> {
  readonly _type: "movableList"
  readonly item: T
}

export interface LoroMapShape<
  T extends Record<string, LoroIntermediateContainerShape> = Record<
    string,
    LoroIntermediateContainerShape
  >,
> {
  readonly _type: "map"
  readonly shape: T
}

export interface LoroDocShape<
  T extends Record<string, LoroRootContainerShape> = Record<
    string,
    LoroRootContainerShape
  >,
> {
  readonly _type: "doc"
  readonly shape: T
}

export type LoroRootContainerShape =
  | LoroCounterShape
  | LoroListShape
  | LoroMapShape
  | LoroMovableListShape
  | LoroTextShape
  | LoroTreeShape

export type LoroRootContainerType = LoroRootContainerShape["_type"]

export type LoroIntermediateContainerShape =
  | LoroRootContainerShape
  | LoroLeafShape

/* =============================================================================
 * UNIFIED BASE SCHEMA MAPPER SYSTEM
 * =============================================================================
 */

// Context types for different mapping scenarios
type ValueTypeContext = "value" // Maps to Loro interfaces (runtime values)
type InputTypeContext = "input" // Maps to input parameter types
type DraftTypeContext = "draft" // Maps to draft-aware types

type MappingContext = ValueTypeContext | InputTypeContext | DraftTypeContext

// Unified base mapper that handles all schema type matching
// biome-ignore format: visual
type BaseSchemaMapper<T, Context extends MappingContext> =
  // Loro container types
  T extends LoroTextShape
    ? Context extends "value" ? LoroText
      : Context extends "input" ? string
      : Context extends "draft" ? DraftLoroText
      : never
  : T extends LoroCounterShape
    ? Context extends "value" ? LoroCounter
      : Context extends "input" ? number
      : Context extends "draft" ? DraftLoroCounter
      : never
  : T extends LoroListShape<infer U>
    ? Context extends "value" ? LoroList<U>
      : Context extends "input" ? BaseSchemaMapper<U, Context>[]
      : Context extends "draft" ? DraftLoroList<U>
      : never
  : T extends LoroMovableListShape<infer U>
    ? Context extends "value" ? LoroMovableList<U>
      : Context extends "input" ? BaseSchemaMapper<U, Context>[]
      : Context extends "draft" ? DraftLoroMovableList<U>
      : never
  : T extends LoroMapShape<infer U>
    ? Context extends "value" ? LoroMap<U>
      : Context extends "input" ? { [K in keyof U]: BaseSchemaMapper<U[K], Context> }
      : Context extends "draft" ? DraftLoroMap<U>
      : never
  : T extends LoroTreeShape
    ? Context extends "value" ? LoroTree
      : Context extends "input" ? any[]
      : Context extends "draft" ? DraftLoroTree
      : never
  // Zod types - consistent handling across all contexts
  : T extends z.ZodArray<infer U>
    ? BaseSchemaMapper<U, Context>[]
  : T extends z.ZodType<infer U>
    ? U
  // Recursive handling for intermediate container types
  : T extends LoroIntermediateContainerShape
    ? BaseSchemaMapper<T, Context>
  // Fallbacks
  : Context extends "draft" ? Draft<T>
    : any

export type InferValueType<T> = BaseSchemaMapper<T, "value">

// Draft-specific type inference that properly handles the draft context
export type InferDraftType<
  T extends LoroDocShape<Record<string, LoroRootContainerShape>>,
> = T extends LoroDocShape<infer U>
  ? { [K in keyof U]: LoroAwareDraft<U[K]> }
  : never

// The LoroShape factory object
export const LoroShape = {
  doc: <T extends Record<string, LoroRootContainerShape>>(
    shape: T,
  ): LoroDocShape<T> => ({
    _type: "doc" as const,
    shape,
  }),

  counter: (): LoroCounterShape => ({
    _type: "counter" as const,
  }),

  list: <T extends LoroIntermediateContainerShape>(
    item: T,
  ): LoroListShape<T> => ({
    _type: "list" as const,
    item,
  }),

  map: <T extends Record<string, LoroIntermediateContainerShape>>(
    shape: T,
  ): LoroMapShape<T> => ({
    _type: "map" as const,
    shape,
  }),

  movableList: <T extends LoroIntermediateContainerShape>(
    item: T,
  ): LoroMovableListShape<T> => ({
    _type: "movableList" as const,
    item,
  }),

  text: (): LoroTextShape => ({
    _type: "text" as const,
  }),

  tree: (): LoroTreeShape => ({
    _type: "tree" as const,
  }),
}

// Draft-specific interfaces
type DraftLoroText = LoroText & Draft<LoroText>
type DraftLoroCounter = LoroCounter & Draft<LoroCounter>
type DraftLoroTree = LoroTree & Draft<LoroTree>

type DraftLoroList<U> = LoroList &
  Draft<LoroList> & {
    push(item: InferInputType<U>): void
    insert(index: number, item: InferInputType<U>): void
  }

type DraftLoroMovableList<U> = LoroMovableList &
  Draft<LoroMovableList> & {
    push(item: InferInputType<U>): void
    insert(index: number, item: InferInputType<U>): void
    move(from: number, to: number): void
  }

type DraftLoroMap<U extends Record<string, LoroIntermediateContainerShape>> =
  LoroMap &
    Draft<LoroMap> & {
      [K in keyof U]: LoroAwareDraft<U[K]>
    } & {
      set<K extends keyof U>(key: K, value: InferValueType<U[K]>): void
      get<K extends keyof U>(key: K): InferValueType<U[K]> | undefined
      delete(key: keyof U): void
      has(key: keyof U): boolean
      keys(): (keyof U)[]
      values(): InferValueType<U[keyof U]>[]
      update(
        mutator: (draft: InferInputType<LoroMapShape<U>>) => void,
      ): InferInputType<LoroMapShape<U>>
    }

type DraftLoroDoc<U extends Record<string, LoroRootContainerShape>> =
  LoroDoc & {
    [K in keyof U]: InferValueType<U[K]>
  }

// Enhanced draft type that includes CRDT containers
export type LoroAwareDraft<T> = T extends LoroDocShape<infer U>
  ? DraftLoroDoc<U>
  : BaseSchemaMapper<T, "draft">

// Input type inference - what developers can pass to push/insert methods
export type InferInputType<T> = BaseSchemaMapper<T, "input">
