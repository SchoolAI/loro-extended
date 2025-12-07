import type { TreeContainerShape } from "../shape.js"
import { TypedRef } from "./base.js"

// Tree typed ref
export class TreeRef<T extends TreeContainerShape> extends TypedRef<T> {
  absorbPlainValues() {
    // TODO(duane): implement for trees
  }

  createNode(parent?: any, index?: number): any {
    if (this.readonly) throw new Error("Cannot modify readonly ref")
    return this.container.createNode(parent, index)
  }

  move(target: any, parent?: any, index?: number): void {
    if (this.readonly) throw new Error("Cannot modify readonly ref")
    this.container.move(target, parent, index)
  }

  delete(target: any): void {
    if (this.readonly) throw new Error("Cannot modify readonly ref")
    this.container.delete(target)
  }

  has(target: any): boolean {
    return this.container.has(target)
  }

  getNodeByID(id: any): any {
    return this.container.getNodeByID
      ? this.container.getNodeByID(id)
      : undefined
  }
}
