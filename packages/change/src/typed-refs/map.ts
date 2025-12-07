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
  MapContainerShape,
  ValueShape,
} from "../shape.js"
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

// Map typed ref
export class MapRef<
  NestedShapes extends Record<string, ContainerOrValueShape>,
> extends TypedRef<any> {
  private propertyCache = new Map<string, TypedRef<ContainerShape> | Value>()

  constructor(params: TypedRefParams<MapContainerShape<NestedShapes>>) {
    super(params)
    this.createLazyProperties()
  }

  protected get shape(): MapContainerShape<NestedShapes> {
    return super.shape as MapContainerShape<NestedShapes>
  }

  protected get container(): LoroMap {
    return super.container as LoroMap
  }

  absorbPlainValues() {
    for (const [key, node] of this.propertyCache.entries()) {
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

  getOrCreateNode<Shape extends ContainerShape | ValueShape>(
    key: string,
    shape: Shape,
  ): any {
    let node = this.propertyCache.get(key)
    if (!node) {
      if (isContainerShape(shape)) {
        node = createContainerTypedRef(this.getTypedRefParams(key, shape))
        // We cache container nodes even in readonly mode because they are just handles
        this.propertyCache.set(key, node)
      } else {
        // For value shapes, first try to get the value from the container
        const containerValue = this.container.get(key)
        if (containerValue !== undefined) {
          node = containerValue as Value
        } else {
          // Only fall back to placeholder if the container doesn't have the value
          const placeholder = (this.placeholder as any)?.[key]
          if (placeholder === undefined) {
            throw new Error("placeholder required")
          }
          node = placeholder as Value
        }

        // In readonly mode, we DO NOT cache primitive values.
        // This ensures we always get the latest value from the CRDT on next access.
        if (!this.readonly) {
          this.propertyCache.set(key, node)
        }
      }
      if (node === undefined) throw new Error("no container made")
    }

    if (this.readonly && isContainerShape(shape)) {
      // In readonly mode, if the container doesn't exist, return the placeholder
      // This ensures we respect default values (e.g. counter: 1)
      const existing = this.container.get(key)
      if (existing === undefined) {
        return (this.placeholder as any)?.[key]
      }

      if (shape._type === "counter") {
        return (node as any).value
      }
      if (shape._type === "text") {
        return (node as any).toString()
      }
    }

    return node as Shape extends ContainerShape ? TypedRef<Shape> : Value
  }

  private createLazyProperties(): void {
    for (const key in this.shape.shapes) {
      const shape = this.shape.shapes[key]
      Object.defineProperty(this, key, {
        get: () => this.getOrCreateNode(key, shape),
        set: value => {
          if (this.readonly) throw new Error("Cannot modify readonly ref")
          if (isValueShape(shape)) {
            this.container.set(key, value)
            this.propertyCache.set(key, value)
          } else {
            if (value && typeof value === "object") {
              const node = this.getOrCreateNode(key, shape)

              if (assignPlainValueToTypedRef(node as TypedRef<any>, value)) {
                return
              }
            }
            throw new Error(
              "Cannot set container directly, modify the typed ref instead",
            )
          }
        },
      })
    }
  }

  // TOOD(duane): return correct type here
  get(key: string): any {
    return this.container.get(key)
  }

  set(key: string, value: Value): void {
    if (this.readonly) throw new Error("Cannot modify readonly ref")
    this.container.set(key, value)
  }

  setContainer<C extends Container>(key: string, container: C): C {
    if (this.readonly) throw new Error("Cannot modify readonly ref")
    return this.container.setContainer(key, container)
  }

  delete(key: string): void {
    if (this.readonly) throw new Error("Cannot modify readonly ref")
    this.container.delete(key)
  }

  has(key: string): boolean {
    // LoroMap doesn't have a has method, so we check if get returns undefined
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
