import type { Container, LoroMap, Value } from "loro-crdt"
import { deriveShapePlaceholder } from "../derive-placeholder.js"
import { mergeValue } from "../overlay.js"
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
  unwrapReadonlyPrimitive,
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
      readonly: this.readonly,
      autoCommit: this._params.autoCommit,
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

    // For value shapes, ALWAYS read from the container to avoid stale cache issues.
    // Value shapes should not be cached because the underlying container can be
    // modified by other RecordRef instances (e.g., drafts created by change()).
    if (isValueShape(shape)) {
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

    // For container shapes, we can safely cache the ref since it's a handle
    // to the underlying Loro container, not a value copy.
    let ref = this.refCache.get(key)
    if (!ref) {
      ref = createContainerTypedRef(
        this.getTypedRefParams(key, shape as ContainerShape),
      )
      this.refCache.set(key, ref)
    }

    if (this.readonly) {
      return unwrapReadonlyPrimitive(
        ref as TypedRef<any>,
        shape as ContainerShape,
      )
    }

    return ref as any
  }

  get(key: string): InferMutableType<NestedShape> | undefined {
    return this.getRef(key)
  }

  set(key: string, value: any): void {
    this.assertMutable()
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
    this.assertMutable()
    const result = this.container.setContainer(key, container)
    this.commitIfAuto()
    return result
  }

  delete(key: string): void {
    this.assertMutable()
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
    // Fast path: readonly mode
    if (this.readonly) {
      const nativeJson = this.container.toJSON() as Record<string, any>
      // For records, we need to overlay placeholders for each entry's nested shape
      const result: Record<string, Infer<NestedShape>> = {}
      for (const key of Object.keys(nativeJson)) {
        // For records, the placeholder is always {}, so we need to derive
        // the placeholder for the nested shape on the fly
        const nestedPlaceholderValue = deriveShapePlaceholder(this.shape.shape)

        result[key] = mergeValue(
          this.shape.shape,
          nativeJson[key],
          nestedPlaceholderValue as Value,
        ) as Infer<NestedShape>
      }
      return result
    }

    return serializeRefToJSON(this, this.keys()) as Record<
      string,
      Infer<NestedShape>
    >
  }
}
