import type { Container } from "loro-crdt"
import { convertInputToNode } from "../conversion.js"
import type { ListContainerShape, MovableListContainerShape } from "../shape.js"
import type { InferPlainType } from "../types.js"
import { isContainer, isValueShape } from "../utils/type-guards.js"
import { DraftNode } from "./base.js"

// Shared logic for list operations
export abstract class ListDraftNodeBase<
  Shape extends ListContainerShape | MovableListContainerShape,
> extends DraftNode<Shape> {
  absorbPlainValues() {
    // TODO(duane): absorb array values
    // this.schema.shape
  }

  protected insertWithConversion(index: number, item: any): void {
    const convertedItem = convertInputToNode(item, this.shape.shape)
    if (isContainer(convertedItem)) {
      this.container.insertContainer(index, convertedItem)
    } else {
      this.container.insert(index, convertedItem)
    }
  }

  protected pushWithConversion(item: any): void {
    const convertedItem = convertInputToNode(item, this.shape.shape)
    if (isContainer(convertedItem)) {
      this.container.pushContainer(convertedItem)
    } else {
      this.container.push(convertedItem)
    }
  }

  // Get the appropriate item for array methods - either draft container or plain value
  protected getDraftItem(index: number): any {
    // For container shapes, we need to return the draft container object
    // For value shapes, we return the plain value
    if (isValueShape(this.shape.shape)) {
      return this.get(index) // Plain value
    } else {
      // Container shape - create/get the draft node
      const itemPath = [...this.path, index.toString()]
      return createDraftNode({
        doc: this.doc,
        shape: this.shape.shape,
        path: itemPath,
        // No empty state for individual list items, they must be fully specified
      })
    }
  }

  // Array-like methods for better developer experience
  find(predicate: (item: Shape, index: number) => boolean): Shape | undefined {
    for (let i = 0; i < this.length; i++) {
      const item = this.getDraftItem(i)
      if (predicate(item, i)) {
        return item
      }
    }
    return undefined
  }

  findIndex<ItemType = any>(
    predicate: (item: ItemType, index: number) => boolean,
  ): number {
    for (let i = 0; i < this.length; i++) {
      const item = this.getDraftItem(i)
      if (predicate(item, i)) {
        return i
      }
    }
    return -1
  }

  map<ItemType = any, ReturnType = any>(
    callback: (item: ItemType, index: number) => ReturnType,
  ): ReturnType[] {
    const result: ReturnType[] = []
    for (let i = 0; i < this.length; i++) {
      const item = this.getDraftItem(i)
      result.push(callback(item, i))
    }
    return result
  }

  filter<ItemType = any>(
    predicate: (item: ItemType, index: number) => boolean,
  ): ItemType[] {
    const result: ItemType[] = []
    for (let i = 0; i < this.length; i++) {
      const item = this.getDraftItem(i)
      if (predicate(item, i)) {
        result.push(item)
      }
    }
    return result
  }

  forEach<ItemType = any>(
    callback: (item: ItemType, index: number) => void,
  ): void {
    for (let i = 0; i < this.length; i++) {
      const item = this.getDraftItem(i)
      callback(item, i)
    }
  }

  some<ItemType = any>(
    predicate: (item: ItemType, index: number) => boolean,
  ): boolean {
    for (let i = 0; i < this.length; i++) {
      const item = this.getDraftItem(i)
      if (predicate(item, i)) {
        return true
      }
    }
    return false
  }

  every<ItemType = any>(
    predicate: (item: ItemType, index: number) => boolean,
  ): boolean {
    for (let i = 0; i < this.length; i++) {
      const item = this.getDraftItem(i)
      if (!predicate(item, i)) {
        return false
      }
    }
    return true
  }

  insert(index: number, item: InferPlainType<Shape>): void {
    this.insertWithConversion(index, item)
  }

  delete(index: number, len: number): void {
    this.container.delete(index, len)
  }

  push(item: InferPlainType<Shape>): void {
    this.pushWithConversion(item)
  }

  pushContainer(container: Container): Container {
    return this.container.pushContainer(container)
  }

  insertContainer(index: number, container: Container): Container {
    return this.container.insertContainer(index, container)
  }

  get(index: number): any {
    return this.container.get(index)
  }

  toArray(): any[] {
    return this.container.toArray()
  }

  get length(): number {
    return this.container.length
  }
}
