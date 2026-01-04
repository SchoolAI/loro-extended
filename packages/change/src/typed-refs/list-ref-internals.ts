import type { LoroList } from "loro-crdt"
import type { ContainerOrValueShape } from "../shape.js"
import { ListRefBaseInternals } from "./list-ref-base.js"

/**
 * Internal implementation for ListRef.
 * Extends ListRefBaseInternals with LoroList-specific absorption logic.
 */
export class ListRefInternals<
  NestedShape extends ContainerOrValueShape,
  Item = NestedShape["_plain"],
  MutableItem = NestedShape["_mutable"],
> extends ListRefBaseInternals<NestedShape, Item, MutableItem> {
  /** Absorb value at specific index for LoroList */
  override absorbValueAtIndex(index: number, value: unknown): void {
    // LoroList doesn't have set method, need to delete and insert
    const container = this.getContainer() as LoroList
    container.delete(index, 1)
    container.insert(index, value)
  }
}
