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
import { DraftNode, type DraftNodeParams } from "./base.js"
import {
  assignPlainValueToDraftNode,
  createContainerDraftNode,
} from "./utils.js"

const containerConstructor = {
  counter: LoroCounter,
  list: LoroList,
  map: LoroMap,
  movableList: LoroMovableList,
  record: LoroMap,
  text: LoroText,
  tree: LoroTree,
} as const

// Map draft node
export class MapDraftNode<
  NestedShapes extends Record<string, ContainerOrValueShape>,
> extends DraftNode<any> {
  private propertyCache = new Map<string, DraftNode<ContainerShape> | Value>()

  constructor(params: DraftNodeParams<MapContainerShape<NestedShapes>>) {
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
      if (node instanceof DraftNode) {
        // Contains a DraftNode, not a plain Value: keep recursing
        node.absorbPlainValues()
        continue
      }

      // Plain value!
      this.container.set(key, node)
    }
  }

  getDraftNodeParams<S extends ContainerShape>(
    key: string,
    shape: S,
  ): DraftNodeParams<ContainerShape> {
    const emptyState = (this.emptyState as any)?.[key]

    const LoroContainer = containerConstructor[shape._type]

    return {
      shape,
      emptyState,
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
        node = createContainerDraftNode(this.getDraftNodeParams(key, shape))
        // We cache container nodes even in readonly mode because they are just handles
        this.propertyCache.set(key, node)
      } else {
        // For value shapes, first try to get the value from the container
        const containerValue = this.container.get(key)
        if (containerValue !== undefined) {
          node = containerValue as Value
        } else {
          // Only fall back to empty state if the container doesn't have the value
          const emptyState = (this.emptyState as any)?.[key]
          if (emptyState === undefined) {
            throw new Error("empty state required")
          }
          node = emptyState as Value
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
      // In readonly mode, if the container doesn't exist, return the empty state
      // This ensures we respect default values (e.g. counter: 1)
      const existing = this.container.get(key)
      if (existing === undefined) {
        return (this.emptyState as any)?.[key]
      }

      if (shape._type === "counter") {
        return (node as any).value
      }
      if (shape._type === "text") {
        return (node as any).toString()
      }
    }

    return node as Shape extends ContainerShape ? DraftNode<Shape> : Value
  }

  private createLazyProperties(): void {
    for (const key in this.shape.shapes) {
      const shape = this.shape.shapes[key]
      Object.defineProperty(this, key, {
        get: () => this.getOrCreateNode(key, shape),
        set: value => {
          if (this.readonly) throw new Error("Cannot modify readonly doc")
          if (isValueShape(shape)) {
            this.container.set(key, value)
            this.propertyCache.set(key, value)
          } else {
            if (value && typeof value === "object") {
              const node = this.getOrCreateNode(key, shape)

              if (assignPlainValueToDraftNode(node as DraftNode<any>, value)) {
                return
              }
            }
            throw new Error(
              "Cannot set container directly, modify the draft node instead",
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
    if (this.readonly) throw new Error("Cannot modify readonly doc")
    this.container.set(key, value)
  }

  setContainer<C extends Container>(key: string, container: C): C {
    if (this.readonly) throw new Error("Cannot modify readonly doc")
    return this.container.setContainer(key, container)
  }

  delete(key: string): void {
    if (this.readonly) throw new Error("Cannot modify readonly doc")
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
