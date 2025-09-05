import type {
  ContainerID,
  Delta,
  LoroCounter,
  LoroDoc,
  LoroList,
  LoroMap,
  LoroMovableList,
  LoroText,
  LoroTree,
  LoroTreeNode,
  PeerID,
  TextUpdateOptions,
  TreeID,
  TreeNodeValue,
  Value,
} from "loro-crdt"
import type { z } from "zod"

// Base schema types - leaf schemas (non-recursive)
export type LoroLeafShape =
  | LoroTextShape
  | LoroCounterShape
  | LoroTreeShape
  | z.ZodType // Zod schemas represent leaf values

export type LoroTextShape = { readonly _type: "text" }
export type LoroCounterShape = { readonly _type: "counter" }
export interface LoroTreeShape<T = LoroIntermediateContainerShape> {
  readonly _type: "tree"
  readonly item: T
}

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
  : T extends LoroTreeShape<infer U>
    ? Context extends "value" ? LoroTree
      : Context extends "input" ? any[]
      : Context extends "draft" ? DraftLoroTree<U>
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

  tree: <T extends LoroIntermediateContainerShape>(item: T): LoroTreeShape => ({
    _type: "tree" as const,
    item,
  }),
}

// Draft-specific interfaces
type DraftLoroText = {
  update(text: string, options?: TextUpdateOptions): void
  updateByLine(text: string, options?: TextUpdateOptions): void
  iter(callback: (text: string) => boolean): void
  insert(index: number, content: string): void
  slice(start_index: number, end_index: number): string
  charAt(pos: number): string
  splice(pos: number, len: number, s: string): string
  insertUtf8(index: number, content: string): void
  delete(index: number, len: number): void
  deleteUtf8(index: number, len: number): void
  mark(range: { start: number; end: number }, key: string, value: any): void
  unmark(range: { start: number; end: number }, key: string): void
  toDelta(): Delta<string>[]
  applyDelta(delta: Delta<string>[]): void
  push(s: string): void
  getEditorOf(pos: number): PeerID | undefined
  toString(): string
  readonly id: ContainerID
  readonly length: number
}

type DraftLoroCounter = {
  increment(value: number): void
  decrement(value: number): void
  readonly id: ContainerID
  readonly value: number
}

type DraftLoroTree<
  U,
  T extends Record<string, unknown> = Record<string, unknown>,
> = {
  toArray(): TreeNodeValue[]
  createNode(parent?: TreeID, index?: number): LoroTreeNode<T>
  move(target: TreeID, parent: TreeID | undefined, index?: number | null): void
  delete(target: TreeID): void
  has(target: TreeID): boolean
  isNodeDeleted(target: TreeID): boolean
  getNodeByID(target: TreeID): LoroTreeNode<T> | undefined
  nodes(): LoroTreeNode[]
  getNodes(options?: { withDeleted?: boolean }): LoroTreeNode<T>[]
  roots(): LoroTreeNode[]
  isDeleted(): boolean
  readonly id: ContainerID
}

type DraftLoroList<U, T = InferInputType<U>> = {
  toArray(): T[]
  get(index: number): T
  set(index: number, item: T): void
  push(item: T): void
  insert(index: number, item: T): void
  delete(pos: number, len: number): void
  pop(): Value | undefined
  clear(): void
  getIdAt(pos: number): { peer: PeerID; counter: number } | undefined
  isDeleted(): boolean
  readonly id: ContainerID
  readonly length: number
}

type DraftLoroMovableList<U, T = InferInputType<U>> = {
  toArray(): T[]
  get(index: number): T
  // set<V extends T>(pos: number, value: Exclude<V, Container>): void
  set(index: number, item: T): void
  // push<V extends T>(value: Exclude<V, Container>): void
  push(item: T): void
  // insert<V extends T>(pos: number, value: Exclude<V, Container>): void
  insert(index: number, item: T): void
  delete(pos: number, len: number): void
  pop(): Value | undefined
  clear(): void
  isDeleted(): boolean

  move(from: number, to: number): void
  getCreatorAt(pos: number): PeerID | undefined
  getLastMoverAt(pos: number): PeerID | undefined
  getLastEditorAt(pos: number): PeerID | undefined
  readonly id: ContainerID
  readonly length: number
}

type DraftLoroMap<U extends Record<string, LoroIntermediateContainerShape>> = {
  [K in keyof U]: LoroAwareDraft<U[K]>
} & {
  // set<Key extends keyof T, V extends T[Key]>(key: Key, value: Exclude<V, Container>): void
  set<K extends keyof U>(key: K, value: InferValueType<U[K]>): void
  // get<Key extends keyof T>(key: Key): T[Key]
  get<K extends keyof U>(key: K): InferValueType<U[K]> | undefined
  // delete(key: string): void
  delete(key: keyof U): void
  has(key: keyof U): boolean
  keys(): (keyof U)[]
  values(): InferValueType<U[keyof U]>[]
  entries(): [keyof U, U[keyof U]][]
  update(
    mutator: (draft: InferInputType<LoroMapShape<U>>) => void,
  ): InferInputType<LoroMapShape<U>>
  clear(): void
  getLastEditor(key: string): PeerID | undefined
  isDeleted(): boolean
  readonly id: ContainerID
  readonly size: number
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
