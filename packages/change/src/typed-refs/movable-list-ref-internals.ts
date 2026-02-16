import type { LoroMovableList } from "loro-crdt"
import type { ContainerOrValueShape } from "../shape.js"
import { ListRefBaseInternals } from "./list-ref-base.js"

// ============================================================================
// MovableListRefInternals - Internal implementation class
// ============================================================================

/**
 * Internal implementation for MovableListRef.
 * Extends ListRefBaseInternals with LoroMovableList-specific methods.
 */
export class MovableListRefInternals<
  NestedShape extends ContainerOrValueShape,
  Item = NestedShape["_plain"],
  MutableItem = NestedShape["_mutable"],
> extends ListRefBaseInternals<NestedShape, Item, MutableItem> {
  /** Move an item from one index to another */
  move(from: number, to: number): void {
    const container = this.getContainer() as LoroMovableList
    container.move(from, to)
    this.commitIfAuto()
  }

  /** Set an item at a specific index */
  set(index: number, item: unknown): void {
    const container = this.getContainer() as LoroMovableList
    container.set(index, item)
    this.commitIfAuto()
  }
}
