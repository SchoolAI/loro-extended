import type { LoroDoc } from "loro-crdt"
import type { InferPlainType } from "../index.js"
import type { ContainerShape, DocShape } from "../shape.js"
import { DraftNode, type DraftNodeParams } from "./base.js"
import { createContainerDraftNode } from "./utils.js"

const containerGetter = {
  counter: "getCounter",
  list: "getList",
  map: "getMap",
  movableList: "getMovableList",
  record: "getMap",
  text: "getText",
  tree: "getTree",
} as const

// Draft Document class -- the actual object passed to the change `mutation` function
export class DraftDoc<Shape extends DocShape> extends DraftNode<Shape> {
  private doc: LoroDoc
  private propertyCache = new Map<string, DraftNode<ContainerShape>>()
  private requiredEmptyState!: InferPlainType<Shape>

  constructor(
    _params: Omit<DraftNodeParams<Shape>, "getContainer"> & { doc: LoroDoc },
  ) {
    super({
      ..._params,
      getContainer: () => {
        throw new Error("can't get container on DraftDoc")
      },
    })
    if (!_params.emptyState) throw new Error("emptyState required")
    this.doc = _params.doc
    this.requiredEmptyState = _params.emptyState
    this.createLazyProperties()
  }

  getDraftNodeParams<S extends ContainerShape>(
    key: string,
    shape: S,
  ): DraftNodeParams<ContainerShape> {
    const getter = this.doc[containerGetter[shape._type]].bind(this.doc)

    return {
      shape,
      emptyState: this.requiredEmptyState[key],
      getContainer: () => getter(key),
    }
  }

  getOrCreateDraftNode(
    key: string,
    shape: ContainerShape,
  ): DraftNode<ContainerShape> {
    let node = this.propertyCache.get(key)

    if (!node) {
      node = createContainerDraftNode(this.getDraftNodeParams(key, shape))
      this.propertyCache.set(key, node)
    }

    return node
  }

  private createLazyProperties(): void {
    for (const key in this.shape.shapes) {
      const shape = this.shape.shapes[key]
      Object.defineProperty(this, key, {
        get: () => this.getOrCreateDraftNode(key, shape),
      })
    }
  }

  absorbPlainValues(): void {
    // By iterating over the propertyCache, we achieve a small optimization
    // by only absorbing values that have been 'touched' in some way
    for (const [, node] of this.propertyCache.entries()) {
      node.absorbPlainValues()
    }
  }
}
