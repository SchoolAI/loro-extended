import type { LoroList } from "loro-crdt"
import type { ContainerOrValueShape } from "../shape.js"
import type { Infer } from "../types.js"
import { ListRefBase } from "./list-base.js"

// List typed ref
export class ListRef<
  NestedShape extends ContainerOrValueShape,
> extends ListRefBase<NestedShape> {
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
