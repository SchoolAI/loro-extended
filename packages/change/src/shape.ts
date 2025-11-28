// biome-ignore-all lint/suspicious/noExplicitAny: required

import type {
  LoroCounter,
  LoroList,
  LoroMap,
  LoroMovableList,
  LoroText,
  LoroTree,
} from "loro-crdt"

import type { CounterDraftNode } from "./draft-nodes/counter.js"
import type { ListDraftNode } from "./draft-nodes/list.js"
import type { MapDraftNode } from "./draft-nodes/map.js"
import type { MovableListDraftNode } from "./draft-nodes/movable-list.js"
import type { RecordDraftNode } from "./draft-nodes/record.js"
import type { TextDraftNode } from "./draft-nodes/text.js"

export interface Shape<Plain, Draft> {
  readonly _type: string
  readonly _plain: Plain
  readonly _draft: Draft
}

export interface DocShape<
  NestedShapes extends Record<string, ContainerShape> = Record<
    string,
    ContainerShape
  >,
> extends Shape<
    { [K in keyof NestedShapes]: NestedShapes[K]["_plain"] },
    { [K in keyof NestedShapes]: NestedShapes[K]["_draft"] }
  > {
  readonly _type: "doc"
  // A doc's root containers each separately has its own shape, hence 'shapes'
  readonly shapes: NestedShapes
}

export interface TextContainerShape extends Shape<string, TextDraftNode> {
  readonly _type: "text"
}
export interface CounterContainerShape extends Shape<number, CounterDraftNode> {
  readonly _type: "counter"
}
export interface TreeContainerShape<NestedShape = ContainerOrValueShape>
  extends Shape<any, any> {
  readonly _type: "tree"
  // TODO(duane): What does a tree contain? One type, or many?
  readonly shape: NestedShape
}

// Container schemas using interfaces for recursive references
export interface ListContainerShape<
  NestedShape extends ContainerOrValueShape = ContainerOrValueShape,
> extends Shape<NestedShape["_plain"][], ListDraftNode<NestedShape>> {
  readonly _type: "list"
  // A list contains many elements, all of the same 'shape'
  readonly shape: NestedShape
}

export interface MovableListContainerShape<
  NestedShape extends ContainerOrValueShape = ContainerOrValueShape,
> extends Shape<NestedShape["_plain"][], MovableListDraftNode<NestedShape>> {
  readonly _type: "movableList"
  // A list contains many elements, all of the same 'shape'
  readonly shape: NestedShape
}

export interface MapContainerShape<
  NestedShapes extends Record<string, ContainerOrValueShape> = Record<
    string,
    ContainerOrValueShape
  >,
> extends Shape<
    { [K in keyof NestedShapes]: NestedShapes[K]["_plain"] },
    MapDraftNode<NestedShapes> & {
      [K in keyof NestedShapes]: NestedShapes[K]["_draft"]
    }
  > {
  readonly _type: "map"
  // Each map property has its own shape, hence 'shapes'
  readonly shapes: NestedShapes
}

export interface RecordContainerShape<
  NestedShape extends ContainerOrValueShape = ContainerOrValueShape,
> extends Shape<
    Record<string, NestedShape["_plain"]>,
    RecordDraftNode<NestedShape>
  > {
  readonly _type: "record"
  readonly shape: NestedShape
}

export type ContainerShape =
  | CounterContainerShape
  | ListContainerShape
  | MapContainerShape
  | MovableListContainerShape
  | RecordContainerShape
  | TextContainerShape
  | TreeContainerShape

export type ContainerType = ContainerShape["_type"]

// LoroValue shape types - a shape for each of Loro's Value types
export interface StringValueShape<T extends string = string>
  extends Shape<T, T> {
  readonly _type: "value"
  readonly valueType: "string"
  readonly options?: T[]
}
export interface NumberValueShape extends Shape<number, number> {
  readonly _type: "value"
  readonly valueType: "number"
}
export interface BooleanValueShape extends Shape<boolean, boolean> {
  readonly _type: "value"
  readonly valueType: "boolean"
}
export interface NullValueShape extends Shape<null, null> {
  readonly _type: "value"
  readonly valueType: "null"
}
export interface UndefinedValueShape extends Shape<undefined, undefined> {
  readonly _type: "value"
  readonly valueType: "undefined"
}
export interface Uint8ArrayValueShape extends Shape<Uint8Array, Uint8Array> {
  readonly _type: "value"
  readonly valueType: "uint8array"
}

export interface ObjectValueShape<
  T extends Record<string, ValueShape> = Record<string, ValueShape>,
> extends Shape<
    { [K in keyof T]: T[K]["_plain"] },
    { [K in keyof T]: T[K]["_draft"] }
  > {
  readonly _type: "value"
  readonly valueType: "object"
  readonly shape: T
}

export interface RecordValueShape<T extends ValueShape = ValueShape>
  extends Shape<Record<string, T["_plain"]>, Record<string, T["_draft"]>> {
  readonly _type: "value"
  readonly valueType: "record"
  readonly shape: T
}

export interface ArrayValueShape<T extends ValueShape = ValueShape>
  extends Shape<T["_plain"][], T["_draft"][]> {
  readonly _type: "value"
  readonly valueType: "array"
  readonly shape: T
}

export interface UnionValueShape<T extends ValueShape[] = ValueShape[]>
  extends Shape<T[number]["_plain"], T[number]["_draft"]> {
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
  | RecordValueShape
  | ArrayValueShape
  | UnionValueShape

export type ContainerOrValueShape = ContainerShape | ValueShape

/**
 * The LoroShape factory object
 *
 * If a container has a `shape` type variable, it refers to the shape it contains--
 * so for example, a `LoroShape.list(LoroShape.text())` would return a value of type
 * `ListContainerShape<TextContainerShape>`.
 */
export const Shape = {
  doc: <T extends Record<string, ContainerShape>>(shape: T): DocShape<T> => ({
    _type: "doc" as const,
    shapes: shape,
    _plain: {} as any,
    _draft: {} as any,
  }),

  // CRDTs are represented by Loro Containers--they converge on state using Loro's
  // various CRDT algorithms
  counter: (): CounterContainerShape => ({
    _type: "counter" as const,
    _plain: 0,
    _draft: {} as CounterDraftNode,
  }),

  list: <T extends ContainerOrValueShape>(shape: T): ListContainerShape<T> => ({
    _type: "list" as const,
    shape,
    _plain: [] as any,
    _draft: {} as any,
  }),

  map: <T extends Record<string, ContainerOrValueShape>>(
    shape: T,
  ): MapContainerShape<T> => ({
    _type: "map" as const,
    shapes: shape,
    _plain: {} as any,
    _draft: {} as any,
  }),

  record: <T extends ContainerOrValueShape>(
    shape: T,
  ): RecordContainerShape<T> => ({
    _type: "record" as const,
    shape,
    _plain: {} as any,
    _draft: {} as any,
  }),

  movableList: <T extends ContainerOrValueShape>(
    shape: T,
  ): MovableListContainerShape<T> => ({
    _type: "movableList" as const,
    shape,
    _plain: [] as any,
    _draft: {} as any,
  }),

  text: (): TextContainerShape => ({
    _type: "text" as const,
    _plain: "",
    _draft: {} as TextDraftNode,
  }),

  tree: <T extends MapContainerShape>(shape: T): TreeContainerShape => ({
    _type: "tree" as const,
    shape,
    _plain: {} as any,
    _draft: {} as any,
  }),

  // Values are represented as plain JS objects, with the limitation that they MUST be
  // representable as a Loro "Value"--basically JSON. The behavior of a Value is basically
  // "Last Write Wins", meaning there is no subtle convergent behavior here, just taking
  // the most recent value based on the current available information.
  plain: {
    string: <T extends string = string>(
      ...options: T[]
    ): StringValueShape<T> => ({
      _type: "value" as const,
      valueType: "string" as const,
      _plain: (options[0] ?? "") as T,
      _draft: (options[0] ?? "") as T,
      options: options.length > 0 ? options : undefined,
    }),

    number: (): NumberValueShape => ({
      _type: "value" as const,
      valueType: "number" as const,
      _plain: 0,
      _draft: 0,
    }),

    boolean: (): BooleanValueShape => ({
      _type: "value" as const,
      valueType: "boolean" as const,
      _plain: false,
      _draft: false,
    }),

    null: (): NullValueShape => ({
      _type: "value" as const,
      valueType: "null" as const,
      _plain: null,
      _draft: null,
    }),

    undefined: (): UndefinedValueShape => ({
      _type: "value" as const,
      valueType: "undefined" as const,
      _plain: undefined,
      _draft: undefined,
    }),

    uint8Array: (): Uint8ArrayValueShape => ({
      _type: "value" as const,
      valueType: "uint8array" as const,
      _plain: new Uint8Array(),
      _draft: new Uint8Array(),
    }),

    object: <T extends Record<string, ValueShape>>(
      shape: T,
    ): ObjectValueShape<T> => ({
      _type: "value" as const,
      valueType: "object" as const,
      shape,
      _plain: {} as any,
      _draft: {} as any,
    }),

    record: <T extends ValueShape>(shape: T): RecordValueShape<T> => ({
      _type: "value" as const,
      valueType: "record" as const,
      shape,
      _plain: {} as any,
      _draft: {} as any,
    }),

    array: <T extends ValueShape>(shape: T): ArrayValueShape<T> => ({
      _type: "value" as const,
      valueType: "array" as const,
      shape,
      _plain: [] as any,
      _draft: [] as any,
    }),

    // Special value type that helps make things like `string | null` representable
    // TODO(duane): should this be a more general type for containers too?
    union: <T extends ValueShape[]>(shapes: T): UnionValueShape<T> => ({
      _type: "value" as const,
      valueType: "union" as const,
      shapes,
      _plain: {} as any,
      _draft: {} as any,
    }),
  },
}

// Add this type mapping near the top of your file, after the imports
export type ShapeToContainer<T extends DocShape | ContainerShape> =
  T extends TextContainerShape
    ? LoroText
    : T extends CounterContainerShape
      ? LoroCounter
      : T extends ListContainerShape
        ? LoroList
        : T extends MovableListContainerShape
          ? LoroMovableList
          : T extends MapContainerShape | RecordContainerShape
            ? LoroMap
            : T extends TreeContainerShape
              ? LoroTree
              : never // not a container
