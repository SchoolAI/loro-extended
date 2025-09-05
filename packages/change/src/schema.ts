import type {
  ContainerID,
  Delta,
  LoroCounter,
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
export type ValueShape = z.ZodType // Zod schemas represent leaf values

export type TextContainerShape = { readonly _type: "text" }
export type CounterContainerShape = { readonly _type: "counter" }
export interface TreeContainerShape<T = ContainerOrValueShape> {
  readonly _type: "tree"
  readonly item: T
}

// Container schemas using interfaces for recursive references
export interface ListContainerShape<T = ContainerOrValueShape> {
  readonly _type: "list"
  readonly item: T
}

export interface MovableListContainerShape<T = ContainerOrValueShape> {
  readonly _type: "movableList"
  readonly item: T
}

export interface MapContainerShape<
  T extends Record<string, ContainerOrValueShape> = Record<
    string,
    ContainerOrValueShape
  >,
> {
  readonly _type: "map"
  readonly shape: T
}

export interface LoroDocShape<
  T extends Record<string, ContainerShape> = Record<
    string,
    ContainerShape
  >,
> {
  readonly _type: "doc"
  readonly shape: T
}

export type ContainerShape =
  | CounterContainerShape
  | ListContainerShape
  | MapContainerShape
  | MovableListContainerShape
  | TextContainerShape
  | TreeContainerShape

export type RootContainerType = ContainerShape["_type"]

export type ContainerOrValueShape = ContainerShape | ValueShape

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
  T extends TextContainerShape
    ? Context extends "value" ? LoroText
      : Context extends "input" ? string
      : Context extends "draft" ? DraftLoroText
      : never
  : T extends CounterContainerShape
    ? Context extends "value" ? LoroCounter
      : Context extends "input" ? number
      : Context extends "draft" ? DraftLoroCounter
      : never
  : T extends ListContainerShape<infer U>
    ? Context extends "value" ? LoroList<U>
      : Context extends "input" ? BaseSchemaMapper<U, "input">[]
      : Context extends "draft" ? DraftLoroList<U>
      : never
  : T extends MovableListContainerShape<infer U>
    ? Context extends "value" ? LoroMovableList<U>
      : Context extends "input" ? BaseSchemaMapper<U, "input">[]
      : Context extends "draft" ? DraftLoroMovableList<U>
      : never
  : T extends MapContainerShape<infer U>
    ? Context extends "value" ? LoroMap<U>
      : Context extends "input" ? { [K in keyof U]: BaseSchemaMapper<U[K], "input"> }
      : Context extends "draft" ? DraftLoroMap<U>
      : never
  : T extends TreeContainerShape<infer U>
    ? Context extends "value" ? LoroTree
      : Context extends "input" ? BaseSchemaMapper<U, "input">[]
      : Context extends "draft" ? DraftLoroTree<U>
      : never
  // Zod types - consistent handling across all contexts
  : T extends z.ZodArray<infer U>
    ? BaseSchemaMapper<U, Context>[]
  : T extends z.ZodType<infer U>
    ? U
  // biome-ignore lint/suspicious/noExplicitAny: required for type system to work
  : any

// The LoroShape factory object
export const LoroShape = {
  doc: <T extends Record<string, ContainerShape>>(
    shape: T,
  ): LoroDocShape<T> => ({
    _type: "doc" as const,
    shape,
  }),

  counter: (): CounterContainerShape => ({
    _type: "counter" as const,
  }),

  list: <T extends ContainerOrValueShape>(
    item: T,
  ): ListContainerShape<T> => ({
    _type: "list" as const,
    item,
  }),

  map: <T extends Record<string, ContainerOrValueShape>>(
    shape: T,
  ): MapContainerShape<T> => ({
    _type: "map" as const,
    shape,
  }),

  movableList: <T extends ContainerOrValueShape>(
    item: T,
  ): MovableListContainerShape<T> => ({
    _type: "movableList" as const,
    item,
  }),

  text: (): TextContainerShape => ({
    _type: "text" as const,
  }),

  tree: <T extends MapContainerShape>(item: T): TreeContainerShape => ({
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
  // For LoroTree, the `U` type here is different: it's the metadata for the tree, not the content...
  U,
  // ... so that's why we extend LoroMapShape here
  T extends Record<string, unknown> = U extends MapContainerShape<infer M>
    ? { [K in keyof M]: InferInputType<M[K]> }
    : Record<string, unknown>,
> = {
  toArray(): TreeNodeValue[]
  createNode(parent?: TreeID, index?: number): LoroTreeNode<T>
  move(target: TreeID, parent: TreeID | undefined, index?: number | null): void
  delete(target: TreeID): void
  has(target: TreeID): boolean
  isNodeDeleted(target: TreeID): boolean
  getNodeByID(target: TreeID): LoroTreeNode<T> | undefined
  nodes(): LoroTreeNode<T>[]
  getNodes(options?: { withDeleted?: boolean }): LoroTreeNode<T>[]
  roots(): LoroTreeNode<T>[]
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

type DraftLoroMap<U extends Record<string, ContainerOrValueShape>> = {
  [K in keyof U]: BaseSchemaMapper<U[K], "draft">
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
    mutator: (draft: InferInputType<MapContainerShape<U>>) => void,
  ): InferInputType<MapContainerShape<U>>
  clear(): void
  getLastEditor(key: string): PeerID | undefined
  isDeleted(): boolean
  readonly id: ContainerID
  readonly size: number
}

// Input type inference - what developers can pass to push/insert methods
export type InferInputType<T> = BaseSchemaMapper<T, "input">

// Value type inference
export type InferValueType<T> = BaseSchemaMapper<T, "value">

// Draft-specific type inference that properly handles the draft context
export type Draft<
  T extends LoroDocShape<Record<string, ContainerShape>>,
> = T extends LoroDocShape<infer U>
  ? { [K in keyof U]: BaseSchemaMapper<U[K], "draft"> }
  : never
