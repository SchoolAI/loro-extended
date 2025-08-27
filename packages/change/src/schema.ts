import type {
  Delta,
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

// Rich text types for LoroText
export type TextRange = { start: number; end: number }
export type StyleValue = string | number | boolean | null

// Tree node types for LoroTree
export type TreeNodeID = string
export interface TreeNode {
  readonly id: TreeNodeID
  readonly data: LoroMap
  createNode(): TreeNode
  parent(): TreeNode | null
  children(): TreeNode[]
}

// Base schema types - leaf schemas (non-recursive)
export type LoroLeafSchemaNode =
  | LoroTextSchemaNode
  | LoroCounterSchemaNode
  | LoroTreeSchemaNode
  | z.ZodType // Zod schemas represent leaf values

export type LoroTextSchemaNode = { readonly _type: "text" }
export type LoroCounterSchemaNode = { readonly _type: "counter" }
export type LoroTreeSchemaNode = { readonly _type: "tree" }

// Container schemas using interfaces for recursive references
export interface LoroListSchemaNode<T = LoroIntermediateContainerSchemaNode> {
  readonly _type: "list"
  readonly item: T
}

export interface LoroMovableListSchemaNode<
  T = LoroIntermediateContainerSchemaNode,
> {
  readonly _type: "movableList"
  readonly item: T
}

export interface LoroMapSchemaNode<
  T extends Record<string, LoroIntermediateContainerSchemaNode> = Record<
    string,
    LoroIntermediateContainerSchemaNode
  >,
> {
  readonly _type: "map"
  readonly shape: T
}

export interface LoroDocSchema<
  T extends Record<string, LoroRootContainerSchemaNode> = Record<
    string,
    LoroRootContainerSchemaNode
  >,
> {
  readonly _type: "doc"
  readonly shape: T
}

export type LoroRootContainerSchemaNode =
  | LoroCounterSchemaNode
  | LoroListSchemaNode
  | LoroMapSchemaNode
  | LoroMovableListSchemaNode
  | LoroTextSchemaNode
  | LoroTreeSchemaNode

export type LoroRootContainerType = LoroRootContainerSchemaNode["_type"]

export type LoroIntermediateContainerSchemaNode =
  | LoroRootContainerSchemaNode
  | LoroLeafSchemaNode

// Enhanced text interface
type EnhancedLoroText = LoroText & {
  insert(index: number, content: string): void
  delete(index: number, len: number): void
  toString(): string
  mark(range: TextRange, key: string, value: StyleValue): void
  unmark(range: TextRange, key: string): void
  toDelta(): Delta<string>[]
}

// Enhanced counter interface
type EnhancedLoroCounter = LoroCounter & {
  increment(value: number): void
  decrement(value: number): void
  value: number
}

// Enhanced list interface
type EnhancedLoroList<U> = LoroList<U> & {
  insert(index: number, item: InferValueType<U>): void
  delete(index: number, len?: number): void
  push(item: InferValueType<U>): void
  get(index: number): InferValueType<U> | undefined
  length: number
  toArray(): InferValueType<U>[]
}

// Enhanced movable list interface
type EnhancedLoroMovableList<U> = LoroMovableList<U> & {
  insert(index: number, item: InferValueType<U>): void
  delete(index: number, len?: number): void
  push(item: InferValueType<U>): void
  get(index: number): InferValueType<U> | undefined
  set(index: number, item: InferValueType<U>): void
  move(from: number, to: number): void
  length: number
  toArray(): InferValueType<U>[]
}

// Enhanced map interface
type EnhancedLoroMap<
  U extends Record<string, LoroIntermediateContainerSchemaNode>,
> = LoroMap<U> & {
  [K in keyof U]: InferValueType<U[K]>
} & {
  set<K extends keyof U>(key: K, value: InferValueType<U[K]>): void
  get<K extends keyof U>(key: K): InferValueType<U[K]> | undefined
  delete(key: keyof U): void
  has(key: keyof U): boolean
  keys(): (keyof U)[]
  values(): InferValueType<U[keyof U]>[]
}

// Enhanced tree interface
type EnhancedLoroTree = LoroTree & {
  createNode(parent?: TreeNode): TreeNode
  delete(target: TreeNode): void
  move(target: TreeNode, parent: TreeNode): void
  getNodeByID(id: TreeNodeID): TreeNode | null
}

/* =============================================================================
 * UNIFIED BASE SCHEMA MAPPER SYSTEM
 * =============================================================================
 * We need a similar Loro-type structure at each juncture:
 *
 * - loro: used by EnhancedLoroMap to infer the constructed shape
 * - value:
 */

// Context types for different mapping scenarios
type ValueTypeContext = "value" // Maps to enhanced Loro interfaces (runtime values)
type EmptyTypeContext = "empty" // Maps to empty state types
type InputTypeContext = "input" // Maps to input parameter types
type PojoTypeContext = "pojo" // Maps to plain object types for mutative
type DraftTypeContext = "draft" // Maps to draft-aware types

type MappingContext =
  | ValueTypeContext
  | EmptyTypeContext
  | InputTypeContext
  | PojoTypeContext
  | DraftTypeContext

// Unified base mapper that handles all schema type matching
// biome-ignore format: visual
type BaseSchemaMapper<T, Context extends MappingContext> =
  // Loro container types
  T extends LoroTextSchemaNode
    ? Context extends "value" ? EnhancedLoroText
      : Context extends "empty" ? string
      : Context extends "input" ? string
      : Context extends "pojo" ? string
      : Context extends "draft" ? DraftLoroText
      : never
  : T extends LoroCounterSchemaNode
    ? Context extends "value" ? EnhancedLoroCounter
      : Context extends "empty" ? number
      : Context extends "input" ? number
      : Context extends "pojo" ? number
      : Context extends "draft" ? DraftLoroCounter
      : never
  : T extends LoroListSchemaNode<infer U>
    ? Context extends "value" ? EnhancedLoroList<U>
      : Context extends "empty" ? BaseSchemaMapper<U, Context>[]
      : Context extends "input" ? BaseSchemaMapper<U, Context>[]
      : Context extends "pojo" ? BaseSchemaMapper<U, Context>[]
      : Context extends "draft" ? DraftLoroList<U>
      : never
  : T extends LoroMovableListSchemaNode<infer U>
    ? Context extends "value" ? EnhancedLoroMovableList<U>
      : Context extends "empty" ? BaseSchemaMapper<U, Context>[]
      : Context extends "input" ? BaseSchemaMapper<U, Context>[]
      : Context extends "pojo" ? BaseSchemaMapper<U, Context>[]
      : Context extends "draft" ? DraftLoroMovableList<U>
      : never
  : T extends LoroMapSchemaNode<infer U>
    ? Context extends "value" ? EnhancedLoroMap<U>
      : Context extends "empty" ? { [K in keyof U]: BaseSchemaMapper<U[K], Context> }
      : Context extends "input" ? { [K in keyof U]: BaseSchemaMapper<U[K], Context> }
      : Context extends "pojo" ? { [K in keyof U]: BaseSchemaMapper<U[K], Context> }
      : Context extends "draft" ? DraftLoroMap<U>
      : never
  : T extends LoroTreeSchemaNode
    ? Context extends "value" ? EnhancedLoroTree
      : Context extends "empty" ? any[]
      : Context extends "input" ? any[]
      : Context extends "pojo" ? any[]
      : Context extends "draft" ? DraftLoroTree
      : never
  // Zod types - consistent handling across all contexts
  : T extends z.ZodArray<infer U>
    ? BaseSchemaMapper<U, Context>[]
  : T extends z.ZodType<infer U>
    ? U
  // Recursive handling for intermediate container types
  : T extends LoroIntermediateContainerSchemaNode
    ? BaseSchemaMapper<T, Context>
  // Fallbacks
  : Context extends "draft" ? Draft<T>
    : any

export type InferValueType<T> = BaseSchemaMapper<T, "value">

// Draft-specific type inference that properly handles the draft context
export type InferDraftType<
  T extends LoroDocSchema<Record<string, LoroRootContainerSchemaNode>>,
> = T extends LoroDocSchema<infer U>
  ? { [K in keyof U]: LoroAwareDraft<U[K]> }
  : never

// Composite type that contains both LoroDoc and schema
export type LoroDocWithSchema<
  T extends LoroDocSchema<Record<string, LoroRootContainerSchemaNode>>,
> = {
  doc: LoroDoc
  schema: T
}

// The LoroShape factory object
export const LoroShape = {
  doc: <T extends Record<string, LoroRootContainerSchemaNode>>(
    shape: T,
  ): LoroDocSchema<T> => ({
    _type: "doc" as const,
    shape,
  }),

  counter: (): LoroCounterSchemaNode => ({
    _type: "counter" as const,
  }),

  list: <T extends LoroIntermediateContainerSchemaNode>(
    item: T,
  ): LoroListSchemaNode<T> => ({
    _type: "list" as const,
    item,
  }),

  map: <T extends Record<string, LoroIntermediateContainerSchemaNode>>(
    shape: T,
  ): LoroMapSchemaNode<T> => ({
    _type: "map" as const,
    shape,
  }),

  movableList: <T extends LoroIntermediateContainerSchemaNode>(
    item: T,
  ): LoroMovableListSchemaNode<T> => ({
    _type: "movableList" as const,
    item,
  }),

  text: (): LoroTextSchemaNode => ({
    _type: "text" as const,
  }),

  tree: (): LoroTreeSchemaNode => ({
    _type: "tree" as const,
  }),
}

export type LoroSchemaType =
  | ReturnType<typeof LoroShape.counter>["_type"]
  | ReturnType<typeof LoroShape.list>["_type"]
  | ReturnType<typeof LoroShape.map>["_type"]
  | ReturnType<typeof LoroShape.movableList>["_type"]
  | ReturnType<typeof LoroShape.text>["_type"]
  | ReturnType<typeof LoroShape.tree>["_type"]

// Draft-specific enhanced interfaces
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

type DraftLoroMap<
  U extends Record<string, LoroIntermediateContainerSchemaNode>,
> = LoroMap &
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
      mutator: (draft: InferMapPojoType<LoroMapSchemaNode<U>>) => void,
    ): InferMapPojoType<LoroMapSchemaNode<U>>
  }

type DraftLoroDoc<U extends Record<string, LoroRootContainerSchemaNode>> =
  LoroDoc & {
    [K in keyof U]: InferValueType<U[K]>
  }

// Enhanced draft type that includes CRDT containers
export type LoroAwareDraft<T> = T extends LoroDocSchema<infer U>
  ? DraftLoroDoc<U>
  : BaseSchemaMapper<T, "draft">

// Empty state type inference
export type InferEmptyType<T extends LoroDocSchema> = T extends LoroDocSchema<
  infer U
>
  ? { [K in keyof U]: InferEmptyValue<U[K]> }
  : never

export type InferEmptyValue<T> = BaseSchemaMapper<T, "empty">

// Re-export validation function for convenience
export { createEmptyStateValidator } from "./validation.js"

// Input type inference - what developers can pass to push/insert methods
export type InferInputType<T> = BaseSchemaMapper<T, "input">

// Type utility to extract POJO structure from a map schema
// This converts Loro schema types to their corresponding TypeScript types for mutative
export type InferMapPojoType<T> = T extends LoroMapSchemaNode<infer U>
  ? { [K in keyof U]: InferPojoValueType<U[K]> }
  : never

// Helper type to convert schema nodes to their POJO equivalents
export type InferPojoValueType<T> = BaseSchemaMapper<T, "pojo">
