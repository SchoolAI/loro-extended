import type { Container } from "loro-crdt"
import type { ContainerOrValueShape, RefMode } from "../shape.js"
import { INTERNAL_SYMBOL, type TypedRefParams } from "./base.js"
import { ListRefBase } from "./list-ref-base.js"
import { MovableListRefInternals } from "./movable-list-ref-internals.js"

/**
 * Movable list typed ref - thin facade that delegates to MovableListRefInternals.
 *
 * The `Mode` parameter controls element types:
 * - `"mutable"` (default): Elements return `PlainValueRef<T>` for reactive access outside `change()`
 * - `"draft"`: Elements return plain `T` for ergonomic mutation inside `change()` callbacks
 */
export class MovableListRef<
  NestedShape extends ContainerOrValueShape,
  Mode extends RefMode = "mutable",
  Item = NestedShape["_plain"],
> extends ListRefBase<NestedShape, Mode> {
  declare [INTERNAL_SYMBOL]: MovableListRefInternals<NestedShape>;
  [index: number]:
    | (Mode extends "mutable" ? NestedShape["_mutable"] : NestedShape["_draft"])
    | undefined

  protected override createInternals(
    params: TypedRefParams<any>,
  ): MovableListRefInternals<NestedShape> {
    return new MovableListRefInternals(params)
  }

  move(from: number, to: number): void {
    this[INTERNAL_SYMBOL].move(from, to)
  }

  set(index: number, item: Exclude<Item, Container>) {
    this[INTERNAL_SYMBOL].set(index, item)
  }
}
