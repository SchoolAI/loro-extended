import type { LoroList } from "loro-crdt"
import type { ContainerOrValueShape } from "../shape.js"
import type { Infer } from "../types.js"
import { ListDraftNodeBase } from "./list-base.js"

// List draft node
export class ListDraftNode<
  NestedShape extends ContainerOrValueShape,
> extends ListDraftNodeBase<NestedShape> {
  [index: number]: Infer<NestedShape>

  protected get container(): LoroList {
    return super.container as LoroList
  }

  protected absorbValueAtIndex(index: number, value: any): void {
    // LoroList doesn't have set method, need to delete and insert
    this.container.delete(index, 1)
    this.container.insert(index, value)
  }
}
