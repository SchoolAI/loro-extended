import type { Container, LoroDoc, LoroList, LoroMovableList } from "loro-crdt"
import { convertInputToRef } from "../conversion.js"
import type { ExtListRef } from "../ext.js"
import type { ContainerOrValueShape, ContainerShape } from "../shape.js"
import { isContainer, isValueShape } from "../utils/type-guards.js"
import {
  BaseRefInternals,
  INTERNAL_SYMBOL,
  type TypedRefParams,
} from "./base.js"
import { createContainerTypedRef } from "./utils.js"

/**
 * Internal implementation for ListRefBase.
 * Contains all logic, state, and implementation details for list operations.
 */
export class ListRefBaseInternals<
  NestedShape extends ContainerOrValueShape,
  Item = NestedShape["_plain"],
  MutableItem = NestedShape["_mutable"],
> extends BaseRefInternals<any> {
  protected itemCache = new Map<number, any>()

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

  /** Create the ext namespace for list */
  protected override createExtNamespace(): ExtListRef {
    const self = this
    return {
      get doc(): LoroDoc {
        return self.getDoc()
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
