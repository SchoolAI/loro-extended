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

export interface DocumentShape<
  T extends Record<string, ContainerShape> = Record<string, ContainerShape>,
> {
  readonly _type: "doc"
  readonly shape: T
}

export type TextContainerShape = { readonly _type: "text" }
export type CounterContainerShape = { readonly _type: "counter" }
export interface TreeContainerShape<T = ContainerOrValueShape> {
  readonly _type: "tree"
  readonly shape: T
}

// Container schemas using interfaces for recursive references
export interface ListContainerShape<T = ContainerOrValueShape> {
  readonly _type: "list"
  readonly shape: T
}

export interface MovableListContainerShape<T = ContainerOrValueShape> {
  readonly _type: "movableList"
  readonly shape: T
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

export type ContainerShape =
  | CounterContainerShape
  | ListContainerShape
  | MapContainerShape
  | MovableListContainerShape
  | TextContainerShape
  | TreeContainerShape

export type RootContainerType = ContainerShape["_type"]

// LoroValue shape types - these represent Loro's Value types
export type StringValueShape = {
  readonly _type: "value"
  readonly valueType: "string"
}
export type NumberValueShape = {
  readonly _type: "value"
  readonly valueType: "number"
}
export type BooleanValueShape = {
  readonly _type: "value"
  readonly valueType: "boolean"
}
export type NullValueShape = {
  readonly _type: "value"
  readonly valueType: "null"
}
export type UndefinedValueShape = {
  readonly _type: "value"
  readonly valueType: "undefined"
}
export type Uint8ArrayValueShape = {
  readonly _type: "value"
  readonly valueType: "uint8array"
}

export interface ObjectValueShape<
  T extends Record<string, ValueShape> = Record<string, ValueShape>,
> {
  readonly _type: "value"
  readonly valueType: "object"
  readonly shape: T
}

export interface ArrayValueShape<T extends ValueShape = ValueShape> {
  readonly _type: "value"
  readonly valueType: "array"
  readonly shape: T
}

export interface UnionValueShape<T extends ValueShape[] = ValueShape[]> {
  readonly _type: "value"
  readonly valueType: "union"
  readonly shapes: T
}

// Union of all ValueShapes - these can only contain other ValueShapes, not ContainerShapes
export type ValueShape =
  | StringValueShape
  | NumberValueShape
  | BooleanValueShape
  | NullValueShape
  | UndefinedValueShape
  | Uint8ArrayValueShape
  | ObjectValueShape
  | ArrayValueShape
  | UnionValueShape

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
  // : T extends TreeContainerShape<infer U>
  //   ? Context extends "value" ? LoroTree
  //     : Context extends "input" ? BaseSchemaMapper<U, "input">[]
  //     : Context extends "draft" ? DraftLoroTree<U>
  //     : never
  : T extends StringValueShape
    ? Context extends "value" ? string
      : Context extends "input" ? string
      : Context extends "draft" ? string
      : never
  : T extends NumberValueShape
    ? Context extends "value" ? number
      : Context extends "input" ? number
      : Context extends "draft" ? number
      : never
  : T extends BooleanValueShape
    ? Context extends "value" ? boolean
      : Context extends "input" ? boolean
      : Context extends "draft" ? boolean
      : never
  : T extends NullValueShape
    ? Context extends "value" ? null
      : Context extends "input" ? null
      : Context extends "draft" ? null
      : never
  : T extends UndefinedValueShape
    ? Context extends "value" ? undefined
      : Context extends "input" ? undefined
      : Context extends "draft" ? undefined
      : never
  : T extends Uint8ArrayValueShape
    ? Context extends "value" ? Uint8Array
      : Context extends "input" ? Uint8Array
      : Context extends "draft" ? Uint8Array
      : never
  : T extends ObjectValueShape<infer U>
    ? Context extends "value" ? { [K in keyof U]: BaseSchemaMapper<U[K], "value"> }
      : Context extends "input" ? { [K in keyof U]: BaseSchemaMapper<U[K], "input"> }
      : Context extends "draft" ? { [K in keyof U]: BaseSchemaMapper<U[K], "draft"> }
      : never
  : T extends ArrayValueShape<infer U>
    ? Context extends "value" ? BaseSchemaMapper<U, "value">[]
      : Context extends "input" ? BaseSchemaMapper<U, "input">[]
      : Context extends "draft" ? BaseSchemaMapper<U, "draft">[]
      : never
  : T extends UnionValueShape<infer U>
    ? U extends readonly ValueShape[]
      ? Context extends "value" ? BaseSchemaMapper<U, "value">
        : Context extends "input" ? BaseSchemaMapper<U, "input">
        : Context extends "draft" ? BaseSchemaMapper<U, "draft">
        : never
      : never
  // biome-ignore lint/suspicious/noExplicitAny: required for type system to work
  : any

/**
 * The LoroShape factory object
 *
 * If a container has a `shape` type variable, it refers the the shape it contains--
 * so for example, a `LoroShape.list(LoroShape.text())` would return a value of type
 * `ListContainerShape<TextContainerShape>`.
 */
export const Shape = {
  doc: <T extends Record<string, ContainerShape>>(
    shape: T,
  ): DocumentShape<T> => ({
    _type: "doc" as const,
    shape,
  }),

  crdt: {
    counter: (): CounterContainerShape => ({
      _type: "counter" as const,
    }),

    list: <T extends ContainerOrValueShape>(
      shape: T,
    ): ListContainerShape<T> => ({
      _type: "list" as const,
      shape,
    }),

    map: <T extends Record<string, ContainerOrValueShape>>(
      shape: T,
    ): MapContainerShape<T> => ({
      _type: "map" as const,
      shape,
    }),

    movableList: <T extends ContainerOrValueShape>(
      shape: T,
    ): MovableListContainerShape<T> => ({
      _type: "movableList" as const,
      shape,
    }),

    text: (): TextContainerShape => ({
      _type: "text" as const,
    }),

    tree: <T extends MapContainerShape>(shape: T): TreeContainerShape => ({
      _type: "tree" as const,
      shape,
    }),
  },
  value: {
    string: (): StringValueShape => ({
      _type: "value" as const,
      valueType: "string" as const,
    }),

    number: (): NumberValueShape => ({
      _type: "value" as const,
      valueType: "number" as const,
    }),

    boolean: (): BooleanValueShape => ({
      _type: "value" as const,
      valueType: "boolean" as const,
    }),

    null: (): NullValueShape => ({
      _type: "value" as const,
      valueType: "null" as const,
    }),

    undefined: (): UndefinedValueShape => ({
      _type: "value" as const,
      valueType: "undefined" as const,
    }),

    uint8Array: (): Uint8ArrayValueShape => ({
      _type: "value" as const,
      valueType: "uint8array" as const,
    }),

    object: <T extends Record<string, ValueShape>>(
      shape: T,
    ): ObjectValueShape<T> => ({
      _type: "value" as const,
      valueType: "object" as const,
      shape,
    }),

    array: <T extends ValueShape>(shape: T): ArrayValueShape<T> => ({
      _type: "value" as const,
      valueType: "array" as const,
      shape,
    }),

    union: <T extends ValueShape[]>(shapes: T): UnionValueShape<T> => ({
      _type: "value" as const,
      valueType: "union" as const,
      shapes,
    }),
  },
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
}

type DraftLoroMap<U extends Record<string, ContainerOrValueShape>> = {
  [K in keyof U]: BaseSchemaMapper<U[K], "draft">
} & {
  set<K extends keyof U>(key: K, value: InferInputType<U[K]>): void
  get<K extends keyof U>(key: K): InferInputType<U[K]> | undefined
  delete(key: keyof U): void
  has(key: keyof U): boolean
  keys(): (keyof U)[]
  values(): InferInputType<U[keyof U]>[]
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
export type Draft<T extends DocumentShape<Record<string, ContainerShape>>> =
  T extends DocumentShape<infer U>
    ? { [K in keyof U]: BaseSchemaMapper<U[K], "draft"> }
    : never
