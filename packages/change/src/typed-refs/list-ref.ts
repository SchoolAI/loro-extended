import type { ContainerOrValueShape, RefMode } from "../shape.js"
import type { TypedRefParams } from "./base.js"
import { ListRefBase } from "./list-ref-base.js"
import { ListRefInternals } from "./list-ref-internals.js"

/**
 * List typed ref - thin facade that delegates to ListRefInternals.
 *
 * The `Mode` parameter controls element types:
 * - `"mutable"` (default): Elements return `PlainValueRef<T>` for reactive access outside `change()`
 * - `"draft"`: Elements return plain `T` for ergonomic mutation inside `change()` callbacks
 */
export class ListRef<
  NestedShape extends ContainerOrValueShape,
  Mode extends RefMode = "mutable",
> extends ListRefBase<NestedShape, Mode> {
  // Returns the element type based on Mode.
  // For mutable mode: PlainValueRef<T> for reactive access
  // For draft mode: plain T for ergonomic mutation
  [index: number]:
    | (Mode extends "mutable" ? NestedShape["_mutable"] : NestedShape["_draft"])
    | undefined

  protected override createInternals(
    params: TypedRefParams<any>,
  ): ListRefInternals<NestedShape> {
    return new ListRefInternals(params)
  }
}
