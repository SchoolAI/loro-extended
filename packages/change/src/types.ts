/* =============================================================================
 * UNIFIED BASE SCHEMA MAPPER SYSTEM
 * =============================================================================
 */

import type { ContainerID, Delta, PeerID, TextUpdateOptions, Value } from "loro-crdt"
import type {
  ArrayValueShape,
  BooleanValueShape,
  ContainerOrValueShape,
  ContainerShape,
  CounterContainerShape,
  DocShape,
  ListContainerShape,
  MapContainerShape,
  MovableListContainerShape,
  NullValueShape,
  NumberValueShape,
  ObjectValueShape,
  StringValueShape,
  TextContainerShape,
  Uint8ArrayValueShape,
  UndefinedValueShape,
  UnionValueShape,
  ValueShape,
} from "./shape.js"

// Context types for different mapping scenarios
type PlainTypeContext = "plain" // Maps to input parameter types
type DraftTypeContext = "draft" // Maps to draft-aware types

type MappingContext = PlainTypeContext | DraftTypeContext

// Unified base mapper that handles all schema type matching
// biome-ignore format: visual
type BaseSchemaMapper<T, Context extends MappingContext> =
  // LoroDoc is at the root
  T extends DocShape<infer U>
    ? Context extends "plain" ? { [K in keyof U]: BaseSchemaMapper<U[K], "plain"> }
      : Context extends "draft" ? object
      : never
  // Loro container types
  : T extends TextContainerShape
    ? Context extends "plain" ? string
      : Context extends "draft" ? DraftLoroText
      : never
  : T extends CounterContainerShape
    ? Context extends "plain" ? number
      : Context extends "draft" ? DraftLoroCounter
      : never
  : T extends ListContainerShape<infer U>
    ? Context extends "plain" ? BaseSchemaMapper<U, "plain">[]
      : Context extends "draft" ? DraftLoroList<U>
      : never
  : T extends MovableListContainerShape<infer U>
    ? Context extends "plain" ? BaseSchemaMapper<U, "plain">[]
      : Context extends "draft" ? DraftLoroMovableList<U>
      : never
  : T extends MapContainerShape<infer U>
    ? Context extends "plain" ? { [K in keyof U]: BaseSchemaMapper<U[K], "plain"> }
      : Context extends "draft" ? DraftLoroMap<U>
      : never
  // : T extends TreeContainerShape<infer U>
  //   ? Context extends "plain" ? BaseSchemaMapper<U, "plain">[]
  //     : Context extends "draft" ? DraftLoroTree<U>
  //     : never
  // Values
  : T extends StringValueShape
    ? Context extends "plain" ? string
      : Context extends "draft" ? string
      : never
  : T extends NumberValueShape
    ? Context extends "plain" ? number
      : Context extends "draft" ? number
      : never
  : T extends BooleanValueShape
    ? Context extends "plain" ? boolean
      : Context extends "draft" ? boolean
      : never
  : T extends NullValueShape
    ? Context extends "plain" ? null
      : Context extends "draft" ? null
      : never
  : T extends UndefinedValueShape
    ? Context extends "plain" ? undefined
      : Context extends "draft" ? undefined
      : never
  : T extends Uint8ArrayValueShape
    ? Context extends "plain" ? Uint8Array
      : Context extends "draft" ? Uint8Array
      : never
  : T extends ObjectValueShape<infer U>
    ? Context extends "plain" ? { [K in keyof U]: BaseSchemaMapper<U[K], "plain"> }
      : Context extends "draft" ? { [K in keyof U]: BaseSchemaMapper<U[K], "draft"> }
      : never
  : T extends ArrayValueShape<infer U>
    ? Context extends "plain" ? BaseSchemaMapper<U, "plain">[]
      : Context extends "draft" ? BaseSchemaMapper<U, "draft">[]
      : never
  : T extends UnionValueShape<infer U>
    ? U extends readonly ValueShape[]
      ? Context extends "plain" ? BaseSchemaMapper<U, "plain">
        : Context extends "draft" ? BaseSchemaMapper<U, "draft">
        : never
      : never
  // biome-ignore lint/suspicious/noExplicitAny: required for type system to work
  : any

// Input type inference - what developers can pass to push/insert methods
export type InferPlainType<T> = BaseSchemaMapper<T, "plain">

// Draft-specific type inference that properly handles the draft context
export type Draft<T extends DocShape<Record<string, ContainerShape>>> =
  T extends DocShape<infer U>
    ? { [K in keyof U]: BaseSchemaMapper<U[K], "draft"> }
    : never

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

// type DraftLoroTree<
//   // For LoroTree, the `U` type here is different: it's the metadata for the tree, not the content...
//   U,
//   // ... so that's why we extend LoroMapShape here
//   T extends Record<string, unknown> = U extends MapContainerShape<infer M>
//     ? { [K in keyof M]: InferInputType<M[K]> }
//     : Record<string, unknown>,
// > = {
//   toArray(): TreeNodeValue[]
//   createNode(parent?: TreeID, index?: number): LoroTreeNode<T>
//   move(target: TreeID, parent: TreeID | undefined, index?: number | null): void
//   delete(target: TreeID): void
//   has(target: TreeID): boolean
//   isNodeDeleted(target: TreeID): boolean
//   getNodeByID(target: TreeID): LoroTreeNode<T> | undefined
//   nodes(): LoroTreeNode<T>[]
//   getNodes(options?: { withDeleted?: boolean }): LoroTreeNode<T>[]
//   roots(): LoroTreeNode<T>[]
//   isDeleted(): boolean
//   readonly id: ContainerID
// }

type DraftLoroList<U, T = InferPlainType<U>> = {
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

  // Array-like methods
  find(predicate: (item: T, index: number) => boolean): T | undefined
  findIndex(predicate: (item: T, index: number) => boolean): number
  map<ReturnType>(
    callback: (item: T, index: number) => ReturnType,
  ): ReturnType[]
  filter(predicate: (item: T, index: number) => boolean): T[]
  forEach(callback: (item: T, index: number) => void): void
  some(predicate: (item: T, index: number) => boolean): boolean
  every(predicate: (item: T, index: number) => boolean): boolean
}

type DraftLoroMovableList<U, T = InferPlainType<U>> = {
  toArray(): T[]
  get(index: number): T
  set(index: number, item: T): void
  push(item: T): void
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

  // Array-like methods
  find(predicate: (item: T, index: number) => boolean): T | undefined
  findIndex(predicate: (item: T, index: number) => boolean): number
  map<ReturnType>(
    callback: (item: T, index: number) => ReturnType,
  ): ReturnType[]
  filter(predicate: (item: T, index: number) => boolean): T[]
  forEach(callback: (item: T, index: number) => void): void
  some(predicate: (item: T, index: number) => boolean): boolean
  every(predicate: (item: T, index: number) => boolean): boolean
}

type DraftLoroMap<U extends Record<string, ContainerOrValueShape>> = {
  [K in keyof U]: BaseSchemaMapper<U[K], "draft">
} & {
  set<K extends keyof U>(key: K, value: InferPlainType<U[K]>): void
  get<K extends keyof U>(key: K): InferPlainType<U[K]> | undefined
  delete(key: keyof U): void
  has(key: keyof U): boolean
  keys(): (keyof U)[]
  values(): InferPlainType<U[keyof U]>[]
  entries(): [keyof U, U[keyof U]][]
  clear(): void
  getLastEditor(key: string): PeerID | undefined
  isDeleted(): boolean
  readonly id: ContainerID
  readonly size: number
}
