import type { ContainerOrValueShape } from "../shape.js"
import type { InferMutableType } from "../types.js"
import type { TypedRefParams } from "./base.js"
import { ListRefBase } from "./list-ref-base.js"
import { ListRefInternals } from "./list-ref-internals.js"

/**
 * List typed ref - thin facade that delegates to ListRefInternals.
 */
export class ListRef<
  NestedShape extends ContainerOrValueShape,
> extends ListRefBase<NestedShape> {
  // Returns the mutable type which has toJSON() and other ref methods.
  // For assignment, the proxy handler accepts plain values and converts them.
  // TypeScript may require type assertions for plain value assignments.
  [index: number]: InferMutableType<NestedShape> | undefined

  protected override createInternals(
    params: TypedRefParams<any>,
  ): ListRefInternals<NestedShape> {
    return new ListRefInternals(params)
  }
}
