import type { TreeContainerShape } from "../shape.js"
import { TypedRef } from "./base.js"

// Tree typed ref
export class TreeRef<T extends TreeContainerShape> extends TypedRef<T> {
  absorbPlainValues() {
    // TODO(duane): implement for trees
  }

  createNode(parent?: any, index?: number): any {
    this.assertMutable()
    return this.container.createNode(parent, index)
  }

  move(target: any, parent?: any, index?: number): void {
    this.assertMutable()
    this.container.move(target, parent, index)
  }

  delete(target: any): void {
    this.assertMutable()
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
