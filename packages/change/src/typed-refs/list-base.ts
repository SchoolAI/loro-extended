import type { Container, LoroList, LoroMovableList } from "loro-crdt"
import { convertInputToNode } from "../conversion.js"
import { deriveShapePlaceholder } from "../derive-placeholder.js"
import { mergeValue } from "../overlay.js"
import type {
  ContainerOrValueShape,
  ContainerShape,
  ListContainerShape,
  MovableListContainerShape,
} from "../shape.js"
import {
  isContainer,
  isContainerShape,
  isValueShape,
} from "../utils/type-guards.js"
import { TypedRef, type TypedRefParams } from "./base.js"
import { createContainerTypedRef, unwrapReadonlyPrimitive } from "./utils.js"

// Shared logic for list operations
export abstract class ListRefBase<
  NestedShape extends ContainerOrValueShape,
  Item = NestedShape["_plain"],
  MutableItem = NestedShape["_mutable"],
> extends TypedRef<any> {
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
          // For container shapes, the item should be a typed ref that handles its own absorption
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

  getTypedRefParams(
    index: number,
    shape: ContainerShape,
  ): TypedRefParams<ContainerShape> {
    return {
      shape,
      placeholder: undefined, // List items don't have placeholder
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

  // Get item for return values - returns MutableItem that can be mutated
  protected getMutableItem(index: number): any {
    // Check if we already have a cached item for this index
    let cachedItem = this.itemCache.get(index)
    if (cachedItem) {
      return cachedItem
    }

    // Get the raw container item
    const containerItem = this.container.get(index)
    if (containerItem === undefined) {
      return undefined as MutableItem
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
      return cachedItem as MutableItem
    } else {
      // For container shapes, create a proper typed ref using the new pattern
      cachedItem = createContainerTypedRef(
        this.getTypedRefParams(index, this.shape.shape as ContainerShape),
      )
      // Cache container nodes
      this.itemCache.set(index, cachedItem)

      if (this.readonly) {
        return unwrapReadonlyPrimitive(
          cachedItem,
          this.shape.shape as ContainerShape,
        )
      }

      return cachedItem as MutableItem
    }
  }

  // Array-like methods for better developer experience
  // DUAL INTERFACE: Predicates get Item (plain data), return values are MutableItem (mutable)

  find(
    predicate: (item: Item, index: number) => boolean,
  ): MutableItem | undefined {
    for (let i = 0; i < this.length; i++) {
      const predicateItem = this.getPredicateItem(i)
      if (predicate(predicateItem, i)) {
        return this.getMutableItem(i) // Return mutable item
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

  filter(predicate: (item: Item, index: number) => boolean): MutableItem[] {
    const result: MutableItem[] = []
    for (let i = 0; i < this.length; i++) {
      const predicateItem = this.getPredicateItem(i)
      if (predicate(predicateItem, i)) {
        result.push(this.getMutableItem(i)) // Return mutable items
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

  slice(start?: number, end?: number): MutableItem[] {
    const len = this.length

    // Normalize start index (following JavaScript Array.prototype.slice semantics)
    const startIndex =
      start === undefined
        ? 0
        : start < 0
          ? Math.max(len + start, 0)
          : Math.min(start, len)

    // Normalize end index
    const endIndex =
      end === undefined
        ? len
        : end < 0
          ? Math.max(len + end, 0)
          : Math.min(end, len)

    const result: MutableItem[] = []
    for (let i = startIndex; i < endIndex; i++) {
      result.push(this.getMutableItem(i))
    }
    return result
  }

  insert(index: number, item: Item): void {
    this.assertMutable()
    // Update cache indices before performing the insert operation
    this.updateCacheForInsert(index)
    this.insertWithConversion(index, item)
  }

  delete(index: number, len: number): void {
    this.assertMutable()
    // Update cache indices before performing the delete operation
    this.updateCacheForDelete(index, len)
    this.container.delete(index, len)
  }

  push(item: Item): void {
    this.assertMutable()
    this.pushWithConversion(item)
  }

  pushContainer(container: Container): Container {
    this.assertMutable()
    return this.container.pushContainer(container)
  }

  insertContainer(index: number, container: Container): Container {
    this.assertMutable()
    return this.container.insertContainer(index, container)
  }

  get(index: number): MutableItem {
    return this.getMutableItem(index)
  }

  toArray(): Item[] {
    const result: Item[] = []
    for (let i = 0; i < this.length; i++) {
      result.push(this.getPredicateItem(i))
    }
    return result
  }

  toJSON(): Item[] {
    // Fast path: readonly mode with no pending mutations
    if (this.readonly) {
      const nativeJson = this.container.toJSON() as any[]

      // If the nested shape is a container shape (map, record, etc.) or an object value shape,
      // we need to overlay placeholders for each item
      if (
        isContainerShape(this.shape.shape) ||
        (isValueShape(this.shape.shape) &&
          this.shape.shape.valueType === "object")
      ) {
        const itemPlaceholder = deriveShapePlaceholder(this.shape.shape)
        return nativeJson.map(item =>
          mergeValue(this.shape.shape, item, itemPlaceholder as any),
        ) as Item[]
      }

      // For primitive value shapes, no overlay needed
      return nativeJson ?? []
    }

    return this.toArray()
  }

  [Symbol.iterator](): IterableIterator<MutableItem> {
    let index = 0
    return {
      next: (): IteratorResult<MutableItem> => {
        if (index < this.length) {
          return { value: this.getMutableItem(index++), done: false }
        }
        return { value: undefined, done: true }
      },
      [Symbol.iterator]() {
        return this
      },
    }
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
