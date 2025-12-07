import {
  type Container,
  LoroCounter,
  LoroList,
  LoroMap,
  LoroMovableList,
  LoroText,
  LoroTree,
  type Value,
} from "loro-crdt"
import type {
  ContainerOrValueShape,
  ContainerShape,
  RecordContainerShape,
} from "../shape.js"
import type { Infer, InferDraftType } from "../types.js"
import { isContainerShape, isValueShape } from "../utils/type-guards.js"
import { TypedRef, type TypedRefParams } from "./base.js"
import { assignPlainValueToTypedRef, createContainerTypedRef } from "./utils.js"

const containerConstructor = {
  counter: LoroCounter,
  list: LoroList,
  map: LoroMap,
  movableList: LoroMovableList,
  record: LoroMap,
  text: LoroText,
  tree: LoroTree,
} as const

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
    const placeholder = (this.placeholder as any)?.[key]

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
      const shape = this.shape.shape as ContainerShape
      if (shape._type === "counter") {
        return (node as any).value
      }
      if (shape._type === "text") {
        return (node as any).toString()
      }
    }

    return node as any
  }

  get(key: string): InferDraftType<NestedShape> {
    return this.getOrCreateNode(key)
  }

  set(key: string, value: any): void {
    if (this.readonly) throw new Error("Cannot modify readonly ref")
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
    if (this.readonly) throw new Error("Cannot modify readonly ref")
    return this.container.setContainer(key, container)
  }

  delete(key: string): void {
    if (this.readonly) throw new Error("Cannot modify readonly ref")
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
}
