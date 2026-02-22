import type { ContainerOrValueShape, RefMode } from "../shape.js"
import { INTERNAL_SYMBOL, type TypedRefParams } from "./base.js"
import { ListRefBase } from "./list-ref-base.js"
import { MovableListRefInternals } from "./movable-list-ref-internals.js"

/**
 * Movable list typed ref - thin facade that delegates to MovableListRefInternals.
 *
 * Access elements via .get(index) method and modify via .set(index, value).
 * Bracket notation is not supported for consistency with method-based API.
 */
export class MovableListRef<
  NestedShape extends ContainerOrValueShape,
  Mode extends RefMode = "mutable",
> extends ListRefBase<NestedShape, Mode> {
  declare [INTERNAL_SYMBOL]: MovableListRefInternals<NestedShape>

  protected override createInternals(
    params: TypedRefParams<any>,
  ): MovableListRefInternals<NestedShape> {
    return new MovableListRefInternals(params)
  }

  move(from: number, to: number): void {
    this[INTERNAL_SYMBOL].move(from, to)
  }
}
