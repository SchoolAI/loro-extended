// biome-ignore-all lint/suspicious/noExplicitAny: required

import type {
  LoroCounter,
  LoroList,
  LoroMap,
  LoroMovableList,
  LoroText,
  LoroTree,
  TreeID,
  Value,
} from "loro-crdt"

import { LORO_SYMBOL } from "./loro.js"
import type { CounterRef } from "./typed-refs/counter-ref.js"
import type { ListRef } from "./typed-refs/list-ref.js"
import type { MovableListRef } from "./typed-refs/movable-list-ref.js"
import type { RecordRef } from "./typed-refs/record-ref.js"
import type { StructRef } from "./typed-refs/struct-ref.js"
import type { TextRef } from "./typed-refs/text-ref.js"
import type { TreeNodeRef } from "./typed-refs/tree-node-ref.js"

export interface Shape<Plain, Mutable, Placeholder = Plain> {
  readonly _type: string
  readonly _plain: Plain
  readonly _mutable: Mutable
  readonly _placeholder: Placeholder
}

// Type for shapes that support placeholder customization
export type WithPlaceholder<S extends Shape<any, any, any>> = S & {
  placeholder(value: S["_placeholder"]): S
}

/**
 * Type for value shapes that support the .nullable() method.
 * Returns a union of null and the original shape with null as the default placeholder.
 */
export type WithNullable<S extends ValueShape> = {
  nullable(): WithPlaceholder<UnionValueShape<[NullValueShape, S]>>
}

/**
 * Options for configuring a document schema.
 */
export interface DocShapeOptions {
  /**
   * When true, all containers are stored at the document root with path-based names.
   * This ensures container IDs are deterministic and survive `applyDiff`, enabling
   * proper merging of concurrent container creation.
   *
   * Use this when:
   * - Multiple peers may concurrently create containers at the same schema path
   * - You need containers to merge correctly via `applyDiff` (e.g., Lens)
   *
   * Limitations:
   * - Lists of containers (`Shape.list(Shape.struct({...}))`) are NOT supported
   * - MovableLists of containers are NOT supported
   * - Use `Shape.record(Shape.struct({...}))` with string keys instead
   *
   * @default false
   */
  mergeable?: boolean
}

export interface DocShape<
  NestedShapes extends Record<string, ContainerShape> = Record<
    string,
    ContainerShape
  >,
> extends Shape<
    { [K in keyof NestedShapes]: NestedShapes[K]["_plain"] },
    { [K in keyof NestedShapes]: NestedShapes[K]["_mutable"] },
    { [K in keyof NestedShapes]: NestedShapes[K]["_placeholder"] }
  > {
  readonly _type: "doc"
  // A doc's root containers each separately has its own shape, hence 'shapes'
  readonly shapes: NestedShapes
  /**
   * Whether this document uses mergeable (flattened) storage.
   * When true, containers are stored at the document root with path-based names.
   */
  readonly mergeable?: boolean
}

export interface TextContainerShape extends Shape<string, TextRef, string> {
  readonly _type: "text"
}
export interface CounterContainerShape
  extends Shape<number, CounterRef, number> {
  readonly _type: "counter"
}
/**
 * JSON representation of a tree node with typed data.
 * Used for serialization (toJSON) of tree structures.
 */
export type TreeNodeJSON<DataShape extends StructContainerShape> = {
  id: TreeID
  parent: TreeID | null
  index: number
  fractionalIndex: string
  data: DataShape["_plain"]
  children: TreeNodeJSON<DataShape>[]
}

/**
 * Interface describing the TreeRef API for use in shape definitions.
 * This avoids circular type references that would occur with the TreeRef class.
 * @internal
 */
export interface TreeRefInterface<DataShape extends StructContainerShape> {
  /** Get or create a node ref for a LoroTreeNode */
  getOrCreateNodeRef(node: unknown): TreeNodeRef<DataShape>
  /** Get a node by its ID */
  getNodeByID(id: TreeID): TreeNodeRef<DataShape> | undefined
  /** Delete a node from the tree */
  delete(target: TreeID | TreeNodeRef<DataShape>): void
  /** Serialize the tree to a nested JSON structure */
  toJSON(): TreeNodeJSON<DataShape>[]
  /** Create a new root node with optional initial data */
  createNode(initialData?: Partial<DataShape["_plain"]>): TreeNodeRef<DataShape>
  /** Get all root nodes (nodes without parents) */
  roots(): TreeNodeRef<DataShape>[]
  /** Get all nodes in the tree (unordered). By default excludes deleted nodes. */
  nodes(options?: { includeDeleted?: boolean }): TreeNodeRef<DataShape>[]
  /** Check if a node with the given ID exists in the tree */
  has(id: TreeID): boolean
  /** Enable fractional index generation for ordering */
  enableFractionalIndex(jitter?: number): void
  /** Get a flat array representation of all nodes */
  toArray(): Array<{
    id: TreeID
    parent: TreeID | null
    index: number
    fractionalIndex: string
    data: DataShape["_plain"]
  }>

  /**
   * Access CRDT internals via the well-known symbol.
   * Returns LoroTree directly.
   */
  readonly [LORO_SYMBOL]: LoroTree
}

/**
 * Container shape for tree (forest) structures.
 * Each node in the tree has typed metadata stored in a LoroMap.
 *
 * @example
 * ```typescript
 * const StateNodeDataShape = Shape.struct({
 *   name: Shape.text(),
 *   facts: Shape.record(Shape.plain.any()),
 * })
 *
 * const Schema = Shape.doc({
 *   states: Shape.tree(StateNodeDataShape),
 * })
 * ```
 */
export interface TreeContainerShape<
  DataShape extends StructContainerShape = StructContainerShape,
> extends Shape<
    TreeNodeJSON<DataShape>[],
    TreeRefInterface<DataShape>,
    never[]
  > {
  readonly _type: "tree"
  /**
   * The shape of each node's data (metadata).
   * This is a StructContainerShape that defines the typed properties on node.data.
   */
  readonly shape: DataShape
}

// Container schemas using interfaces for recursive references
// NOTE: List and Record use never[] and Record<string, never> for Placeholder
// to enforce that only empty values ([] and {}) are valid in placeholder state.
// This prevents users from expecting per-entry merging behavior.
export interface ListContainerShape<
  NestedShape extends ContainerOrValueShape = ContainerOrValueShape,
> extends Shape<NestedShape["_plain"][], ListRef<NestedShape>, never[]> {
  readonly _type: "list"
  // A list contains many elements, all of the same 'shape'
  readonly shape: NestedShape
}

export interface MovableListContainerShape<
  NestedShape extends ContainerOrValueShape = ContainerOrValueShape,
> extends Shape<NestedShape["_plain"][], MovableListRef<NestedShape>, never[]> {
  readonly _type: "movableList"
  // A list contains many elements, all of the same 'shape'
  readonly shape: NestedShape
}

/**
 * @deprecated Use StructContainerShape instead. MapContainerShape is an alias for backward compatibility.
 */
export type MapContainerShape<
  NestedShapes extends Record<string, ContainerOrValueShape> = Record<
    string,
    ContainerOrValueShape
  >,
> = StructContainerShape<NestedShapes>

/**
 * Container shape for objects with fixed keys (structs).
 * This is the preferred way to define fixed-key objects.
 * Uses LoroMap as the underlying container.
 */
export interface StructContainerShape<
  NestedShapes extends Record<string, ContainerOrValueShape> = Record<
    string,
    ContainerOrValueShape
  >,
> extends Shape<
    { [K in keyof NestedShapes]: NestedShapes[K]["_plain"] },
    StructRef<NestedShapes>,
    { [K in keyof NestedShapes]: NestedShapes[K]["_placeholder"] }
  > {
  readonly _type: "struct"
  // Each struct property has its own shape, hence 'shapes'
  readonly shapes: NestedShapes
}

export interface RecordContainerShape<
  NestedShape extends ContainerOrValueShape = ContainerOrValueShape,
> extends Shape<
    Record<string, NestedShape["_plain"]>,
    RecordRef<NestedShape>,
    Record<string, never>
  > {
  readonly _type: "record"
  readonly shape: NestedShape
}

/**
 * Container escape hatch - represents "any LoroContainer".
 * Use this when integrating with external libraries that manage their own document structure.
 *
 * @example
 * ```typescript
 * // loro-prosemirror manages its own structure
 * const ProseMirrorDocShape = Shape.doc({
 *   doc: Shape.any(), // opt out of typing for this container
 * })
 * ```
 */
export interface AnyContainerShape extends Shape<unknown, unknown, undefined> {
  readonly _type: "any"
}

/**
 * Union of all container shape types.
 *
 * Each container shape has a `_mutable` type parameter that maps to the
 * corresponding TypedRef class (e.g., TextContainerShape → TextRef).
 * This enables deriving ref types from shapes:
 *
 * ```typescript
 * // Get the ref type for any container shape
 * type RefType = ContainerShape["_mutable"]
 *
 * // Exclude AnyContainerShape to get only typed refs
 * type AnyTypedRef = Exclude<ContainerShape, AnyContainerShape>["_mutable"]
 * ```
 *
 * This creates intentional parallel hierarchies:
 * - ContainerShape → defines what data looks like (schema)
 * - TypedRef (via _mutable) → defines how you interact with data
 * - loro() overloads → CRDT escape hatch (IDE DX)
 * - change() overloads → mutation boundaries (IDE DX)
 */
export type ContainerShape =
  | AnyContainerShape
  | CounterContainerShape
  | ListContainerShape
  | MovableListContainerShape
  | RecordContainerShape
  | StructContainerShape
  | TextContainerShape
  | TreeContainerShape

export type ContainerType = ContainerShape["_type"]

// LoroValue shape types - a shape for each of Loro's Value types
export interface StringValueShape<T extends string = string>
  extends Shape<T, T, T> {
  readonly _type: "value"
  readonly valueType: "string"
  readonly options?: T[]
}
export interface NumberValueShape extends Shape<number, number, number> {
  readonly _type: "value"
  readonly valueType: "number"
}
export interface BooleanValueShape extends Shape<boolean, boolean, boolean> {
  readonly _type: "value"
  readonly valueType: "boolean"
}
export interface NullValueShape extends Shape<null, null, null> {
  readonly _type: "value"
  readonly valueType: "null"
}
export interface UndefinedValueShape
  extends Shape<undefined, undefined, undefined> {
  readonly _type: "value"
  readonly valueType: "undefined"
}
export interface Uint8ArrayValueShape
  extends Shape<Uint8Array, Uint8Array, Uint8Array> {
  readonly _type: "value"
  readonly valueType: "uint8array"
}

/**
 * @deprecated Use StructValueShape instead. ObjectValueShape is an alias for backward compatibility.
 */
export type ObjectValueShape<
  T extends Record<string, ValueShape> = Record<string, ValueShape>,
> = StructValueShape<T>

/**
 * Value shape for objects with fixed keys (structs).
 * This is the preferred way to define fixed-key plain value objects.
 * Identical structure to ObjectValueShape but with valueType: "struct".
 */
export interface StructValueShape<
  T extends Record<string, ValueShape> = Record<string, ValueShape>,
> extends Shape<
    { [K in keyof T]: T[K]["_plain"] },
    { [K in keyof T]: T[K]["_mutable"] },
    { [K in keyof T]: T[K]["_placeholder"] }
  > {
  readonly _type: "value"
  readonly valueType: "struct"
  readonly shape: T
}

// NOTE: RecordValueShape and ArrayValueShape use Record<string, never> and never[]
// for Placeholder to enforce that only empty values ({} and []) are valid.
export interface RecordValueShape<T extends ValueShape = ValueShape>
  extends Shape<
    Record<string, T["_plain"]>,
    Record<string, T["_mutable"]>,
    Record<string, never>
  > {
  readonly _type: "value"
  readonly valueType: "record"
  readonly shape: T
}

export interface ArrayValueShape<T extends ValueShape = ValueShape>
  extends Shape<T["_plain"][], T["_mutable"][], never[]> {
  readonly _type: "value"
  readonly valueType: "array"
  readonly shape: T
}

export interface UnionValueShape<T extends ValueShape[] = ValueShape[]>
  extends Shape<
    T[number]["_plain"],
    T[number]["_mutable"],
    T[number]["_placeholder"]
  > {
  readonly _type: "value"
  readonly valueType: "union"
  readonly shapes: T
}

/**
 * A discriminated union shape that uses a discriminant key to determine which variant to use.
 * This enables type-safe handling of tagged unions like:
 *
 * ```typescript
 * type GamePresence =
 *   | { type: "client"; name: string; input: { force: number; angle: number } }
 *   | { type: "server"; cars: Record<string, CarState>; tick: number }
 * ```
 *
 * @typeParam K - The discriminant key (e.g., "type")
 * @typeParam T - A record mapping discriminant values to their object shapes
 */
export interface DiscriminatedUnionValueShape<
  K extends string = string,
  T extends Record<string, StructValueShape> = Record<string, StructValueShape>,
  Plain = T[keyof T]["_plain"],
  Mutable = T[keyof T]["_mutable"],
  Placeholder = T[keyof T]["_placeholder"],
> extends Shape<Plain, Mutable, Placeholder> {
  readonly _type: "value"
  readonly valueType: "discriminatedUnion"
  readonly discriminantKey: K
  readonly variants: T
}

/**
 * Value escape hatch - represents "any Loro Value".
 * Use this when you need to accept any valid Loro value type.
 *
 * @example
 * ```typescript
 * const FlexiblePresenceShape = Shape.plain.struct({
 *   cursor: Shape.plain.any(), // accept any value type
 * })
 * ```
 */
export interface AnyValueShape extends Shape<Value, Value, undefined> {
  readonly _type: "value"
  readonly valueType: "any"
}

// Union of all ValueShapes - these can only contain other ValueShapes, not ContainerShapes
export type ValueShape =
  | AnyValueShape
  | ArrayValueShape
  | BooleanValueShape
  | DiscriminatedUnionValueShape
  | NullValueShape
  | NumberValueShape
  | RecordValueShape
  | StringValueShape
  | StructValueShape
  | Uint8ArrayValueShape
  | UndefinedValueShape
  | UnionValueShape

export type ContainerOrValueShape = ContainerShape | ValueShape

/**
 * Creates a nullable version of a value shape.
 * @internal
 */
function makeNullable<S extends ValueShape>(
  shape: S,
): WithPlaceholder<UnionValueShape<[NullValueShape, S]>> {
  const nullShape: NullValueShape = {
    _type: "value" as const,
    valueType: "null" as const,
    _plain: null,
    _mutable: null,
    _placeholder: null,
  }

  const base: UnionValueShape<[NullValueShape, S]> = {
    _type: "value" as const,
    valueType: "union" as const,
    shapes: [nullShape, shape] as [NullValueShape, S],
    _plain: null as any,
    _mutable: null as any,
    _placeholder: null as any, // Default placeholder is null
  }

  return Object.assign(base, {
    placeholder(
      value: S["_placeholder"] | null,
    ): UnionValueShape<[NullValueShape, S]> {
      return { ...base, _placeholder: value } as UnionValueShape<
        [NullValueShape, S]
      >
    },
  })
}

/**
 * The LoroShape factory object
 *
 * If a container has a `shape` type variable, it refers to the shape it contains--
 * so for example, a `LoroShape.list(LoroShape.text())` would return a value of type
 * `ListContainerShape<TextContainerShape>`.
 */
export const Shape = {
  /**
   * Creates a document schema with the given root container shapes.
   *
   * @param shapes - The root container shapes for the document
   * @param options - Optional configuration including `mergeable` for flattened storage
   * @returns A DocShape that can be used with createTypedDoc
   *
   * @example
   * ```typescript
   * // Basic document
   * const schema = Shape.doc({
   *   title: Shape.text(),
   *   count: Shape.counter(),
   * })
   *
   * // Mergeable document for concurrent container creation
   * const mergeableSchema = Shape.doc({
   *   players: Shape.record(Shape.struct({ score: Shape.plain.number() })),
   * }, { mergeable: true })
   * ```
   */
  doc: <T extends Record<string, ContainerShape>>(
    shapes: T,
    options?: DocShapeOptions,
  ): DocShape<T> => ({
    _type: "doc" as const,
    shapes,
    _plain: {} as any,
    _mutable: {} as any,
    _placeholder: {} as any,
    mergeable: options?.mergeable,
  }),

  /**
   * Creates an "any" container shape - an escape hatch for untyped containers.
   * Use this when integrating with external libraries that manage their own document structure.
   *
   * @example
   * ```typescript
   * // loro-prosemirror manages its own structure
   * const ProseMirrorDocShape = Shape.doc({
   *   doc: Shape.any(), // opt out of typing for this container
   * })
   *
   * const handle = repo.get(docId, ProseMirrorDocShape, CursorPresenceShape)
   * // handle.doc.doc is typed as `unknown` - you're on your own
   * ```
   */
  any: (): AnyContainerShape => ({
    _type: "any" as const,
    _plain: undefined as unknown,
    _mutable: undefined as unknown,
    _placeholder: undefined,
  }),

  // CRDTs are represented by Loro Containers--they converge on state using Loro's
  // various CRDT algorithms
  counter: (): WithPlaceholder<CounterContainerShape> => {
    const base: CounterContainerShape = {
      _type: "counter" as const,
      _plain: 0,
      _mutable: {} as CounterRef,
      _placeholder: 0,
    }
    return Object.assign(base, {
      placeholder(value: number): CounterContainerShape {
        return { ...base, _placeholder: value }
      },
    })
  },

  list: <T extends ContainerOrValueShape>(shape: T): ListContainerShape<T> => ({
    _type: "list" as const,
    shape,
    _plain: [] as any,
    _mutable: {} as any,
    _placeholder: [] as never[],
  }),

  /**
   * Creates a struct container shape for objects with fixed keys.
   * This is the preferred way to define fixed-key objects.
   *
   * @example
   * ```typescript
   * const UserSchema = Shape.doc({
   *   user: Shape.struct({
   *     name: Shape.text(),
   *     age: Shape.counter(),
   *   }),
   * })
   * ```
   */
  struct: <T extends Record<string, ContainerOrValueShape>>(
    shape: T,
  ): StructContainerShape<T> => ({
    _type: "struct" as const,
    shapes: shape,
    _plain: {} as any,
    _mutable: {} as any,
    _placeholder: {} as any,
  }),

  /**
   * @deprecated Use `Shape.struct` instead. `Shape.map` will be removed in a future version.
   */
  map: <T extends Record<string, ContainerOrValueShape>>(
    shape: T,
  ): StructContainerShape<T> => ({
    _type: "struct" as const,
    shapes: shape,
    _plain: {} as any,
    _mutable: {} as any,
    _placeholder: {} as any,
  }),

  record: <T extends ContainerOrValueShape>(
    shape: T,
  ): RecordContainerShape<T> => ({
    _type: "record" as const,
    shape,
    _plain: {} as any,
    _mutable: {} as any,
    _placeholder: {} as Record<string, never>,
  }),

  movableList: <T extends ContainerOrValueShape>(
    shape: T,
  ): MovableListContainerShape<T> => ({
    _type: "movableList" as const,
    shape,
    _plain: [] as any,
    _mutable: {} as any,
    _placeholder: [] as never[],
  }),

  text: (): WithPlaceholder<TextContainerShape> => {
    const base: TextContainerShape = {
      _type: "text" as const,
      _plain: "",
      _mutable: {} as TextRef,
      _placeholder: "",
    }
    return Object.assign(base, {
      placeholder(value: string): TextContainerShape {
        return { ...base, _placeholder: value }
      },
    })
  },

  /**
   * Creates a tree container shape for hierarchical data structures.
   * Each node in the tree has typed metadata defined by the data shape.
   *
   * @example
   * ```typescript
   * const StateNodeDataShape = Shape.struct({
   *   name: Shape.text(),
   *   facts: Shape.record(Shape.plain.any()),
   * })
   *
   * const Schema = Shape.doc({
   *   states: Shape.tree(StateNodeDataShape),
   * })
   *
   * doc.change(draft => {
   *   const root = draft.states.createNode({ name: "idle", facts: {} })
   *   const child = root.createNode({ name: "running", facts: {} })
   *   child.data.name = "active"
   * })
   * ```
   */
  tree: <T extends StructContainerShape>(shape: T): TreeContainerShape<T> => ({
    _type: "tree" as const,
    shape,
    _plain: [] as any,
    _mutable: {} as any,
    _placeholder: [] as never[],
  }),

  // Values are represented as plain JS objects, with the limitation that they MUST be
  // representable as a Loro "Value"--basically JSON. The behavior of a Value is basically
  // "Last Write Wins", meaning there is no subtle convergent behavior here, just taking
  // the most recent value based on the current available information.
  plain: {
    string: <T extends string = string>(
      ...options: T[]
    ): WithPlaceholder<StringValueShape<T>> &
      WithNullable<StringValueShape<T>> => {
      const base: StringValueShape<T> = {
        _type: "value" as const,
        valueType: "string" as const,
        _plain: (options[0] ?? "") as T,
        _mutable: (options[0] ?? "") as T,
        _placeholder: (options[0] ?? "") as T,
        options: options.length > 0 ? options : undefined,
      }
      return Object.assign(base, {
        placeholder(value: T): StringValueShape<T> {
          return { ...base, _placeholder: value }
        },
        nullable(): WithPlaceholder<
          UnionValueShape<[NullValueShape, StringValueShape<T>]>
        > {
          return makeNullable(base)
        },
      })
    },

    number: (): WithPlaceholder<NumberValueShape> &
      WithNullable<NumberValueShape> => {
      const base: NumberValueShape = {
        _type: "value" as const,
        valueType: "number" as const,
        _plain: 0,
        _mutable: 0,
        _placeholder: 0,
      }
      return Object.assign(base, {
        placeholder(value: number): NumberValueShape {
          return { ...base, _placeholder: value }
        },
        nullable(): WithPlaceholder<
          UnionValueShape<[NullValueShape, NumberValueShape]>
        > {
          return makeNullable(base)
        },
      })
    },

    boolean: (): WithPlaceholder<BooleanValueShape> &
      WithNullable<BooleanValueShape> => {
      const base: BooleanValueShape = {
        _type: "value" as const,
        valueType: "boolean" as const,
        _plain: false,
        _mutable: false,
        _placeholder: false,
      }
      return Object.assign(base, {
        placeholder(value: boolean): BooleanValueShape {
          return { ...base, _placeholder: value }
        },
        nullable(): WithPlaceholder<
          UnionValueShape<[NullValueShape, BooleanValueShape]>
        > {
          return makeNullable(base)
        },
      })
    },

    null: (): NullValueShape => ({
      _type: "value" as const,
      valueType: "null" as const,
      _plain: null,
      _mutable: null,
      _placeholder: null,
    }),

    undefined: (): UndefinedValueShape => ({
      _type: "value" as const,
      valueType: "undefined" as const,
      _plain: undefined,
      _mutable: undefined,
      _placeholder: undefined,
    }),

    uint8Array: (): Uint8ArrayValueShape &
      WithNullable<Uint8ArrayValueShape> => {
      const base: Uint8ArrayValueShape = {
        _type: "value" as const,
        valueType: "uint8array" as const,
        _plain: new Uint8Array(),
        _mutable: new Uint8Array(),
        _placeholder: new Uint8Array(),
      }
      return Object.assign(base, {
        nullable(): WithPlaceholder<
          UnionValueShape<[NullValueShape, Uint8ArrayValueShape]>
        > {
          return makeNullable(base)
        },
      })
    },

    /**
     * Alias for `uint8Array()` - creates a shape for binary data.
     * Use this for better discoverability when working with binary data like cursor positions.
     *
     * @example
     * ```typescript
     * const CursorPresenceShape = Shape.plain.struct({
     *   anchor: Shape.plain.bytes().nullable(),
     *   focus: Shape.plain.bytes().nullable(),
     * })
     * ```
     */
    bytes: (): Uint8ArrayValueShape & WithNullable<Uint8ArrayValueShape> => {
      const base: Uint8ArrayValueShape = {
        _type: "value" as const,
        valueType: "uint8array" as const,
        _plain: new Uint8Array(),
        _mutable: new Uint8Array(),
        _placeholder: new Uint8Array(),
      }
      return Object.assign(base, {
        nullable(): WithPlaceholder<
          UnionValueShape<[NullValueShape, Uint8ArrayValueShape]>
        > {
          return makeNullable(base)
        },
      })
    },

    /**
     * Creates an "any" value shape - an escape hatch for untyped values.
     * Use this when you need to accept any valid Loro value type.
     *
     * @example
     * ```typescript
     * const FlexiblePresenceShape = Shape.plain.struct({
     *   metadata: Shape.plain.any(), // accept any value type
     * })
     * ```
     */
    any: (): AnyValueShape => ({
      _type: "value" as const,
      valueType: "any" as const,
      _plain: undefined as unknown as Value,
      _mutable: undefined as unknown as Value,
      _placeholder: undefined,
    }),

    /**
     * Creates a struct value shape for plain objects with fixed keys.
     * This is the preferred way to define fixed-key plain value objects.
     *
     * @example
     * ```typescript
     * const PointSchema = Shape.plain.struct({
     *   x: Shape.plain.number(),
     *   y: Shape.plain.number(),
     * })
     * ```
     */
    struct: <T extends Record<string, ValueShape>>(
      shape: T,
    ): StructValueShape<T> & WithNullable<StructValueShape<T>> => {
      const base: StructValueShape<T> = {
        _type: "value" as const,
        valueType: "struct" as const,
        shape,
        _plain: {} as any,
        _mutable: {} as any,
        _placeholder: {} as any,
      }
      return Object.assign(base, {
        nullable(): WithPlaceholder<
          UnionValueShape<[NullValueShape, StructValueShape<T>]>
        > {
          return makeNullable(base)
        },
      })
    },

    /**
     * @deprecated Use `Shape.plain.struct` instead. `Shape.plain.struct` will be removed in a future version.
     */
    object: <T extends Record<string, ValueShape>>(
      shape: T,
    ): StructValueShape<T> & WithNullable<StructValueShape<T>> => {
      const base: StructValueShape<T> = {
        _type: "value" as const,
        valueType: "struct" as const,
        shape,
        _plain: {} as any,
        _mutable: {} as any,
        _placeholder: {} as any,
      }
      return Object.assign(base, {
        nullable(): WithPlaceholder<
          UnionValueShape<[NullValueShape, StructValueShape<T>]>
        > {
          return makeNullable(base)
        },
      })
    },

    record: <T extends ValueShape>(
      shape: T,
    ): RecordValueShape<T> & WithNullable<RecordValueShape<T>> => {
      const base: RecordValueShape<T> = {
        _type: "value" as const,
        valueType: "record" as const,
        shape,
        _plain: {} as any,
        _mutable: {} as any,
        _placeholder: {} as Record<string, never>,
      }
      return Object.assign(base, {
        nullable(): WithPlaceholder<
          UnionValueShape<[NullValueShape, RecordValueShape<T>]>
        > {
          return makeNullable(base)
        },
      })
    },

    array: <T extends ValueShape>(
      shape: T,
    ): ArrayValueShape<T> & WithNullable<ArrayValueShape<T>> => {
      const base: ArrayValueShape<T> = {
        _type: "value" as const,
        valueType: "array" as const,
        shape,
        _plain: [] as any,
        _mutable: [] as any,
        _placeholder: [] as never[],
      }
      return Object.assign(base, {
        nullable(): WithPlaceholder<
          UnionValueShape<[NullValueShape, ArrayValueShape<T>]>
        > {
          return makeNullable(base)
        },
      })
    },

    // Special value type that helps make things like `string | null` representable
    // TODO(duane): should this be a more general type for containers too?
    union: <T extends ValueShape[]>(
      shapes: T,
    ): WithPlaceholder<UnionValueShape<T>> => {
      const base: UnionValueShape<T> = {
        _type: "value" as const,
        valueType: "union" as const,
        shapes,
        _plain: {} as any,
        _mutable: {} as any,
        _placeholder: {} as any,
      }
      return Object.assign(base, {
        placeholder(value: T[number]["_placeholder"]): UnionValueShape<T> {
          return { ...base, _placeholder: value }
        },
      })
    },

    /**
     * Creates a discriminated union shape for type-safe tagged unions.
     *
     * @example
     * ```typescript
     * const ClientPresenceShape = Shape.plain.struct({
     *   type: Shape.plain.string("client"),
     *   name: Shape.plain.string(),
     *   input: Shape.plain.struct({ force: Shape.plain.number(), angle: Shape.plain.number() }),
     * })
     *
     * const ServerPresenceShape = Shape.plain.struct({
     *   type: Shape.plain.string("server"),
     *   cars: Shape.plain.record(Shape.plain.struct({ x: Shape.plain.number(), y: Shape.plain.number() })),
     *   tick: Shape.plain.number(),
     * })
     *
     * const GamePresenceSchema = Shape.plain.discriminatedUnion("type", {
     *   client: ClientPresenceShape,
     *   server: ServerPresenceShape,
     * })
     * ```
     *
     * @param discriminantKey - The key used to discriminate between variants (e.g., "type")
     * @param variants - A record mapping discriminant values to their object shapes
     */
    discriminatedUnion: <
      K extends string,
      T extends Record<string, StructValueShape>,
    >(
      discriminantKey: K,
      variants: T,
    ): WithPlaceholder<DiscriminatedUnionValueShape<K, T>> => {
      const base: DiscriminatedUnionValueShape<K, T> = {
        _type: "value" as const,
        valueType: "discriminatedUnion" as const,
        discriminantKey,
        variants,
        _plain: {} as any,
        _mutable: {} as any,
        _placeholder: {} as any,
      }
      return Object.assign(base, {
        placeholder(
          value: T[keyof T]["_placeholder"],
        ): DiscriminatedUnionValueShape<K, T> {
          return { ...base, _placeholder: value }
        },
      })
    },
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
          : T extends StructContainerShape | RecordContainerShape
            ? LoroMap
            : T extends TreeContainerShape
              ? LoroTree
              : never // not a container
