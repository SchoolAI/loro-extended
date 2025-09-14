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
import type { ContainerShape, MapContainerShape, ValueShape } from "../shape.js"
import { isContainerShape, isValueShape } from "../utils/type-guards.js"
import { DraftNode, type DraftNodeParams } from "./base.js"
import { createContainerDraftNode } from "./utils.js"

const containerConstructor = {
  counter: LoroCounter,
  list: LoroList,
  map: LoroMap,
  movableList: LoroMovableList,
  text: LoroText,
  tree: LoroTree,
} as const

// Map draft node
export class MapDraftNode<
  Shape extends MapContainerShape,
> extends DraftNode<Shape> {
  private propertyCache = new Map<string, DraftNode<ContainerShape> | Value>()

  constructor(params: DraftNodeParams<Shape>) {
    super(params)
    this.createLazyProperties()
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
    const emptyState = this.emptyState?.[key]

    const LoroContainer = containerConstructor[shape._type]

    return {
      shape,
      emptyState,
      getContainer: () =>
        // biome-ignore lint/suspicious/noExplicitAny: override
        this.container.getOrCreateContainer(key, new (LoroContainer as any)()),
    }
  }

  getOrCreateNode<Shape extends ContainerShape | ValueShape>(
    key: string,
    shape: Shape,
  ): Shape extends ContainerShape ? DraftNode<Shape> : Value {
    let node = this.propertyCache.get(key)
    if (!node) {
      if (isContainerShape(shape)) {
        node = createContainerDraftNode(this.getDraftNodeParams(key, shape))
      } else {
        const emptyState = this.emptyState?.[key]
        if (!emptyState) throw new Error("empty state required")
        node = emptyState
      }
      if (!node) throw new Error("no container made")
      this.propertyCache.set(key, node)
    }

    return node as Shape extends ContainerShape ? DraftNode<Shape> : Value
  }

  private createLazyProperties(): void {
    for (const key in this.shape.shapes) {
      const shape = this.shape.shapes[key]
      Object.defineProperty(this, key, {
        get: () => this.getOrCreateNode(key, shape),
        set: isValueShape(shape)
          ? value => {
              // console.log("set value", value)
              this.container.set(key, value)
            }
          : undefined,
      })
    }
  }

  // TOOD(duane): return correct type here
  get(key: string): any {
    return this.container.get(key)
  }

  set(key: string, value: Value): void {
    this.container.set(key, value)
  }

  setContainer<C extends Container>(key: string, container: C): C {
    return this.container.setContainer(key, container)
  }

  delete(key: string): void {
    this.container.delete(key)
  }

  has(key: string): boolean {
    // LoroMap doesn't have a has method, so we check if get returns undefined
    return this.container.get(key) !== undefined
  }

  keys(): string[] {
    return this.container.keys()
  }

  // biome-ignore lint/suspicious/noExplicitAny: an array of values merges all value types
  values(): any[] {
    return this.container.values()
  }

  get size(): number {
    return this.container.size
  }
}
