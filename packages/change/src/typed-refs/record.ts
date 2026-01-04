import type {
  Container,
  LoroDoc,
  LoroMap,
  Subscription,
  Value,
} from "loro-crdt"
import { deriveShapePlaceholder } from "../derive-placeholder.js"
import type { LoroMapRef } from "../loro.js"
import type {
  ContainerOrValueShape,
  ContainerShape,
  RecordContainerShape,
} from "../shape.js"
import type { Infer, InferMutableType } from "../types.js"
import { isContainerShape, isValueShape } from "../utils/type-guards.js"
import { TypedRef, type TypedRefParams } from "./base.js"
import {
  absorbCachedPlainValues,
  assignPlainValueToTypedRef,
  containerConstructor,
  createContainerTypedRef,
  hasContainerConstructor,
  serializeRefToJSON,
} from "./utils.js"

// Record typed ref
export class RecordRef<
  NestedShape extends ContainerOrValueShape,
> extends TypedRef<any> {
  [key: string]: InferMutableType<NestedShape> | undefined | any
  private refCache = new Map<string, TypedRef<ContainerShape> | Value>()

  protected get shape(): RecordContainerShape<NestedShape> {
    return super.shape as RecordContainerShape<NestedShape>
  }

  protected get container(): LoroMap {
    return super.container as LoroMap
  }

  /**
   * Override to add record-specific methods to the loro() namespace.
   */
  protected override createLoroNamespace(): LoroMapRef {
    const self = this
    return {
      get doc(): LoroDoc {
        return self._params.getDoc()
      },
      get container(): LoroMap {
        return self.container
      },
      subscribe(callback: (event: unknown) => void): Subscription {
        return self.container.subscribe(callback)
      },
      setContainer(key: string, container: Container): Container {
        const result = self.container.setContainer(key, container)
        self.commitIfAuto()
        return result
      },
    }
  }

  absorbPlainValues() {
    absorbCachedPlainValues(this.refCache, () => this.container)
  }

  getTypedRefParams<S extends ContainerShape>(
    key: string,
    shape: S,
  ): TypedRefParams<ContainerShape> {
    // First try to get placeholder from the Record's placeholder (if it has an entry for this key)
    let placeholder = (this.placeholder as any)?.[key]

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

    const LoroContainer = containerConstructor[shape._type]

    return {
      shape,
      placeholder,
      getContainer: () =>
        this.container.getOrCreateContainer(key, new (LoroContainer as any)()),
      autoCommit: this._params.autoCommit,
      batchedMutation: this.batchedMutation,
      getDoc: this._params.getDoc,
    }
  }

  /**
   * Gets an existing ref for a key, or returns undefined if the key doesn't exist.
   * Used for reading operations where we want optional chaining to work.
   */
  getRef(key: string): any {
    // For container shapes, check if the key exists first
    // This allows optional chaining (?.) to work correctly for non-existent keys
    if (isContainerShape(this.shape.shape)) {
      const existing = this.container.get(key)
      if (existing === undefined) {
        return undefined
      }
    }

    return this.getOrCreateRef(key)
  }

  /**
   * Gets or creates a ref for a key.
   * Always creates the container if it doesn't exist.
   * This is the method used for write operations.
   */
  getOrCreateRef(key: string): any {
    const shape = this.shape.shape

    if (isValueShape(shape)) {
      // When NOT in batchedMutation mode (direct access outside of change()), ALWAYS read fresh
      // from container (NEVER cache). This ensures we always get the latest value
      // from the CRDT, even when modified by a different ref instance (e.g., drafts from change())
      //
      // When in batchedMutation mode (inside change()), we cache value shapes so that
      // mutations to nested objects persist back to the CRDT via absorbPlainValues()
      if (!this.batchedMutation) {
        const containerValue = this.container.get(key)
        if (containerValue !== undefined) {
          return containerValue
        }
        // Fall back to placeholder if the container doesn't have the value
        const placeholder = (this.placeholder as any)?.[key]
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
        const containerValue = this.container.get(key)
        if (containerValue !== undefined) {
          // For objects, create a deep copy so mutations can be tracked
          if (typeof containerValue === "object" && containerValue !== null) {
            ref = JSON.parse(JSON.stringify(containerValue))
          } else {
            ref = containerValue as Value
          }
        } else {
          // Fall back to placeholder if the container doesn't have the value
          const placeholder = (this.placeholder as any)?.[key]
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
        this.getTypedRefParams(key, shape as ContainerShape),
      )
      this.refCache.set(key, ref)
    }

    return ref as any
  }

  get(key: string): InferMutableType<NestedShape> | undefined {
    return this.getRef(key)
  }

  set(key: string, value: any): void {
    if (isValueShape(this.shape.shape)) {
      this.container.set(key, value)
      this.refCache.set(key, value)
      this.commitIfAuto()
    } else {
      // For container shapes, try to assign the plain value
      // Use getOrCreateRef to ensure the container is created
      const ref = this.getOrCreateRef(key)
      if (assignPlainValueToTypedRef(ref, value)) {
        this.commitIfAuto()
        return
      }
      throw new Error(
        "Cannot set container directly, modify the typed ref instead",
      )
    }
  }

  setContainer<C extends Container>(key: string, container: C): C {
    const result = this.container.setContainer(key, container)
    this.commitIfAuto()
    return result
  }

  delete(key: string): void {
    this.container.delete(key)
    this.refCache.delete(key)
    this.commitIfAuto()
  }

  has(key: string): boolean {
    return this.container.get(key) !== undefined
  }

  keys(): string[] {
    return this.container.keys()
  }

  values(): any[] {
    return this.container.values()
  }

  get size(): number {
    return this.container.size
  }

  toJSON(): Record<string, Infer<NestedShape>> {
    return serializeRefToJSON(this, this.keys()) as Record<
      string,
      Infer<NestedShape>
    >
  }
}
