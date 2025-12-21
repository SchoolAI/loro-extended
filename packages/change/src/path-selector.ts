// ============================================================================
// Type-Safe Path Selector DSL
// ============================================================================
//
// This module provides type definitions for a type-safe path selector DSL
// that compiles to JSONPath strings for WASM-side filtering.
//
// See plans/typed-path-selector-dsl.md for full design documentation.

import type {
  ContainerOrValueShape,
  CounterContainerShape,
  DocShape,
  ListContainerShape,
  MovableListContainerShape,
  RecordContainerShape,
  StructContainerShape,
  TextContainerShape,
  ValueShape,
} from "./shape.js"
import type { Infer } from "./types.js"

// ============================================================================
// Path Segment Types
// ============================================================================

export type PathSegment =
  | { type: "property"; key: string }
  | { type: "each" } // Wildcard for arrays/records
  | { type: "index"; index: number } // Specific array index (supports negative)
  | { type: "key"; key: string } // Specific record key

// ============================================================================
// Path Selector (carries type and segments)
// ============================================================================

export interface PathSelector<T> {
  readonly __resultType: T // Phantom type for inference
  readonly __segments: PathSegment[] // Runtime path data
}

// ============================================================================
// Path Node Types (for each container type)
// ============================================================================

// List path node - InArray tracks if we're inside a wildcard
interface ListPathNode<Item extends ContainerOrValueShape, InArray extends boolean>
  extends PathSelector<WrapType<Infer<Item>[], InArray>> {
  /** Select all items (wildcard) - sets InArray to true for children */
  readonly $each: PathNode<Item, true>
  /** Select item at specific index (supports negative indices: -1 = last, -2 = second-to-last, etc.) */
  $at(index: number): PathNode<Item, InArray>
  /** Select first item (alias for $at(0)) */
  readonly $first: PathNode<Item, InArray>
  /** Select last item (alias for $at(-1)) */
  readonly $last: PathNode<Item, InArray>
}

// Struct path node (fixed keys) - propagates InArray to children
type StructPathNode<
  Shapes extends Record<string, ContainerOrValueShape>,
  InArray extends boolean,
> = PathSelector<WrapType<{ [K in keyof Shapes]: Infer<Shapes[K]> }, InArray>> & {
  readonly [K in keyof Shapes]: PathNode<Shapes[K], InArray>
}

// Record path node (dynamic keys) - propagates InArray to children
interface RecordPathNode<Item extends ContainerOrValueShape, InArray extends boolean>
  extends PathSelector<WrapType<Record<string, Infer<Item>>, InArray>> {
  /** Select all values (wildcard) - sets InArray to true for children */
  readonly $each: PathNode<Item, true>
  /** Select value at specific key */
  $key(key: string): PathNode<Item, InArray>
}

// Text path node (terminal)
type TextPathNode<InArray extends boolean> = PathSelector<WrapType<string, InArray>>

// Counter path node (terminal)
type CounterPathNode<InArray extends boolean> = PathSelector<WrapType<number, InArray>>

// Terminal node for primitive values
type TerminalPathNode<T, InArray extends boolean> = PathSelector<WrapType<T, InArray>>

// ============================================================================
// PathNode Type Mapping
// ============================================================================

// Helper: wrap type in array if InArray is true
type WrapType<T, InArray extends boolean> = InArray extends true ? T[] : T

// InArray tracks whether we've passed through a wildcard ($each)
// This affects the result type: T vs T[]
export type PathNode<
  S extends ContainerOrValueShape,
  InArray extends boolean,
> = S extends ListContainerShape<infer Item>
  ? ListPathNode<Item, InArray>
  : S extends MovableListContainerShape<infer Item>
    ? ListPathNode<Item, InArray>
    : S extends StructContainerShape<infer Shapes>
      ? StructPathNode<Shapes, InArray>
      : S extends RecordContainerShape<infer Item>
        ? RecordPathNode<Item, InArray>
        : S extends TextContainerShape
          ? TextPathNode<InArray>
          : S extends CounterContainerShape
            ? CounterPathNode<InArray>
            : S extends ValueShape
              ? TerminalPathNode<Infer<S>, InArray>
              : never

// ============================================================================
// Path Builder (entry point)
// ============================================================================

export type PathBuilder<D extends DocShape> = {
  readonly [K in keyof D["shapes"]]: PathNode<D["shapes"][K], false>
}
