import type { Container } from "loro-crdt"
import type { ContainerOrValueShape } from "../shape.js"
import type { InferMutableType } from "../types.js"
import { INTERNAL_SYMBOL, type TypedRefParams } from "./base.js"
import { ListRefBase } from "./list-ref-base.js"
import { MovableListRefInternals } from "./movable-list-ref-internals.js"

/**
 * Movable list typed ref - thin facade that delegates to MovableListRefInternals.
 */
export class MovableListRef<
  NestedShape extends ContainerOrValueShape,
  Item = NestedShape["_plain"],
> extends ListRefBase<NestedShape> {
  declare [INTERNAL_SYMBOL]: MovableListRefInternals<NestedShape>;
  [index: number]: InferMutableType<NestedShape> | undefined

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
