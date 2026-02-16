import type { ContainerOrValueShape } from "../shape.js"
import { ListRefBaseInternals } from "./list-ref-base.js"

/**
 * Internal implementation for ListRef.
 * Extends ListRefBaseInternals with LoroList-specific behavior.
 */
export class ListRefInternals<
  NestedShape extends ContainerOrValueShape,
  Item = NestedShape["_plain"],
  MutableItem = NestedShape["_mutable"],
> extends ListRefBaseInternals<NestedShape, Item, MutableItem> {}
