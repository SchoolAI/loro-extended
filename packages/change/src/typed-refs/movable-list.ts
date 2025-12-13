import type { Container, LoroMovableList } from "loro-crdt"
import type { ContainerOrValueShape } from "../shape.js"
import type { Infer } from "../types.js"
import { ListRefBase } from "./list-base.js"

// Movable list typed ref
export class MovableListRef<
  NestedShape extends ContainerOrValueShape,
  Item = NestedShape["_plain"],
> extends ListRefBase<NestedShape> {
  [index: number]: Infer<NestedShape>

  protected get container(): LoroMovableList {
    return super.container as LoroMovableList
  }

  protected absorbValueAtIndex(index: number, value: any): void {
    // LoroMovableList has set method
    this.container.set(index, value)
  }

  move(from: number, to: number): void {
    this.assertMutable()
    this.container.move(from, to)
    this.commitIfAuto()
  }

  set(index: number, item: Exclude<Item, Container>) {
    this.assertMutable()
    const result = this.container.set(index, item)
    this.commitIfAuto()
    return result
  }
}
