import type { Container } from "loro-crdt"
import type { InferPlainType } from "../index.js"
import type { MovableListContainerShape } from "../shape.js"
import { ListDraftNodeBase } from "./list-base.js"

// Movable list draft node
export class MovableListDraftNode<
  Shape extends MovableListContainerShape,
  Item = InferPlainType<Shape["shape"]>,
> extends ListDraftNodeBase<Shape> {
  protected absorbValueAtIndex(index: number, value: any): void {
    // LoroMovableList has set method
    this.container.set(index, value)
  }

  move(from: number, to: number): void {
    this.container.move(from, to)
  }

  set(index: number, item: Exclude<Item, Container>) {
    return this.container.set(index, item)
  }
}
