import type {
  ContainerID,
  Delta,
  LoroCounter,
  LoroList,
  LoroMap,
  LoroMovableList,
  LoroText,
  LoroTree,
  PeerID,
  TextUpdateOptions,
  Value,
} from "loro-crdt"

export interface DocShape<
  NestedShapes extends Record<string, ContainerShape> = Record<
    string,
    ContainerShape
  >,
> {
  readonly _type: "doc"
  // A doc's root containers each separately has its own shape, hence 'shapes'
  readonly shapes: NestedShapes
}

export type TextContainerShape = { readonly _type: "text" }
export type CounterContainerShape = { readonly _type: "counter" }
export interface TreeContainerShape<NestedShape = ContainerOrValueShape> {
  readonly _type: "tree"
  // TODO(duane): What does a tree contain? One type, or many?
  readonly shape: NestedShape
}

// Container schemas using interfaces for recursive references
export interface ListContainerShape<
  NestedShape extends ContainerOrValueShape = ContainerOrValueShape,
> {
  readonly _type: "list"
  // A list contains many elements, all of the same 'shape'
  readonly shape: NestedShape
}

export interface MovableListContainerShape<
  NestedShape extends ContainerOrValueShape = ContainerOrValueShape,
> {
  readonly _type: "movableList"
  // A list contains many elements, all of the same 'shape'
  readonly shape: NestedShape
}

export interface MapContainerShape<
  NestedShapes extends Record<string, ContainerOrValueShape> = Record<
    string,
    ContainerOrValueShape
  >,
> {
  readonly _type: "map"
  // Each map property has its own shape, hence 'shapes'
  readonly shapes: NestedShapes
}

export type ContainerShape =
  | CounterContainerShape
  | ListContainerShape
  | MapContainerShape
  | MovableListContainerShape
  | TextContainerShape
  | TreeContainerShape

export type ContainerType = ContainerShape["_type"]

// LoroValue shape types - a shape for each of Loro's Value types
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

// export interface UnionValueShape<T extends ValueShape[] = ValueShape[]> {
//   readonly _type: "value"
//   readonly valueType: "union"
//   readonly shapes: T
// }

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
// | UnionValueShape

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
  }),

  // CRDTs are represented by Loro Containers--they converge on state using Loro's
  // various CRDT algorithms
  counter: (): CounterContainerShape => ({
    _type: "counter" as const,
  }),

  list: <T extends ContainerOrValueShape>(shape: T): ListContainerShape<T> => ({
    _type: "list" as const,
    shape,
  }),

  map: <T extends Record<string, ContainerOrValueShape>>(
    shape: T,
  ): MapContainerShape<T> => ({
    _type: "map" as const,
    shapes: shape,
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

  // Values are represented as plain JS objects, with the limitation that they MUST be
  // representable as a Loro "Value"--basically JSON. The behavior of a Value is basically
  // "Last Write Wins", meaning there is no subtle convergent behavior here, just taking
  // the most recent value based on the current available information.
  plain: {
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

    // // Special value type that helps make things like `string | null` representable
    // union: <T extends ValueShape[]>(shapes: T): UnionValueShape<T> => ({
    //   _type: "value" as const,
    //   valueType: "union" as const,
    //   shapes,
    // }),
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
          : T extends MapContainerShape
            ? LoroMap
            : T extends TreeContainerShape
              ? LoroTree
              : never // not a container
