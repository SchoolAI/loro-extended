import type { Container, LoroDoc, LoroMap } from "loro-crdt"
import type { ExtMapRef } from "../ext.js"
import type { PlainValueRef } from "../plain-value-ref/index.js"
import type {
  ContainerOrValueShape,
  ContainerShape,
  StructContainerShape,
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
 * Internal implementation for StructRef.
 * Contains all logic, state, and implementation details.
 */
export class StructRefInternals<
  NestedShapes extends Record<string, ContainerOrValueShape>,
> extends BaseRefInternals<any> {
  // Cache only container refs - value shapes now return PlainValueRef (no caching needed)
  private propertyCache = new Map<string, TypedRef<ContainerShape>>()

  /** Get typed ref params for creating child refs at a key */
  getChildTypedRefParams(
    key: string,
    shape: ContainerShape,
  ): TypedRefParams<ContainerShape> {
    const placeholder = (this.getPlaceholder() as any)?.[key]
    return buildChildTypedRefParams(this, key, shape, placeholder)
  }

  /** Get or create a ref for a key */
  getOrCreateRef<Shape extends ContainerShape | ValueShape>(
    key: string,
    shape?: Shape,
  ): unknown {
    const structShape = this.getShape() as StructContainerShape<NestedShapes>
    const actualShape = shape || structShape.shapes[key]

    if (isValueShape(actualShape)) {
      if (this.getBatchedMutation()) {
        // Inside change() — use runtime typeof check to decide:
        // - Primitive values (string, number, boolean, null): return raw value
        //   for ergonomic boolean logic (`if (draft.active)`, `!draft.published`)
        // - Object/array values: return PlainValueRef for nested mutation tracking
        //   (`item.metadata.author = "Alice"`)
        //
        // This replaces the old schema-based valueType heuristic which was
        // semantically wrong for union and any shapes that can contain either
        // primitives or objects at runtime.
        return resolveValueForBatchedMutation(this, key, actualShape)
      }
      // Outside change() — return PlainValueRef for reactive subscriptions
      return createPlainValueRefForProperty(
        this,
        key,
        actualShape as ValueShape,
      )
    }

    // Container shapes: safe to cache (handles)
    let ref = this.propertyCache.get(key)
    if (!ref) {
      ref = createContainerTypedRef(
        this.getChildTypedRefParams(key, actualShape as ContainerShape),
      )
      this.propertyCache.set(key, ref)
    }

    return ref as Shape extends ContainerShape
      ? TypedRef<Shape>
      : PlainValueRef<any>
  }

  /** Set a property value */
  setPropertyValue(key: string, value: unknown): void {
    const structShape = this.getShape() as StructContainerShape<NestedShapes>
    const shape = structShape.shapes[key]
    const container = this.getContainer() as LoroMap

    if (!shape) {
      throw new Error(`Unknown property: ${key}`)
    }

    if (isValueShape(shape)) {
      // Unwrap PlainValueRef if the value is one (supports ref = otherRef assignment)
      const unwrapped = unwrapPlainValueRef(value)
      container.set(key, unwrapped)
      this.commitIfAuto()
    } else {
      // For container shapes, try to assign the plain value
      // assignPlainValueToTypedRef handles batching and commits internally
      const ref = this.getOrCreateRef(key, shape)
      if (assignPlainValueToTypedRef(ref as TypedRef<any>, value)) {
        // Don't call commitIfAuto here - assignPlainValueToTypedRef handles it
        return
      }
      throw new Error(
        "Cannot set container directly, modify the typed ref instead",
      )
    }
  }

  /** Delete a property */
  deleteProperty(key: string): void {
    const container = this.getContainer() as LoroMap
    container.delete(key)
    this.propertyCache.delete(key)
    this.commitIfAuto()
  }

  /** Recursively finalize nested container refs */
  override finalizeTransaction(): void {
    for (const ref of this.propertyCache.values()) {
      ref[INTERNAL_SYMBOL].finalizeTransaction?.()
    }
  }

  /** Force materialization of the container and its nested containers */
  override materialize(): void {
    // Ensure this container exists
    this.getContainer()

    // Recursively materialize nested containers
    const structShape = this.getShape() as StructContainerShape<NestedShapes>
    for (const key in structShape.shapes) {
      const shape = structShape.shapes[key]
      if (!isValueShape(shape)) {
        // Get the ref (which creates it if needed)
        const ref = this.getOrCreateRef(key, shape) as TypedRef<any>
        // Force materialization
        ref[INTERNAL_SYMBOL].materialize()
      }
    }
  }

  /** Create the ext namespace for struct */
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
