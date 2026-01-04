import type {
  Container,
  LoroDoc,
  LoroMap,
  Subscription,
  Value,
} from "loro-crdt"
import type { LoroMapRef } from "../loro.js"
import type {
  ContainerOrValueShape,
  ContainerShape,
  StructContainerShape,
  ValueShape,
} from "../shape.js"
import { isValueShape } from "../utils/type-guards.js"
import { BaseRefInternals, type TypedRef, type TypedRefParams } from "./base.js"
import {
  absorbCachedPlainValues,
  assignPlainValueToTypedRef,
  containerConstructor,
  createContainerTypedRef,
  hasContainerConstructor,
} from "./utils.js"

/**
 * Internal implementation for StructRef.
 * Contains all logic, state, and implementation details.
 */
export class StructRefInternals<
  NestedShapes extends Record<string, ContainerOrValueShape>,
> extends BaseRefInternals<any> {
  private propertyCache = new Map<string, TypedRef<ContainerShape> | Value>()

  /** Get typed ref params for creating child refs at a key */
  getTypedRefParams(
    key: string,
    shape: ContainerShape,
  ): TypedRefParams<ContainerShape> {
    const placeholder = (this.getPlaceholder() as any)?.[key]

    // AnyContainerShape is an escape hatch - it doesn't have a constructor
    if (!hasContainerConstructor(shape._type)) {
      throw new Error(
        `Cannot create typed ref for shape type "${shape._type}". ` +
          `Use Shape.any() only at the document root level.`,
      )
    }

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
    }
  }

  /** Get or create a ref for a key */
  getOrCreateRef<Shape extends ContainerShape | ValueShape>(
    key: string,
    shape?: Shape,
  ): unknown {
    const structShape = this.getShape() as StructContainerShape<NestedShapes>
    const actualShape = shape || structShape.shapes[key]
    const container = this.getContainer() as LoroMap

    if (isValueShape(actualShape)) {
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
        // Only fall back to placeholder if the container doesn't have the value
        const placeholder = (this.getPlaceholder() as any)?.[key]
        if (placeholder === undefined) {
          throw new Error("placeholder required")
        }
        return placeholder
      }

      // In batched mode (within change()), we cache value shapes so that
      // mutations to nested objects persist back to the CRDT via absorbPlainValues()
      let ref = this.propertyCache.get(key)
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
          // Only fall back to placeholder if the container doesn't have the value
          const placeholder = (this.getPlaceholder() as any)?.[key]
          if (placeholder === undefined) {
            throw new Error("placeholder required")
          }
          ref = placeholder as Value
        }
        this.propertyCache.set(key, ref)
      }
      return ref
    }

    // Container shapes: safe to cache (handles)
    let ref = this.propertyCache.get(key)
    if (!ref) {
      ref = createContainerTypedRef(
        this.getTypedRefParams(key, actualShape as ContainerShape),
      )
      this.propertyCache.set(key, ref)
    }

    return ref as Shape extends ContainerShape ? TypedRef<Shape> : Value
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
      container.set(key, value)
      this.propertyCache.set(key, value as Value)
      this.commitIfAuto()
    } else {
      // For container shapes, try to assign the plain value
      const ref = this.getOrCreateRef(key, shape)
      if (assignPlainValueToTypedRef(ref as TypedRef<any>, value)) {
        this.commitIfAuto()
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

  /** Absorb mutated plain values back into Loro containers */
  absorbPlainValues(): void {
    absorbCachedPlainValues(
      this.propertyCache,
      () => this.getContainer() as LoroMap,
    )
  }

  /** Create the loro namespace for struct */
  protected override createLoroNamespace(): LoroMapRef {
    const self = this
    return {
      get doc(): LoroDoc {
        return self.getDoc()
      },
      get container(): LoroMap {
        return self.getContainer() as LoroMap
      },
      subscribe(callback: (event: unknown) => void): Subscription {
        return (self.getContainer() as LoroMap).subscribe(callback)
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
