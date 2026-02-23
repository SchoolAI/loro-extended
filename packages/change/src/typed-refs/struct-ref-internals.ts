import type {
  ContainerOrValueShape,
  ContainerShape,
  StructContainerShape,
} from "../shape.js"
import { isValueShape } from "../utils/type-guards.js"
import { INTERNAL_SYMBOL, type TypedRef } from "./base.js"
import { MapBasedRefInternals } from "./map-based-ref-internals.js"

/**
 * Internal implementation for StructRef.
 * Extends MapBasedRefInternals with struct-specific behavior.
 *
 * Key differences from RecordRefInternals:
 * - getNestedShape: looks up shape from structShape.shapes[key] (static, per-key)
 * - getChildPlaceholder: direct lookup from parent placeholder (no derive fallback)
 * - materialize: recursively materializes all nested containers defined in schema
 */
export class StructRefInternals<
  NestedShapes extends Record<string, ContainerOrValueShape>,
> extends MapBasedRefInternals {
  /**
   * Get the struct shape cast to the correct type.
   */
  private get structShape(): StructContainerShape<NestedShapes> {
    return this.getShape() as StructContainerShape<NestedShapes>
  }

  /**
   * Get the nested shape for a given key.
   * For structs, each key has its own shape defined in structShape.shapes.
   */
  override getNestedShape(key: string): ContainerOrValueShape | undefined {
    return this.structShape.shapes[key]
  }

  /**
   * Get the placeholder value for a child ref at a given key.
   * For structs, this is a direct lookup from the parent placeholder.
   */
  override getChildPlaceholder(key: string): unknown {
    return (this.getPlaceholder() as Record<string, unknown> | undefined)?.[key]
  }

  /**
   * Set a property value.
   * Delegates to the shared setValueAtKey method with the property's shape.
   */
  setPropertyValue(key: string, value: unknown): void {
    const shape = this.structShape.shapes[key]

    if (!shape) {
      throw new Error(`Unknown property: ${key}`)
    }

    this.setValueAtKey(key, value, shape)
  }

  /**
   * Delete a property.
   * Delegates to the shared deleteKey method.
   */
  deleteProperty(key: string): void {
    this.deleteKey(key)
  }

  /**
   * Force materialization of the container and its nested containers.
   * This ensures deterministic container IDs across peers by creating
   * all nested containers defined in the schema eagerly.
   */
  override materialize(): void {
    // Ensure this container exists
    this.getContainer()

    // Recursively materialize nested containers
    for (const key in this.structShape.shapes) {
      const shape = this.structShape.shapes[key]
      if (!isValueShape(shape)) {
        // Get the ref (which creates it if needed)
        const ref = this.getOrCreateRef(key, shape) as TypedRef<ContainerShape>
        // Force materialization
        ref[INTERNAL_SYMBOL].materialize()
      }
    }
  }
}
