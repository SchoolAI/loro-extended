import type { Container, LoroList, LoroMovableList } from "loro-crdt"
import { convertInputToNode } from "../conversion.js"
import type {
  ContainerOrValueShape,
  ContainerShape,
  ListContainerShape,
  MovableListContainerShape,
} from "../shape.js"
import { isContainer, isValueShape } from "../utils/type-guards.js"
import { DraftNode, type DraftNodeParams } from "./base.js"
import { createContainerDraftNode } from "./utils.js"

// Shared logic for list operations
export abstract class ListDraftNodeBase<
  NestedShape extends ContainerOrValueShape,
  Item = NestedShape["_plain"],
  DraftItem = NestedShape["_draft"],
> extends DraftNode<any> {
  // Cache for items returned by array methods to track mutations
  private itemCache = new Map<number, any>()

  protected get container(): LoroList | LoroMovableList {
    return super.container as LoroList | LoroMovableList
  }

  protected get shape():
    | ListContainerShape<NestedShape>
    | MovableListContainerShape<NestedShape> {
    return super.shape as
      | ListContainerShape<NestedShape>
      | MovableListContainerShape<NestedShape>
  }

  absorbPlainValues() {
    // Critical function: absorb mutated plain values back into Loro containers
    // This is called at the end of change() to persist mutations made to plain objects
    for (const [index, cachedItem] of this.itemCache.entries()) {
      if (cachedItem) {
        if (isValueShape(this.shape.shape)) {
          // For value shapes, delegate to subclass-specific absorption logic
          this.absorbValueAtIndex(index, cachedItem)
        } else {
          // For container shapes, the item should be a draft node that handles its own absorption
          if (
            cachedItem &&
            typeof cachedItem === "object" &&
            "absorbPlainValues" in cachedItem
          ) {
            ;(cachedItem as any).absorbPlainValues()
          }
        }
      }
    }

    // Clear the cache after absorbing values
    this.itemCache.clear()
  }

  // Abstract method to be implemented by subclasses
  // Each subclass knows how to handle its specific container type
  protected abstract absorbValueAtIndex(index: number, value: any): void

  protected insertWithConversion(index: number, item: Item): void {
    const convertedItem = convertInputToNode(item as any, this.shape.shape)
    if (isContainer(convertedItem)) {
      this.container.insertContainer(index, convertedItem)
    } else {
      this.container.insert(index, convertedItem)
    }
  }

  protected pushWithConversion(item: Item): void {
    const convertedItem = convertInputToNode(item as any, this.shape.shape)
    if (isContainer(convertedItem)) {
      this.container.pushContainer(convertedItem)
    } else {
      this.container.push(convertedItem)
    }
  }

  getDraftNodeParams(
    index: number,
    shape: ContainerShape,
  ): DraftNodeParams<ContainerShape> {
    return {
      shape,
      emptyState: undefined, // List items don't have empty state
      getContainer: () => {
        const containerItem = this.container.get(index)
        if (!containerItem || !isContainer(containerItem)) {
          throw new Error(`No container found at index ${index}`)
        }
        return containerItem
      },
      readonly: this.readonly,
    }
  }

  // Get item for predicate functions - always returns plain Item for filtering logic
  protected getPredicateItem(index: number): Item {
    // CRITICAL FIX: For predicates to work correctly with mutations,
    // we need to check if there's a cached (mutated) version first
    const cachedItem = this.itemCache.get(index)
    if (cachedItem && isValueShape(this.shape.shape)) {
      // For value shapes, if we have a cached item, use it so predicates see mutations
      return cachedItem as Item
    }

    const containerItem = this.container.get(index)
    if (containerItem === undefined) {
      return undefined as Item
    }

    if (isValueShape(this.shape.shape)) {
      // For value shapes, return the plain value directly
      return containerItem as Item
    } else {
      // For container shapes, we need to return the plain object representation
      // This allows predicates to access nested properties like article.metadata.author
      if (isContainer(containerItem)) {
        // Convert container to plain object for predicate logic
        // Handle different container types that may not have toJSON method
        if (
          typeof containerItem === "object" &&
          containerItem !== null &&
          "toJSON" in containerItem
        ) {
          return (containerItem as any).toJSON() as Item
        } else if (
          typeof containerItem === "object" &&
          containerItem !== null &&
          "getShallowValue" in containerItem
        ) {
          // For containers like LoroCounter that don't have toJSON but have getShallowValue
          return (containerItem as any).getShallowValue() as Item
        } else {
          // Fallback for other container types
          return containerItem as Item
        }
      }
      return containerItem as Item
    }
  }

  // Get item for return values - returns DraftItem that can be mutated
  protected getDraftItem(index: number): any {
    // Check if we already have a cached item for this index
    let cachedItem = this.itemCache.get(index)
    if (cachedItem) {
      return cachedItem
    }

    // Get the raw container item
    const containerItem = this.container.get(index)
    if (containerItem === undefined) {
      return undefined as DraftItem
    }

    if (isValueShape(this.shape.shape)) {
      // For value shapes, we need to ensure mutations persist
      // The key insight: we must return the SAME object for the same index
      // so that mutations to filtered/found items persist back to the cache
      if (typeof containerItem === "object" && containerItem !== null) {
        // Create a deep copy for objects so mutations can be tracked
        // IMPORTANT: Only create the copy once, then always return the same cached object
        cachedItem = JSON.parse(JSON.stringify(containerItem))
      } else {
        // For primitives, just use the value directly
        cachedItem = containerItem
      }
      // Only cache primitive values if NOT readonly
      if (!this.readonly) {
        this.itemCache.set(index, cachedItem)
      }
      return cachedItem as DraftItem
    } else {
      // For container shapes, create a proper draft node using the new pattern
      cachedItem = createContainerDraftNode(
        this.getDraftNodeParams(index, this.shape.shape as ContainerShape),
      )
      // Cache container nodes
      this.itemCache.set(index, cachedItem)

      if (this.readonly) {
        const shape = this.shape.shape as ContainerShape
        if (shape._type === "counter") {
          return (cachedItem as any).value
        }
        if (shape._type === "text") {
          return (cachedItem as any).toString()
        }
      }

      return cachedItem as DraftItem
    }
  }

  // Array-like methods for better developer experience
  // DUAL INTERFACE: Predicates get Item (plain data), return values are DraftItem (mutable)

  find(
    predicate: (item: Item, index: number) => boolean,
  ): DraftItem | undefined {
    for (let i = 0; i < this.length; i++) {
      const predicateItem = this.getPredicateItem(i)
      if (predicate(predicateItem, i)) {
        return this.getDraftItem(i) // Return mutable draft item
      }
    }
    return undefined
  }

  findIndex(predicate: (item: Item, index: number) => boolean): number {
    for (let i = 0; i < this.length; i++) {
      const predicateItem = this.getPredicateItem(i)
      if (predicate(predicateItem, i)) {
        return i
      }
    }
    return -1
  }

  map<ReturnType>(
    callback: (item: Item, index: number) => ReturnType,
  ): ReturnType[] {
    const result: ReturnType[] = []
    for (let i = 0; i < this.length; i++) {
      const predicateItem = this.getPredicateItem(i)
      result.push(callback(predicateItem, i))
    }
    return result
  }

  filter(predicate: (item: Item, index: number) => boolean): DraftItem[] {
    const result: DraftItem[] = []
    for (let i = 0; i < this.length; i++) {
      const predicateItem = this.getPredicateItem(i)
      if (predicate(predicateItem, i)) {
        result.push(this.getDraftItem(i)) // Return mutable draft items
      }
    }
    return result
  }

  forEach(callback: (item: Item, index: number) => void): void {
    for (let i = 0; i < this.length; i++) {
      const predicateItem = this.getPredicateItem(i)
      callback(predicateItem, i)
    }
  }

  some(predicate: (item: Item, index: number) => boolean): boolean {
    for (let i = 0; i < this.length; i++) {
      const predicateItem = this.getPredicateItem(i)
      if (predicate(predicateItem, i)) {
        return true
      }
    }
    return false
  }

  every(predicate: (item: Item, index: number) => boolean): boolean {
    for (let i = 0; i < this.length; i++) {
      const predicateItem = this.getPredicateItem(i)
      if (!predicate(predicateItem, i)) {
        return false
      }
    }
    return true
  }

  insert(index: number, item: Item): void {
    if (this.readonly) throw new Error("Cannot modify readonly doc")
    // Update cache indices before performing the insert operation
    this.updateCacheForInsert(index)
    this.insertWithConversion(index, item)
  }

  delete(index: number, len: number): void {
    if (this.readonly) throw new Error("Cannot modify readonly doc")
    // Update cache indices before performing the delete operation
    this.updateCacheForDelete(index, len)
    this.container.delete(index, len)
  }

  push(item: Item): void {
    if (this.readonly) throw new Error("Cannot modify readonly doc")
    this.pushWithConversion(item)
  }

  pushContainer(container: Container): Container {
    if (this.readonly) throw new Error("Cannot modify readonly doc")
    return this.container.pushContainer(container)
  }

  insertContainer(index: number, container: Container): Container {
    if (this.readonly) throw new Error("Cannot modify readonly doc")
    return this.container.insertContainer(index, container)
  }

  get(index: number): DraftItem {
    return this.getDraftItem(index)
  }

  toArray(): Item[] {
    return this.container.toArray() as Item[]
  }

  get length(): number {
    return this.container.length
  }

  // Update cache indices when items are deleted
  private updateCacheForDelete(deleteIndex: number, deleteLen: number): void {
    const newCache = new Map<number, any>()

    for (const [cachedIndex, cachedItem] of this.itemCache.entries()) {
      if (cachedIndex < deleteIndex) {
        // Items before the deletion point keep their indices
        newCache.set(cachedIndex, cachedItem)
      } else if (cachedIndex >= deleteIndex + deleteLen) {
        // Items after the deletion range shift down by deleteLen
        newCache.set(cachedIndex - deleteLen, cachedItem)
      }
      // Items within the deletion range are removed from cache
    }

    this.itemCache = newCache
  }

  // Update cache indices when items are inserted
  private updateCacheForInsert(insertIndex: number): void {
    const newCache = new Map<number, any>()

    for (const [cachedIndex, cachedItem] of this.itemCache.entries()) {
      if (cachedIndex < insertIndex) {
        // Items before the insertion point keep their indices
        newCache.set(cachedIndex, cachedItem)
      } else {
        // Items at or after the insertion point shift up by 1
        newCache.set(cachedIndex + 1, cachedItem)
      }
    }

    this.itemCache = newCache
  }
}
