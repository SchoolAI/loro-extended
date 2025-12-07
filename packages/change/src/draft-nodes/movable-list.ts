import type { Container, LoroMovableList } from "loro-crdt"
import type { ContainerOrValueShape } from "../shape.js"
import type { Infer } from "../types.js"
import { ListDraftNodeBase } from "./list-base.js"

// Movable list draft node
export class MovableListDraftNode<
  NestedShape extends ContainerOrValueShape,
  Item = NestedShape["_plain"],
> extends ListDraftNodeBase<NestedShape> {
  [index: number]: Infer<NestedShape>

  protected get container(): LoroMovableList {
    return super.container as LoroMovableList
  }

  protected absorbValueAtIndex(index: number, value: any): void {
    // LoroMovableList has set method
    this.container.set(index, value)
  }

  move(from: number, to: number): void {
    if (this.readonly) throw new Error("Cannot modify readonly doc")
    this.container.move(from, to)
  }

  set(index: number, item: Exclude<Item, Container>) {
    if (this.readonly) throw new Error("Cannot modify readonly doc")
    return this.container.set(index, item)
  }
}
