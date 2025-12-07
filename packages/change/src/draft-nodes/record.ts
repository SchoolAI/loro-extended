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
import { DraftNode, type DraftNodeParams } from "./base.js"
import { createContainerDraftNode } from "./utils.js"

const containerConstructor = {
  counter: LoroCounter,
  list: LoroList,
  map: LoroMap,
  movableList: LoroMovableList,
  record: LoroMap,
  text: LoroText,
  tree: LoroTree,
} as const

// Record draft node
export class RecordDraftNode<
  NestedShape extends ContainerOrValueShape,
> extends DraftNode<any> {
  [key: string]: Infer<NestedShape> | any
  private nodeCache = new Map<string, DraftNode<ContainerShape> | Value>()

  protected get shape(): RecordContainerShape<NestedShape> {
    return super.shape as RecordContainerShape<NestedShape>
  }

  protected get container(): LoroMap {
    return super.container as LoroMap
  }

  absorbPlainValues() {
    for (const [key, node] of this.nodeCache.entries()) {
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
    }
  }

  getOrCreateNode(key: string): InferDraftType<NestedShape> {
    let node = this.nodeCache.get(key)
    if (!node) {
      const shape = this.shape.shape
      if (isContainerShape(shape)) {
        node = createContainerDraftNode(
          this.getDraftNodeParams(key, shape as ContainerShape),
        )
      } else {
        // For value shapes, first try to get the value from the container
        const containerValue = this.container.get(key)
        if (containerValue !== undefined) {
          node = containerValue as Value
        } else {
          // Only fall back to empty state if the container doesn't have the value
          const emptyState = (this.emptyState as any)?.[key]
          // For records, empty state might not have the key, which is fine?
          // But if we are accessing it, maybe we expect it to exist or be created?
          // If it's a value type, we can't really "create" it without a value.
          // So if it's undefined in container and empty state, we return undefined?
          // But the return type expects Value.
          // Let's check MapDraftNode.
          // MapDraftNode throws "empty state required" if not found.
          // But for Record, keys are dynamic.
          if (emptyState === undefined) {
            // If it's a value type and not in container or empty state,
            // we should probably return undefined if the type allows it,
            // or maybe the default value for that type?
            // But we don't have a default value generator for shapes.
            // Actually Shape.plain.* factories have _plain and _draft which are defaults.
            node = (shape as any)._plain
          } else {
            node = emptyState as Value
          }
        }
      }
      if (node !== undefined) {
        this.nodeCache.set(key, node)
      }
    }

    return node as any
  }

  get(key: string): InferDraftType<NestedShape> {
    return this.getOrCreateNode(key)
  }

  set(key: string, value: any): void {
    if (isValueShape(this.shape.shape)) {
      this.container.set(key, value)
      // Update cache if needed?
      // MapDraftNode updates container directly for values.
      // But we also cache values in nodeCache for consistency?
      // MapDraftNode doesn't cache values in propertyCache if they are set via setter?
      // Actually MapDraftNode setter:
      // set: isValueShape(shape) ? value => this.container.set(key, value) : undefined
      // It doesn't update propertyCache.
      // But getOrCreateNode checks propertyCache first.
      // So if we set it, we should probably update propertyCache or clear it for that key.
      this.nodeCache.set(key, value)
    } else {
      // For containers, we can't set them directly usually.
      // But if the user passes a plain object that matches the shape, maybe we should convert it?
      if (value && typeof value === "object") {
        const node = this.getOrCreateNode(key)
        const shapeType = (node as any).shape._type

        if (shapeType === "map" || shapeType === "record") {
          for (const k in value) {
            ;(node as any)[k] = value[k]
          }
          return
        }
      }

      throw new Error(
        "Cannot set container directly, modify the draft node instead",
      )
    }
  }

  setContainer<C extends Container>(key: string, container: C): C {
    return this.container.setContainer(key, container)
  }

  delete(key: string): void {
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
