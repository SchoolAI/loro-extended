import type {
  Container,
  LoroDoc,
  LoroList,
  LoroMovableList,
  Subscription,
} from "loro-crdt"
import { convertInputToRef } from "../conversion.js"
import { deriveShapePlaceholder } from "../derive-placeholder.js"
import type { LoroListRef } from "../loro.js"
import { mergeValue } from "../overlay.js"
import type { ContainerOrValueShape, ContainerShape } from "../shape.js"
import {
  isContainer,
  isContainerShape,
  isValueShape,
} from "../utils/type-guards.js"
import {
  BaseRefInternals,
  INTERNAL_SYMBOL,
  TypedRef,
  type TypedRefParams,
} from "./base.js"
import { createContainerTypedRef } from "./utils.js"

// ============================================================================
// ListRefBaseInternals - Internal implementation class
// ============================================================================

/**
 * Internal implementation for ListRefBase.
 * Contains all logic, state, and implementation details for list operations.
 */
export class ListRefBaseInternals<
  NestedShape extends ContainerOrValueShape,
  Item = NestedShape["_plain"],
  MutableItem = NestedShape["_mutable"],
> extends BaseRefInternals<any> {
  private itemCache = new Map<number, any>()

  /** Get typed ref params for creating child refs at an index */
  getChildTypedRefParams(
    index: number,
    shape: ContainerShape,
  ): TypedRefParams<ContainerShape> {
    return {
      shape,
      placeholder: undefined, // List items don't have placeholder
      getContainer: () => {
        const container = this.getContainer() as LoroList | LoroMovableList
        const containerItem = container.get(index)
        if (!containerItem || !isContainer(containerItem)) {
          throw new Error(`No container found at index ${index}`)
        }
        return containerItem
      },
      autoCommit: this.getAutoCommit(),
      batchedMutation: this.getBatchedMutation(),
      getDoc: () => this.getDoc(),
    }
  }

  /** Get item for predicate functions (returns plain value) */
  getPredicateItem(index: number): Item | undefined {
    const shape = this.getShape()
    const container = this.getContainer() as LoroList | LoroMovableList

    // CRITICAL FIX: For predicates to work correctly with mutations,
    // we need to check if there's a cached (mutated) version first
    const cachedItem = this.itemCache.get(index)
    if (cachedItem && isValueShape(shape.shape)) {
      // For value shapes, if we have a cached item, use it so predicates see mutations
      return cachedItem as Item
    }

    const containerItem = container.get(index)
    if (containerItem === undefined) {
      return undefined as Item
    }

    if (isValueShape(shape.shape)) {
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

  /** Get mutable item for return values (returns ref or cached value) */
  getMutableItem(index: number): MutableItem | undefined {
    const shape = this.getShape()
    const container = this.getContainer() as LoroList | LoroMovableList

    // Get the raw container item
    const containerItem = container.get(index)
    if (containerItem === undefined) {
      return undefined as MutableItem
    }

    if (isValueShape(shape.shape)) {
      // When NOT in batchedMutation mode (direct access outside of change()), ALWAYS read fresh
      // from container (NEVER cache). This ensures we always get the latest value
      // from the CRDT, even when modified by a different ref instance (e.g., drafts from change())
      //
      // When in batchedMutation mode (inside change()), we cache value shapes so that
      // mutations to found/filtered items persist back to the CRDT via absorbPlainValues()
      if (!this.getBatchedMutation()) {
        return containerItem as MutableItem
      }

      // In batched mode (within change()), we need to cache value shapes
      // so that mutations to found/filtered items persist back to the CRDT
      // via absorbPlainValues() at the end of change()
      let cachedItem = this.itemCache.get(index)
      if (cachedItem) {
        return cachedItem
      }

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
      this.itemCache.set(index, cachedItem)
      return cachedItem as MutableItem
    }

    // Container shapes: safe to cache (handles)
    let cachedItem = this.itemCache.get(index)
    if (!cachedItem) {
      cachedItem = createContainerTypedRef(
        this.getChildTypedRefParams(index, shape.shape as ContainerShape),
      )
      this.itemCache.set(index, cachedItem)
    }

    return cachedItem as MutableItem
  }

  /** Insert with automatic conversion */
  insertWithConversion(index: number, item: unknown): void {
    const shape = this.getShape()
    const container = this.getContainer() as LoroList | LoroMovableList
    const convertedItem = convertInputToRef(item as any, shape.shape)
    if (isContainer(convertedItem)) {
      container.insertContainer(index, convertedItem)
    } else {
      container.insert(index, convertedItem)
    }
  }

  /** Push with automatic conversion */
  pushWithConversion(item: unknown): void {
    const shape = this.getShape()
    const container = this.getContainer() as LoroList | LoroMovableList
    const convertedItem = convertInputToRef(item as any, shape.shape)
    if (isContainer(convertedItem)) {
      container.pushContainer(convertedItem)
    } else {
      container.push(convertedItem)
    }
  }

  /** Absorb value at specific index (for value shapes) - subclasses override */
  absorbValueAtIndex(_index: number, _value: unknown): void {
    throw new Error("absorbValueAtIndex must be implemented by subclass")
  }

  /** Update cache indices after a delete operation */
  updateCacheForDelete(deleteIndex: number, deleteLen: number): void {
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

  /** Update cache indices after an insert operation */
  updateCacheForInsert(insertIndex: number): void {
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

  /** Absorb mutated plain values back into Loro containers */
  absorbPlainValues(): void {
    // Critical function: absorb mutated plain values back into Loro containers
    // This is called at the end of change() to persist mutations made to plain objects
    const shape = this.getShape()
    for (const [index, cachedItem] of this.itemCache.entries()) {
      if (cachedItem) {
        if (isValueShape(shape.shape)) {
          // For value shapes, delegate to subclass-specific absorption logic
          this.absorbValueAtIndex(index, cachedItem)
        } else {
          // For container shapes, the item should be a typed ref that handles its own absorption
          if (
            cachedItem &&
            typeof cachedItem === "object" &&
            INTERNAL_SYMBOL in cachedItem
          ) {
            ;(cachedItem as any)[INTERNAL_SYMBOL].absorbPlainValues()
          }
        }
      }
    }

    // Clear the cache after absorbing values
    this.itemCache.clear()
  }

  /** Create the loro namespace for list */
  protected override createLoroNamespace(): LoroListRef {
    const self = this
    return {
      get doc(): LoroDoc {
        return self.getDoc()
      },
      get container(): LoroList | LoroMovableList {
        return self.getContainer() as LoroList | LoroMovableList
      },
      subscribe(callback: (event: unknown) => void): Subscription {
        return (self.getContainer() as LoroList | LoroMovableList).subscribe(
          callback,
        )
      },
      pushContainer(container: Container): Container {
        const result = (
          self.getContainer() as LoroList | LoroMovableList
        ).pushContainer(container)
        self.commitIfAuto()
        return result
      },
      insertContainer(index: number, container: Container): Container {
        const result = (
          self.getContainer() as LoroList | LoroMovableList
        ).insertContainer(index, container)
        self.commitIfAuto()
        return result
      },
    }
  }
}

// ============================================================================
// ListRefBase - Public facade class
// ============================================================================

/**
 * Shared logic for list operations - thin facade that delegates to ListRefBaseInternals.
 */
export abstract class ListRefBase<
  NestedShape extends ContainerOrValueShape,
  Item = NestedShape["_plain"],
  MutableItem = NestedShape["_mutable"],
> extends TypedRef<any> {
  [INTERNAL_SYMBOL]: ListRefBaseInternals<NestedShape, Item, MutableItem>

  constructor(params: TypedRefParams<any>) {
    super()
    this[INTERNAL_SYMBOL] = this.createInternals(params)
  }

  /** Subclasses override to create their specific internals */
  protected abstract createInternals(
    params: TypedRefParams<any>,
  ): ListRefBaseInternals<NestedShape, Item, MutableItem>

  // Array-like methods for better developer experience
  // DUAL INTERFACE: Predicates get Item (plain data), return values are MutableItem (mutable)

  find(
    predicate: (item: Item, index: number) => boolean,
  ): MutableItem | undefined {
    for (let i = 0; i < this.length; i++) {
      const predicateItem = this[INTERNAL_SYMBOL].getPredicateItem(i)
      if (predicate(predicateItem as Item, i)) {
        return this[INTERNAL_SYMBOL].getMutableItem(i) as MutableItem // Return mutable item
      }
    }
    return undefined
  }

  findIndex(predicate: (item: Item, index: number) => boolean): number {
    for (let i = 0; i < this.length; i++) {
      const predicateItem = this[INTERNAL_SYMBOL].getPredicateItem(i)
      if (predicate(predicateItem as Item, i)) {
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
      const predicateItem = this[INTERNAL_SYMBOL].getPredicateItem(i)
      result.push(callback(predicateItem as Item, i))
    }
    return result
  }

  filter(predicate: (item: Item, index: number) => boolean): MutableItem[] {
    const result: MutableItem[] = []
    for (let i = 0; i < this.length; i++) {
      const predicateItem = this[INTERNAL_SYMBOL].getPredicateItem(i)
      if (predicate(predicateItem as Item, i)) {
        result.push(this[INTERNAL_SYMBOL].getMutableItem(i) as MutableItem) // Return mutable items
      }
    }
    return result
  }

  forEach(callback: (item: Item, index: number) => void): void {
    for (let i = 0; i < this.length; i++) {
      const predicateItem = this[INTERNAL_SYMBOL].getPredicateItem(i)
      callback(predicateItem as Item, i)
    }
  }

  some(predicate: (item: Item, index: number) => boolean): boolean {
    for (let i = 0; i < this.length; i++) {
      const predicateItem = this[INTERNAL_SYMBOL].getPredicateItem(i)
      if (predicate(predicateItem as Item, i)) {
        return true
      }
    }
    return false
  }

  every(predicate: (item: Item, index: number) => boolean): boolean {
    for (let i = 0; i < this.length; i++) {
      const predicateItem = this[INTERNAL_SYMBOL].getPredicateItem(i)
      if (!predicate(predicateItem as Item, i)) {
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
      result.push(this[INTERNAL_SYMBOL].getMutableItem(i) as MutableItem)
    }
    return result
  }

  insert(index: number, item: Item): void {
    // Update cache indices before performing the insert operation
    this[INTERNAL_SYMBOL].updateCacheForInsert(index)
    this[INTERNAL_SYMBOL].insertWithConversion(index, item)
    this[INTERNAL_SYMBOL].commitIfAuto()
  }

  delete(index: number, len: number): void {
    // Update cache indices before performing the delete operation
    this[INTERNAL_SYMBOL].updateCacheForDelete(index, len)
    const container = this[INTERNAL_SYMBOL].getContainer() as
      | LoroList
      | LoroMovableList
    container.delete(index, len)
    this[INTERNAL_SYMBOL].commitIfAuto()
  }

  push(item: Item): void {
    this[INTERNAL_SYMBOL].pushWithConversion(item)
    this[INTERNAL_SYMBOL].commitIfAuto()
  }

  pushContainer(container: Container): Container {
    const loroContainer = this[INTERNAL_SYMBOL].getContainer() as
      | LoroList
      | LoroMovableList
    const result = loroContainer.pushContainer(container)
    this[INTERNAL_SYMBOL].commitIfAuto()
    return result
  }

  insertContainer(index: number, container: Container): Container {
    const loroContainer = this[INTERNAL_SYMBOL].getContainer() as
      | LoroList
      | LoroMovableList
    const result = loroContainer.insertContainer(index, container)
    this[INTERNAL_SYMBOL].commitIfAuto()
    return result
  }

  get(index: number): MutableItem | undefined {
    return this[INTERNAL_SYMBOL].getMutableItem(index) as
      | MutableItem
      | undefined
  }

  toArray(): Item[] {
    const result: Item[] = []
    for (let i = 0; i < this.length; i++) {
      result.push(this[INTERNAL_SYMBOL].getPredicateItem(i) as Item)
    }
    return result
  }

  toJSON(): Item[] {
    const shape = this[INTERNAL_SYMBOL].getShape()
    const container = this[INTERNAL_SYMBOL].getContainer() as
      | LoroList
      | LoroMovableList
    const nativeJson = container.toJSON() as any[]

    // If the nested shape is a container shape (map, record, etc.) or an object value shape,
    // we need to overlay placeholders for each item
    if (
      isContainerShape(shape.shape) ||
      (isValueShape(shape.shape) && shape.shape.valueType === "struct")
    ) {
      const itemPlaceholder = deriveShapePlaceholder(shape.shape)
      return nativeJson.map(item =>
        mergeValue(shape.shape, item, itemPlaceholder as any),
      ) as Item[]
    }

    // For primitive value shapes, no overlay needed
    return nativeJson ?? []
  }

  [Symbol.iterator](): IterableIterator<MutableItem> {
    let index = 0
    return {
      next: (): IteratorResult<MutableItem> => {
        if (index < this.length) {
          return {
            value: this[INTERNAL_SYMBOL].getMutableItem(index++) as MutableItem,
            done: false,
          }
        }
        return { value: undefined, done: true }
      },
      [Symbol.iterator]() {
        return this
      },
    }
  }

  get length(): number {
    const container = this[INTERNAL_SYMBOL].getContainer() as
      | LoroList
      | LoroMovableList
    return container.length
  }
}
