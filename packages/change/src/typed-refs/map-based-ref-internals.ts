import type { Container, LoroDoc, LoroMap } from "loro-crdt"
import type { ExtMapRef } from "../ext.js"
import type { PlainValueRef } from "../plain-value-ref/index.js"
import type {
  ContainerOrValueShape,
  ContainerShape,
  ValueShape,
} from "../shape.js"
import { isValueShape } from "../utils/type-guards.js"
import {
  BaseRefInternals,
  INTERNAL_SYMBOL,
  type TypedRef,
  type TypedRefParams,
} from "./base.js"
import {
  createPlainValueRefForProperty,
  resolveValueForBatchedMutation,
  unwrapPlainValueRef,
} from "./plain-value-access.js"
import {
  assignPlainValueToTypedRef,
  buildChildTypedRefParams,
  createContainerTypedRef,
} from "./utils.js"

/**
 * Abstract base class for map-backed ref internals (structs and records).
 *
 * This class extracts the shared logic between StructRefInternals and RecordRefInternals:
 * - Container ref caching
 * - getChildTypedRefParams delegation to buildChildTypedRefParams
 * - finalizeTransaction for nested ref cleanup
 * - createExtNamespace for ext() support
 *
 * Subclasses implement:
 * - getNestedShape(key): How to look up the shape for a given key
 * - getChildPlaceholder(key): How to derive the placeholder for a child ref
 *
 * Note: Uses `any` for Shape parameter to avoid complex type gymnastics.
 * The subclasses (StructRefInternals, RecordRefInternals) provide proper typing.
 */
export abstract class MapBasedRefInternals extends BaseRefInternals<any> {
  /**
   * Cache for container shape refs only.
   * Value shapes return PlainValueRef on each access (no caching needed).
   */
  protected refCache = new Map<string, TypedRef<ContainerShape>>()

  /**
   * Get the nested shape for a given key.
   *
   * For structs: returns `structShape.shapes[key]` (static, per-key shapes)
   * For records: returns `recordShape.shape` (same shape for all keys)
   */
  abstract getNestedShape(key: string): ContainerOrValueShape | undefined

  /**
   * Get the placeholder value for a child ref at a given key.
   *
   * For structs: returns `placeholder?.[key]` (direct lookup)
   * For records: returns `placeholder?.[key] ?? deriveShapePlaceholder(shape)` (with fallback)
   */
  abstract getChildPlaceholder(key: string): unknown

  /**
   * Get typed ref params for creating child refs at a key.
   * Delegates to the shared buildChildTypedRefParams helper in utils.ts.
   */
  getChildTypedRefParams(
    key: string,
    shape: ContainerShape,
  ): TypedRefParams<ContainerShape> {
    const placeholder = this.getChildPlaceholder(key)
    return buildChildTypedRefParams(this, key, shape, placeholder)
  }

  /**
   * Get or create a ref for a key.
   *
   * For value shapes:
   * - Inside change(): returns PlainValueRef for mutation tracking
   * - Outside change(): returns PlainValueRef for reactive subscriptions
   *
   * For container shapes:
   * - Returns cached TypedRef (creates on first access)
   */
  getOrCreateRef(key: string, shape?: ContainerOrValueShape): unknown {
    const actualShape = shape || this.getNestedShape(key)

    if (!actualShape) {
      return undefined
    }

    if (isValueShape(actualShape)) {
      if (this.getBatchedMutation()) {
        // Inside change() — return PlainValueRef for method-based mutation
        return resolveValueForBatchedMutation(
          this,
          key,
          actualShape as ValueShape,
        )
      }
      // Outside change() — return PlainValueRef for reactive subscriptions
      return createPlainValueRefForProperty(
        this,
        key,
        actualShape as ValueShape,
      )
    }

    // Container shapes: safe to cache (handles)
    let ref = this.refCache.get(key)
    if (!ref) {
      ref = createContainerTypedRef(
        this.getChildTypedRefParams(key, actualShape as ContainerShape),
      )
      this.refCache.set(key, ref)
    }

    return ref as TypedRef<ContainerShape> | PlainValueRef<unknown>
  }

  /**
   * Set a value at a key.
   *
   * For value shapes: writes directly to the LoroMap
   * For container shapes: uses assignPlainValueToTypedRef for recursive assignment
   */
  setValueAtKey(
    key: string,
    value: unknown,
    shape: ContainerOrValueShape,
  ): void {
    const container = this.getContainer() as LoroMap

    if (isValueShape(shape)) {
      // Unwrap PlainValueRef if the value is one (supports ref = otherRef assignment)
      const unwrapped = unwrapPlainValueRef(value)
      container.set(key, unwrapped)
      this.commitIfAuto()
    } else {
      // For container shapes, try to assign the plain value
      // assignPlainValueToTypedRef handles batching and commits internally
      const ref = this.getOrCreateRef(key, shape)
      if (assignPlainValueToTypedRef(ref as TypedRef<ContainerShape>, value)) {
        // Don't call commitIfAuto here - assignPlainValueToTypedRef handles it
        return
      }
      throw new Error(
        "Cannot set container directly, modify the typed ref instead",
      )
    }
  }

  /**
   * Delete a key from the map and remove it from the cache.
   */
  deleteKey(key: string): void {
    const container = this.getContainer() as LoroMap
    container.delete(key)
    this.refCache.delete(key)
    this.commitIfAuto()
  }

  /**
   * Recursively finalize nested container refs.
   * Called at the end of a change() block to clean up caches and prevent stale refs.
   */
  override finalizeTransaction(): void {
    for (const ref of this.refCache.values()) {
      if (ref && INTERNAL_SYMBOL in ref) {
        ref[INTERNAL_SYMBOL].finalizeTransaction?.()
      }
    }
  }

  /**
   * Create the ext namespace for map-backed refs.
   * Provides access to doc and setContainer for advanced use cases.
   */
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
