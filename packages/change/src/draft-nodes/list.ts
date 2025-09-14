import type { ListContainerShape } from "../shape.js"
import { ListDraftNodeBase } from "./list-base.js"

// List draft node
export class ListDraftNode<
  Shape extends ListContainerShape,
> extends ListDraftNodeBase<Shape> {
  protected absorbValueAtIndex(index: number, value: any): void {
    // LoroList doesn't have set method, need to delete and insert
    this.container.delete(index, 1)
    this.container.insert(index, value)
  }
}
