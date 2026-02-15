import type { Container, LoroDoc, LoroMap, MapDiff, Value } from "loro-crdt"
import { deriveShapePlaceholder } from "../derive-placeholder.js"
import type { ExtMapRef } from "../ext.js"
import type {
  ContainerOrValueShape,
  ContainerShape,
  RecordContainerShape,
} from "../shape.js"
import { isContainerShape, isValueShape } from "../utils/type-guards.js"
import { BaseRefInternals, type TypedRef, type TypedRefParams } from "./base.js"
import {
  absorbCachedPlainValues,
  assignPlainValueToTypedRef,
  containerConstructor,
  createContainerTypedRef,
  hasContainerConstructor,
} from "./utils.js"

/**
 * Internal implementation for RecordRef.
 * Contains all logic, state, and implementation details.
 */
export class RecordRefInternals<
  NestedShape extends ContainerOrValueShape,
> extends BaseRefInternals<any> {
  private refCache = new Map<string, TypedRef<ContainerShape> | Value>()

  /** Get typed ref params for creating child refs at a key */
  getChildTypedRefParams(
    key: string,
    shape: ContainerShape,
  ): TypedRefParams<ContainerShape> {
    // First try to get placeholder from the Record's placeholder (if it has an entry for this key)
    let placeholder = (this.getPlaceholder() as any)?.[key]

    // If no placeholder exists for this key, derive one from the schema's shape
    // This is critical for Records where the placeholder is always {} but nested
    // containers need valid placeholders to fall back to for missing values
    if (placeholder === undefined) {
      placeholder = deriveShapePlaceholder(shape)
    }

    // AnyContainerShape is an escape hatch - it doesn't have a constructor
    if (!hasContainerConstructor(shape._type)) {
      throw new Error(
        `Cannot create typed ref for shape type "${shape._type}". ` +
          `Use Shape.any() only at the document root level.`,
      )
    }

    // For mergeable documents, use flattened root containers
    // Record keys may contain hyphens, which are properly escaped by computeChildRootContainerName
    if (this.isMergeable()) {
      const doc = this.getDoc()
      const rootName = this.computeChildRootContainerName(key)
      const pathPrefix = this.getPathPrefix() || []
      const newPathPrefix = [...pathPrefix, key]

      // Set null marker in parent map to indicate child container reference
      const container = this.getContainer() as LoroMap
      if (container.get(key) !== null) {
        container.set(key, null)
      }

      // Use the appropriate root container getter based on shape type
      const containerGetter = {
        counter: "getCounter",
        list: "getList",
        movableList: "getMovableList",
        record: "getMap",
        struct: "getMap",
        text: "getText",
        tree: "getTree",
      } as const

      const getterName =
        containerGetter[shape._type as keyof typeof containerGetter]
      const getter = (doc as any)[getterName].bind(doc)

      return {
        shape,
        placeholder,
        getContainer: () => getter(rootName),
        autoCommit: this.getAutoCommit(),
        batchedMutation: this.getBatchedMutation(),
        getDoc: () => doc,
        overlay: this.getOverlay(),
        pathPrefix: newPathPrefix,
        mergeable: true,
      }
    }

    // Non-mergeable: use standard nested container storage
    const LoroContainer = containerConstructor[shape._type]
    const container = this.getContainer() as LoroMap

    return {
      shape,
      placeholder,
      getContainer: () =>
        container.getOrCreateContainer(key, new (LoroContainer as any)()),
      autoCommit: this.getAutoCommit(),
      batchedMutation: this.getBatchedMutation(),
      getDoc: () => this.getDoc(),
      overlay: this.getOverlay(),
    }
  }

  /** Get a ref for a key without creating (returns undefined for non-existent container keys) */
  getRef(key: string): unknown {
    const recordShape = this.getShape() as RecordContainerShape<NestedShape>
    const shape = recordShape.shape
    const container = this.getContainer() as LoroMap

    // For container shapes, check if the key exists first
    // This allows optional chaining (?.) to work correctly for non-existent keys
    if (isContainerShape(shape)) {
      const existing = container.get(key)
      // For mergeable containers, null is a marker indicating a child container exists
      // For non-mergeable, undefined means the key doesn't exist
      if (existing === undefined) {
        return undefined
      }
      // For mergeable containers, null is valid (it's a marker)
      // For non-mergeable, null would be an actual null value stored
    }

    return this.getOrCreateRef(key)
  }

  /** Get or create a ref for a key (always creates for container shapes) */
  getOrCreateRef(key: string): unknown {
    const recordShape = this.getShape() as RecordContainerShape<NestedShape>
    const shape = recordShape.shape
    const container = this.getContainer() as LoroMap

    if (isValueShape(shape)) {
      const overlay = this.getOverlay()
      if (overlay) {
        const containerId = (container as any).id
        const diff = overlay.get(containerId)
        if (diff && diff.type === "map") {
          const mapDiff = diff as MapDiff
          if (key in mapDiff.updated) {
            return mapDiff.updated[key] as Value
          }
        }
      }
      // When NOT in batchedMutation mode (direct access outside of change()), ALWAYS read fresh
      // from container (NEVER cache). This ensures we always get the latest value
      // from the CRDT, even when modified by a different ref instance (e.g., drafts from change())
      //
      // When in batchedMutation mode (inside change()), we cache value shapes so that
      // mutations to nested objects persist back to the CRDT via absorbPlainValues()
      if (!this.getBatchedMutation()) {
        const containerValue = container.get(key)
        if (containerValue !== undefined) {
          return containerValue
        }
        // Fall back to placeholder if the container doesn't have the value
        const placeholder = (this.getPlaceholder() as any)?.[key]
        if (placeholder !== undefined) {
          return placeholder
        }
        // Fall back to the default value from the shape
        return (shape as any)._plain
      }

      // In batched mode (within change()), we cache value shapes so that
      // mutations to nested objects persist back to the CRDT via absorbPlainValues()
      let ref = this.refCache.get(key)
      if (!ref) {
        const containerValue = container.get(key)
        if (containerValue !== undefined) {
          // For objects, create a deep copy so mutations can be tracked
          if (typeof containerValue === "object" && containerValue !== null) {
            ref = JSON.parse(JSON.stringify(containerValue))
          } else {
            ref = containerValue as Value
          }
        } else {
          // Fall back to placeholder if the container doesn't have the value
          const placeholder = (this.getPlaceholder() as any)?.[key]
          if (placeholder !== undefined) {
            ref = placeholder as Value
          } else {
            // Fall back to the default value from the shape
            ref = (shape as any)._plain
          }
        }
        this.refCache.set(key, ref)
      }
      return ref
    }

    // For container shapes, we can safely cache the ref since it's a handle
    // to the underlying Loro container, not a value copy.
    let ref = this.refCache.get(key)
    if (!ref) {
      ref = createContainerTypedRef(
        this.getChildTypedRefParams(key, shape as ContainerShape),
      )
      this.refCache.set(key, ref)
    }

    return ref as any
  }

  /** Set a value at a key */
  set(key: string, value: any): void {
    const recordShape = this.getShape() as RecordContainerShape<NestedShape>
    const shape = recordShape.shape
    const container = this.getContainer() as LoroMap

    if (isValueShape(shape)) {
      container.set(key, value)
      this.refCache.set(key, value)
      this.commitIfAuto()
    } else {
      // For container shapes, try to assign the plain value
      // Use getOrCreateRef to ensure the container is created
      // assignPlainValueToTypedRef handles batching and commits internally
      const ref = this.getOrCreateRef(key)
      if (assignPlainValueToTypedRef(ref as TypedRef<any>, value)) {
        // Don't call commitIfAuto here - assignPlainValueToTypedRef handles it
        return
      }
      throw new Error(
        "Cannot set container directly, modify the typed ref instead",
      )
    }
  }

  /** Delete a key */
  delete(key: string): void {
    const container = this.getContainer() as LoroMap
    container.delete(key)
    this.refCache.delete(key)
    this.commitIfAuto()
  }

  /**
   * Replace entire contents with new values.
   * Keys not in `values` are removed.
   */
  replace(values: Record<string, any>): void {
    const container = this.getContainer() as LoroMap
    const currentKeys = new Set(container.keys())
    const newKeys = new Set(Object.keys(values))

    // Suppress auto-commit during batch operations
    const wasSuppressed = this.isSuppressAutoCommit()
    if (!wasSuppressed) {
      this.setSuppressAutoCommit(true)
    }

    try {
      // Delete keys that are not in the new values
      for (const key of currentKeys) {
        if (!newKeys.has(key)) {
          container.delete(key)
          this.refCache.delete(key)
        }
      }

      // Set new/updated values
      for (const key of newKeys) {
        this.set(key, values[key])
      }
    } finally {
      // Restore auto-commit state
      if (!wasSuppressed) {
        this.setSuppressAutoCommit(false)
      }
    }

    // Commit once after all operations
    this.commitIfAuto()
  }

  /**
   * Merge values into record.
   * Existing keys not in `values` are kept.
   */
  merge(values: Record<string, any>): void {
    // Suppress auto-commit during batch operations
    const wasSuppressed = this.isSuppressAutoCommit()
    if (!wasSuppressed) {
      this.setSuppressAutoCommit(true)
    }

    try {
      // Set new/updated values (no deletions)
      for (const key of Object.keys(values)) {
        this.set(key, values[key])
      }
    } finally {
      // Restore auto-commit state
      if (!wasSuppressed) {
        this.setSuppressAutoCommit(false)
      }
    }

    // Commit once after all operations
    this.commitIfAuto()
  }

  /**
   * Remove all entries from the record.
   */
  clear(): void {
    const container = this.getContainer() as LoroMap
    const keys = container.keys()

    if (keys.length === 0) {
      return // No-op on empty record
    }

    // Suppress auto-commit during batch operations
    const wasSuppressed = this.isSuppressAutoCommit()
    if (!wasSuppressed) {
      this.setSuppressAutoCommit(true)
    }

    try {
      // Delete all keys
      for (const key of keys) {
        container.delete(key)
        this.refCache.delete(key)
      }
    } finally {
      // Restore auto-commit state
      if (!wasSuppressed) {
        this.setSuppressAutoCommit(false)
      }
    }

    // Commit once after all operations
    this.commitIfAuto()
  }

  /** Absorb mutated plain values back into Loro containers */
  absorbPlainValues(): void {
    absorbCachedPlainValues(this.refCache, () => this.getContainer() as LoroMap)
  }

  /** Create the ext namespace for record */
  protected override createExtNamespace(): ExtMapRef {
    const self = this
    return {
      get doc(): LoroDoc {
        return self.getDoc()
      },
      setContainer(key: string, container: Container): Container {
        const result = (self.getContainer() as LoroMap).setContainer(
          key,
          container,
        )
        self.commitIfAuto()
        return result
      },
    }
  }
}
