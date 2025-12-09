// biome-ignore-all lint/suspicious/noExplicitAny: required

import type {
  LoroCounter,
  LoroList,
  LoroMap,
  LoroMovableList,
  LoroText,
  LoroTree,
} from "loro-crdt"

import type { CounterRef } from "./typed-refs/counter.js"
import type { ListRef } from "./typed-refs/list.js"
import type { MapRef } from "./typed-refs/map.js"
import type { MovableListRef } from "./typed-refs/movable-list.js"
import type { RecordRef } from "./typed-refs/record.js"
import type { TextRef } from "./typed-refs/text.js"

export interface Shape<Plain, Mutable, Placeholder = Plain> {
  readonly _type: string
  readonly _plain: Plain
  readonly _mutable: Mutable
  readonly _placeholder: Placeholder
}

/**
 * Defines a migration from an older schema version to the current one.
 * Used internally by the migration system.
 */
export interface MigrationDefinition<
  SourceShape extends ContainerOrValueShape = ContainerOrValueShape,
  TargetShape extends ContainerOrValueShape = ContainerOrValueShape,
> {
  readonly sourceKey: string
  readonly sourceShape: SourceShape
  readonly transform: (
    sourceData: SourceShape["_plain"],
  ) => TargetShape["_plain"]
}

/**
 * Migration properties that are added to container shapes.
 */
export interface MigrationProperties<S extends ContainerOrValueShape> {
  /**
   * The physical storage key in the CRDT.
   * If not set, defaults to the logical field name.
   */
  readonly _storageKey?: string

  /**
   * Migration definitions for this field, ordered from newest to oldest.
   */
  readonly _migrations?: MigrationDefinition<ContainerOrValueShape, S>[]
}

/**
 * Migration method extensions that are added to container shapes.
 * These enable fluent schema migration configuration.
 */
export interface MigrationMethods<
  S extends ContainerOrValueShape,
  ReturnType = MigratableContainerShape<S>,
> extends MigrationProperties<S> {
  /**
   * Set the physical storage key for this field.
   * Use this when the logical field name differs from the CRDT key.
   *
   * @example
   * ```typescript
   * messages: Shape.list(Shape.map({ ... }))
   *   .key("_v2_messages")
   * ```
   */
  key(storageKey: string): ReturnType

  /**
   * Define a migration from an older schema version.
   * Multiple migrations can be chained for multi-version upgrades.
   *
   * @example
   * ```typescript
   * messages: Shape.list(Shape.map({ ... }))
   *   .key("_v2_messages")
   *   .migrateFrom({
   *     key: "_v1_messages",
   *     sourceShape: Shape.list(Shape.text()),
   *     transform: (v1Data) => v1Data.map(text => ({ type: 'text', content: text }))
   *   })
   * ```
   */
  migrateFrom<SourceShape extends ContainerOrValueShape>(migration: {
    key: string
    sourceShape: SourceShape
    transform: (sourceData: SourceShape["_plain"]) => S["_plain"]
  }): ReturnType
}

/**
 * A container shape with migration methods (.key() and .migrateFrom()).
 * All container shape factory functions return this type.
 */
export type MigratableContainerShape<S extends ContainerOrValueShape> = S &
  MigrationMethods<S>

/**
 * A migratable container shape that also supports .placeholder().
 * The placeholder method preserves migration methods on the returned shape.
 */
export type MigratableWithPlaceholder<S extends ContainerShape> = S &
  MigrationMethods<S, MigratableWithPlaceholder<S>> & {
    placeholder(value: S["_placeholder"]): MigratableWithPlaceholder<S>
  }

/**
 * Helper function to add migration methods to a shape.
 * @internal
 */
function withMigrationMethods<S extends ContainerOrValueShape>(
  shape: S,
  storageKey?: string,
  migrations?: MigrationDefinition[],
): MigratableContainerShape<S> {
  const result: any = {
    ...shape,
    _storageKey: storageKey,
    _migrations: migrations,

    key(newStorageKey: string): MigratableContainerShape<S> {
      return withMigrationMethods(shape, newStorageKey, migrations)
    },

    migrateFrom<SourceShape extends ContainerOrValueShape>(migration: {
      key: string
      sourceShape: SourceShape
      transform: (sourceData: SourceShape["_plain"]) => S["_plain"]
    }): MigratableContainerShape<S> {
      const migrationDef: MigrationDefinition = {
        sourceKey: migration.key,
        sourceShape: migration.sourceShape,
        transform: migration.transform as (sourceData: unknown) => unknown,
      }
      return withMigrationMethods(shape, storageKey, [
        ...(migrations ?? []),
        migrationDef,
      ])
    },
  }

  // If the shape has a placeholder method, wrap it to preserve migration methods
  if (
    "placeholder" in shape &&
    typeof (shape as any).placeholder === "function"
  ) {
    const originalPlaceholder = (shape as any).placeholder
    result.placeholder = (value: any) => {
      const newShape = originalPlaceholder.call(shape, value)
      return withMigrationMethods(newShape, storageKey, migrations)
    }
  }

  return result as MigratableContainerShape<S>
}

// Type for shapes that support placeholder customization
export type WithPlaceholder<S extends Shape<any, any, any>> = S & {
  placeholder(value: S["_placeholder"]): S
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
}

export interface TextContainerShape extends Shape<string, TextRef, string> {
  readonly _type: "text"
}
export interface CounterContainerShape
  extends Shape<number, CounterRef, number> {
  readonly _type: "counter"
}
export interface TreeContainerShape<NestedShape = ContainerOrValueShape>
  extends Shape<any, any, never[]> {
  readonly _type: "tree"
  // TODO(duane): What does a tree contain? One type, or many?
  readonly shape: NestedShape
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

export interface MapContainerShape<
  NestedShapes extends Record<string, ContainerOrValueShape> = Record<
    string,
    ContainerOrValueShape
  >,
> extends Shape<
    { [K in keyof NestedShapes]: NestedShapes[K]["_plain"] },
    MapRef<NestedShapes> & {
      [K in keyof NestedShapes]: NestedShapes[K]["_mutable"]
    },
    { [K in keyof NestedShapes]: NestedShapes[K]["_placeholder"] }
  > {
  readonly _type: "map"
  // Each map property has its own shape, hence 'shapes'
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

export interface ObjectValueShape<
  T extends Record<string, ValueShape> = Record<string, ValueShape>,
> extends Shape<
    { [K in keyof T]: T[K]["_plain"] },
    { [K in keyof T]: T[K]["_mutable"] },
    { [K in keyof T]: T[K]["_placeholder"] }
  > {
  readonly _type: "value"
  readonly valueType: "object"
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
  T extends Record<string, ObjectValueShape> = Record<string, ObjectValueShape>,
  Plain = T[keyof T]["_plain"],
  Mutable = T[keyof T]["_mutable"],
  Placeholder = T[keyof T]["_placeholder"],
> extends Shape<Plain, Mutable, Placeholder> {
  readonly _type: "value"
  readonly valueType: "discriminatedUnion"
  readonly discriminantKey: K
  readonly variants: T
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
  | DiscriminatedUnionValueShape

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
    _mutable: {} as any,
    _placeholder: {} as any,
  }),

  // CRDTs are represented by Loro Containers--they converge on state using Loro's
  // various CRDT algorithms
  counter: (): MigratableWithPlaceholder<CounterContainerShape> => {
    const base: CounterContainerShape = {
      _type: "counter" as const,
      _plain: 0,
      _mutable: {} as CounterRef,
      _placeholder: 0,
    }
    const withPlaceholder = Object.assign(base, {
      placeholder(value: number): CounterContainerShape {
        return { ...base, _placeholder: value }
      },
    })
    return withMigrationMethods(
      withPlaceholder,
    ) as MigratableWithPlaceholder<CounterContainerShape>
  },

  list: <T extends ContainerOrValueShape>(
    shape: T,
  ): MigratableContainerShape<ListContainerShape<T>> => {
    const base: ListContainerShape<T> = {
      _type: "list" as const,
      shape,
      _plain: [] as any,
      _mutable: {} as any,
      _placeholder: [] as never[],
    }
    return withMigrationMethods(base)
  },

  map: <T extends Record<string, ContainerOrValueShape>>(
    shape: T,
  ): MigratableContainerShape<MapContainerShape<T>> => {
    const base: MapContainerShape<T> = {
      _type: "map" as const,
      shapes: shape,
      _plain: {} as any,
      _mutable: {} as any,
      _placeholder: {} as any,
    }
    return withMigrationMethods(base)
  },

  record: <T extends ContainerOrValueShape>(
    shape: T,
  ): MigratableContainerShape<RecordContainerShape<T>> => {
    const base: RecordContainerShape<T> = {
      _type: "record" as const,
      shape,
      _plain: {} as any,
      _mutable: {} as any,
      _placeholder: {} as Record<string, never>,
    }
    return withMigrationMethods(base)
  },

  movableList: <T extends ContainerOrValueShape>(
    shape: T,
  ): MigratableContainerShape<MovableListContainerShape<T>> => {
    const base: MovableListContainerShape<T> = {
      _type: "movableList" as const,
      shape,
      _plain: [] as any,
      _mutable: {} as any,
      _placeholder: [] as never[],
    }
    return withMigrationMethods(base)
  },

  text: (): MigratableWithPlaceholder<TextContainerShape> => {
    const base: TextContainerShape = {
      _type: "text" as const,
      _plain: "",
      _mutable: {} as TextRef,
      _placeholder: "",
    }
    const withPlaceholder = Object.assign(base, {
      placeholder(value: string): TextContainerShape {
        return { ...base, _placeholder: value }
      },
    })
    return withMigrationMethods(
      withPlaceholder,
    ) as MigratableWithPlaceholder<TextContainerShape>
  },

  tree: <T extends MapContainerShape>(
    shape: T,
  ): MigratableContainerShape<TreeContainerShape<T>> => {
    const base: TreeContainerShape<T> = {
      _type: "tree" as const,
      shape,
      _plain: {} as any,
      _mutable: {} as any,
      _placeholder: [] as never[],
    }
    return withMigrationMethods(base)
  },

  // Values are represented as plain JS objects, with the limitation that they MUST be
  // representable as a Loro "Value"--basically JSON. The behavior of a Value is basically
  // "Last Write Wins", meaning there is no subtle convergent behavior here, just taking
  // the most recent value based on the current available information.
  plain: {
    string: <T extends string = string>(
      ...options: T[]
    ): MigratableContainerShape<StringValueShape<T>> & {
      placeholder(value: T): MigratableContainerShape<StringValueShape<T>>
    } => {
      const base: StringValueShape<T> = {
        _type: "value" as const,
        valueType: "string" as const,
        _plain: (options[0] ?? "") as T,
        _mutable: (options[0] ?? "") as T,
        _placeholder: (options[0] ?? "") as T,
        options: options.length > 0 ? options : undefined,
      }
      const withPlaceholder = Object.assign(base, {
        placeholder(value: T): StringValueShape<T> {
          return { ...base, _placeholder: value }
        },
      })
      return withMigrationMethods(withPlaceholder) as any
    },

    number: (): MigratableContainerShape<NumberValueShape> & {
      placeholder(value: number): MigratableContainerShape<NumberValueShape>
    } => {
      const base: NumberValueShape = {
        _type: "value" as const,
        valueType: "number" as const,
        _plain: 0,
        _mutable: 0,
        _placeholder: 0,
      }
      const withPlaceholder = Object.assign(base, {
        placeholder(value: number): NumberValueShape {
          return { ...base, _placeholder: value }
        },
      })
      return withMigrationMethods(withPlaceholder) as any
    },

    boolean: (): MigratableContainerShape<BooleanValueShape> & {
      placeholder(value: boolean): MigratableContainerShape<BooleanValueShape>
    } => {
      const base: BooleanValueShape = {
        _type: "value" as const,
        valueType: "boolean" as const,
        _plain: false,
        _mutable: false,
        _placeholder: false,
      }
      const withPlaceholder = Object.assign(base, {
        placeholder(value: boolean): BooleanValueShape {
          return { ...base, _placeholder: value }
        },
      })
      return withMigrationMethods(withPlaceholder) as any
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

    uint8Array: (): Uint8ArrayValueShape => ({
      _type: "value" as const,
      valueType: "uint8array" as const,
      _plain: new Uint8Array(),
      _mutable: new Uint8Array(),
      _placeholder: new Uint8Array(),
    }),

    object: <T extends Record<string, ValueShape>>(
      shape: T,
    ): MigratableContainerShape<ObjectValueShape<T>> => {
      const base: ObjectValueShape<T> = {
        _type: "value" as const,
        valueType: "object" as const,
        shape,
        _plain: {} as any,
        _mutable: {} as any,
        _placeholder: {} as any,
      }
      return withMigrationMethods(base)
    },

    record: <T extends ValueShape>(shape: T): RecordValueShape<T> => ({
      _type: "value" as const,
      valueType: "record" as const,
      shape,
      _plain: {} as any,
      _mutable: {} as any,
      _placeholder: {} as Record<string, never>,
    }),

    array: <T extends ValueShape>(shape: T): ArrayValueShape<T> => ({
      _type: "value" as const,
      valueType: "array" as const,
      shape,
      _plain: [] as any,
      _mutable: [] as any,
      _placeholder: [] as never[],
    }),

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
     * const ClientPresenceShape = Shape.plain.object({
     *   type: Shape.plain.string("client"),
     *   name: Shape.plain.string(),
     *   input: Shape.plain.object({ force: Shape.plain.number(), angle: Shape.plain.number() }),
     * })
     *
     * const ServerPresenceShape = Shape.plain.object({
     *   type: Shape.plain.string("server"),
     *   cars: Shape.plain.record(Shape.plain.object({ x: Shape.plain.number(), y: Shape.plain.number() })),
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
      T extends Record<string, ObjectValueShape>,
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
          : T extends MapContainerShape | RecordContainerShape
            ? LoroMap
            : T extends TreeContainerShape
              ? LoroTree
              : never // not a container
