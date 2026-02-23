import type { LoroMap } from "loro-crdt"
import { deriveShapePlaceholder } from "../derive-placeholder.js"
import type { ContainerOrValueShape, RecordContainerShape } from "../shape.js"
import { MapBasedRefInternals } from "./map-based-ref-internals.js"

/**
 * Internal implementation for RecordRef.
 * Extends MapBasedRefInternals with record-specific behavior.
 *
 * Key differences from StructRefInternals:
 * - getNestedShape: returns recordShape.shape (same shape for all keys)
 * - getChildPlaceholder: uses derive fallback when placeholder[key] is undefined
 * - getRef: checks existence before creating (supports optional chaining)
 * - Provides replace(), merge(), clear() batch operations
 */
export class RecordRefInternals<
  NestedShape extends ContainerOrValueShape,
> extends MapBasedRefInternals {
  /**
   * Get the record shape cast to the correct type.
   */
  private get recordShape(): RecordContainerShape<NestedShape> {
    return this.getShape() as RecordContainerShape<NestedShape>
  }

  /**
   * Get the nested shape for a given key.
   * For records, all keys share the same shape (recordShape.shape).
   */
  override getNestedShape(_key: string): ContainerOrValueShape | undefined {
    return this.recordShape.shape
  }

  /**
   * Get the placeholder value for a child ref at a given key.
   * For records, falls back to deriveShapePlaceholder when the key is not in the placeholder.
   * This is critical because record placeholders are always {} but nested containers
   * need valid placeholders to fall back to for missing values.
   */
  override getChildPlaceholder(key: string): unknown {
    // First try to get placeholder from the Record's placeholder (if it has an entry for this key)
    let placeholder = (
      this.getPlaceholder() as Record<string, unknown> | undefined
    )?.[key]

    // If no placeholder exists for this key, derive one from the schema's shape
    if (placeholder === undefined && this.recordShape.shape) {
      placeholder = deriveShapePlaceholder(this.recordShape.shape)
    }

    return placeholder
  }

  /**
   * Get a ref for a key without creating (returns undefined for non-existent keys).
   * This allows optional chaining (?.) to work for non-existent record entries.
   */
  getRef(key: string): unknown {
    const container = this.getContainer() as LoroMap

    // Check if the key exists before creating refs.
    // For container shapes: allows optional chaining (?.) to work for non-existent keys.
    //   Mergeable containers use null as a marker (so null is valid).
    // For value shapes: prevents returning a PlainValueRef for a key that doesn't exist,
    //   so that `record.get("missing")` returns undefined rather than a PlainValueRef.
    const existing = container.get(key)
    if (existing === undefined) {
      return undefined
    }

    return this.getOrCreateRef(key)
  }

  /**
   * Set a value at a key.
   * Delegates to the shared setValueAtKey method with the record's shape.
   */
  set(key: string, value: unknown): void {
    const shape = this.recordShape.shape

    if (!shape) {
      throw new Error("Record shape is undefined")
    }

    this.setValueAtKey(key, value, shape)
  }

  /**
   * Delete a key from the record.
   * Delegates to the shared deleteKey method.
   */
  delete(key: string): void {
    this.deleteKey(key)
  }

  /**
   * Replace entire contents with new values.
   * Keys not in `values` are removed.
   */
  replace(values: Record<string, unknown>): void {
    const container = this.getContainer() as LoroMap
    const currentKeys = new Set(container.keys())
    const newKeys = new Set(Object.keys(values))

    this.withBatchedCommit(() => {
      // Delete keys that are not in the new values
      for (const key of currentKeys) {
        if (!newKeys.has(key)) {
          this.deleteKey(key)
        }
      }

      // Set new/updated values
      for (const key of newKeys) {
        this.set(key, values[key])
      }
    })
  }

  /**
   * Merge values into record.
   * Existing keys not in `values` are kept.
   */
  merge(values: Record<string, unknown>): void {
    this.withBatchedCommit(() => {
      for (const key of Object.keys(values)) {
        this.set(key, values[key])
      }
    })
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

    this.withBatchedCommit(() => {
      for (const key of keys) {
        this.deleteKey(key)
      }
    })
  }

  /**
   * Force materialization of the container.
   * For records, we only materialize the record itself, not its dynamic entries.
   * Unlike structs, records don't have a fixed set of keys to materialize.
   */
  override materialize(): void {
    // Ensure this container exists
    this.getContainer()

    // Records don't pre-materialize entries - they are created on demand via set()
    // This is different from structs which have a fixed schema of nested containers
  }
}
