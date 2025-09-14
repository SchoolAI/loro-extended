import type { MovableListContainerShape } from "../shape.js"
import { ListDraftNodeBase } from "./list-base.js"

// Movable list draft node
export class MovableListDraftNode<
  Shape extends MovableListContainerShape,
> extends ListDraftNodeBase<Shape> {
  move(from: number, to: number): void {
    this.container.move(from, to)
  }
}
