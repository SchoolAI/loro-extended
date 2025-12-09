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
  assignPlainValueToTypedRef,
  containerConstructor,
  createContainerTypedRef,
  unwrapReadonlyPrimitive,
} from "./utils.js"

// Record typed ref
export class RecordRef<
  NestedShape extends ContainerOrValueShape,
> extends TypedRef<any> {
  [key: string]: Infer<NestedShape> | any
  private nodeCache = new Map<string, TypedRef<ContainerShape> | Value>()

  protected get shape(): RecordContainerShape<NestedShape> {
    return super.shape as RecordContainerShape<NestedShape>
  }

  protected get container(): LoroMap {
    return super.container as LoroMap
  }

  absorbPlainValues() {
    for (const [key, node] of this.nodeCache.entries()) {
      if (node instanceof TypedRef) {
        // Contains a TypedRef, not a plain Value: keep recursing
        node.absorbPlainValues()
        continue
      }

      // Plain value!
      this.container.set(key, node)
    }
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

    const LoroContainer = containerConstructor[shape._type]

    return {
      shape,
      placeholder,
      getContainer: () =>
        this.container.getOrCreateContainer(key, new (LoroContainer as any)()),
      readonly: this.readonly,
    }
  }

  getOrCreateNode(key: string): any {
    // For readonly mode with container shapes, check if the key exists first
    // This allows optional chaining (?.) to work correctly for non-existent keys
    // Similar to how ListRefBase.getMutableItem() handles non-existent indices
    if (this.readonly && isContainerShape(this.shape.shape)) {
      const existing = this.container.get(key)
      if (existing === undefined) {
        return undefined
      }
    }

    let node = this.nodeCache.get(key)
    if (!node) {
      const shape = this.shape.shape
      if (isContainerShape(shape)) {
        node = createContainerTypedRef(
          this.getTypedRefParams(key, shape as ContainerShape),
        )
        // Cache container nodes
        this.nodeCache.set(key, node)
      } else {
        // For value shapes, first try to get the value from the container
        const containerValue = this.container.get(key)
        if (containerValue !== undefined) {
          node = containerValue as Value
        } else {
          // Only fall back to placeholder if the container doesn't have the value
          const placeholder = (this.placeholder as any)?.[key]
          if (placeholder === undefined) {
            // If it's a value type and not in container or placeholder,
            // fallback to the default value from the shape
            node = (shape as any)._plain
          } else {
            node = placeholder as Value
          }
        }
        // Only cache primitive values if NOT readonly
        if (node !== undefined && !this.readonly) {
          this.nodeCache.set(key, node)
        }
      }
    }

    if (this.readonly && isContainerShape(this.shape.shape)) {
      return unwrapReadonlyPrimitive(
        node as TypedRef<any>,
        this.shape.shape as ContainerShape,
      )
    }

    return node as any
  }

  get(key: string): InferMutableType<NestedShape> {
    return this.getOrCreateNode(key)
  }

  set(key: string, value: any): void {
    this.assertMutable()
    if (isValueShape(this.shape.shape)) {
      this.container.set(key, value)
      this.nodeCache.set(key, value)
    } else {
      // For containers, we can't set them directly usually.
      // But if the user passes a plain object that matches the shape, maybe we should convert it?
      if (value && typeof value === "object") {
        const node = this.getOrCreateNode(key)

        if (assignPlainValueToTypedRef(node, value)) {
          return
        }
      }

      throw new Error(
        "Cannot set container directly, modify the typed ref instead",
      )
    }
  }

  setContainer<C extends Container>(key: string, container: C): C {
    this.assertMutable()
    return this.container.setContainer(key, container)
  }

  delete(key: string): void {
    this.assertMutable()
    this.container.delete(key)
    this.nodeCache.delete(key)
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

  toJSON(): Record<string, any> {
    // Fast path: readonly mode
    if (this.readonly) {
      const nativeJson = this.container.toJSON() as Record<string, any>
      // For records, we need to overlay placeholders for each entry's nested shape
      const result: Record<string, any> = {}
      for (const key of Object.keys(nativeJson)) {
        // For records, the placeholder is always {}, so we need to derive
        // the placeholder for the nested shape on the fly
        const nestedPlaceholderValue = deriveShapePlaceholder(this.shape.shape)

        result[key] = mergeValue(
          this.shape.shape,
          nativeJson[key],
          nestedPlaceholderValue as Value,
        )
      }
      return result
    }

    const result: Record<string, any> = {}
    for (const key of this.keys()) {
      const value = this.get(key)
      if (value && typeof value === "object" && "toJSON" in value) {
        result[key] = (value as any).toJSON()
      } else {
        result[key] = value
      }
    }
    return result
  }
}
