import type { ContainerOrValueShape, RefMode } from "../shape.js"
import type { TypedRefParams } from "./base.js"
import { ListRefBase } from "./list-ref-base.js"
import { ListRefInternals } from "./list-ref-internals.js"

/**
 * List typed ref - thin facade that delegates to ListRefInternals.
 *
 * Access elements via .get(index) method and modify via .set(index, value).
 * Bracket notation is not supported for consistency with method-based API.
 */
export class ListRef<
  NestedShape extends ContainerOrValueShape,
  Mode extends RefMode = "mutable",
> extends ListRefBase<NestedShape, Mode> {
  protected override createInternals(
    params: TypedRefParams<any>,
  ): ListRefInternals<NestedShape> {
    return new ListRefInternals(params)
  }
}
