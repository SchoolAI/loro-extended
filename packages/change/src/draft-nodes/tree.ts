import type { TreeContainerShape } from "../shape.js"
import { DraftNode } from "./base.js"

// Tree draft node
export class TreeDraftNode<T extends TreeContainerShape> extends DraftNode<T> {
  absorbPlainValues() {
    // TODO(duane): implement for trees
  }

  createNode(parent?: any, index?: number): any {
    return this.container.createNode(parent, index)
  }

  move(target: any, parent?: any, index?: number): void {
    this.container.move(target, parent, index)
  }

  delete(target: any): void {
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
