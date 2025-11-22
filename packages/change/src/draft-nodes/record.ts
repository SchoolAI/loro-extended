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
import type { InferDraftType } from "../types.js"
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
  private nodeCache = new Map<string, DraftNode<ContainerShape> | Value>()

  constructor(params: DraftNodeParams<RecordContainerShape<NestedShape>>) {
    super(params)
    // We don't need to create lazy properties because keys are dynamic
    // But we could use a Proxy if we wanted property access syntax like record.key
    // However, for now let's stick to get/set methods or maybe Proxy for better DX?
    // The requirement says "records with uniform specific key type and value".
    // Usually records are accessed via keys.
    // If we want `draft.record.key`, we need a Proxy.
    // biome-ignore lint/correctness/noConstructorReturn: Proxy return is intentional
    return new Proxy(this, {
      get: (target, prop) => {
        if (typeof prop === "string" && !(prop in target)) {
          return target.get(prop)
        }
        return Reflect.get(target, prop)
      },
      set: (target, prop, value) => {
        if (typeof prop === "string" && !(prop in target)) {
          target.set(prop, value)
          return true
        }
        return Reflect.set(target, prop, value)
      },
      deleteProperty: (target, prop) => {
        if (typeof prop === "string" && !(prop in target)) {
          target.delete(prop)
          return true
        }
        return Reflect.deleteProperty(target, prop)
      },
      ownKeys: target => {
        return target.keys()
      },
      getOwnPropertyDescriptor: (target, prop) => {
        if (typeof prop === "string" && target.has(prop)) {
          return {
            configurable: true,
            enumerable: true,
            value: target.get(prop),
          }
        }
        return Reflect.getOwnPropertyDescriptor(target, prop)
      },
    })
  }

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
    // biome-ignore lint/suspicious/noExplicitAny: prevent excessively deep type errors
    const emptyState = (this.emptyState as any)?.[key]

    const LoroContainer = containerConstructor[shape._type]

    return {
      shape,
      emptyState,
      getContainer: () =>
        // biome-ignore lint/suspicious/noExplicitAny: override
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
      // But typically we modify the draft node.
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

  // biome-ignore lint/suspicious/noExplicitAny: an array of values merges all value types
  values(): any[] {
    return this.container.values()
  }

  get size(): number {
    return this.container.size
  }
}
