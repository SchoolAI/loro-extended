import type { InferPlainType } from "../index.js"
import type { ContainerShape, DocShape } from "../shape.js"
import { DraftNode, type DraftNodeParams } from "./base.js"
import { CounterDraftNode } from "./counter.js"
import { ListDraftNode } from "./list.js"
import { MapDraftNode } from "./map.js"
import { MovableListDraftNode } from "./movable-list.js"
import { TextDraftNode } from "./text.js"
import { TreeDraftNode } from "./tree.js"

// Draft Document class -- the actual object passed to the change `mutation` function
export class DraftDoc<Shape extends DocShape> extends DraftNode<Shape> {
  private propertyCache = new Map<string, DraftNode<Shape>>()
  private requiredEmptyState!: InferPlainType<Shape>

  constructor(_params: Omit<DraftNodeParams<Shape>, "getContainer">) {
    super({
      ..._params,
      getContainer: () => {
        throw new Error("can't get container on DraftDoc")
      },
    })
    if (!_params.emptyState) throw new Error("emptyState required")
    this.requiredEmptyState = _params.emptyState
    this.createLazyProperties()
  }

  createDraftNode<S extends ContainerShape>(
    key: string,
    nestedShape: S,
  ): DraftNode<any> {
    const doc = this.doc

    switch (nestedShape._type) {
      case "counter":
        return new CounterDraftNode({
          doc,
          shape: nestedShape,
          emptyState: this.requiredEmptyState[key],
          getContainer: doc.getCounter.bind(doc, key),
        })
      case "list":
        return new ListDraftNode({
          doc,
          shape: nestedShape,
          emptyState: this.requiredEmptyState[key],
          getContainer: doc.getList.bind(doc, key),
        })
      case "map":
        return new MapDraftNode({
          doc,
          shape: nestedShape,
          emptyState: this.requiredEmptyState[key],
          getContainer: doc.getMap.bind(doc, key),
        })
      case "movableList":
        return new MovableListDraftNode({
          doc,
          shape: nestedShape,
          emptyState: this.requiredEmptyState[key],
          getContainer: doc.getMovableList.bind(doc, key),
        })
      case "text":
        return new TextDraftNode({
          doc,
          shape: nestedShape,
          emptyState: this.requiredEmptyState[key],
          getContainer: doc.getText.bind(doc, key),
        })
      case "tree":
        return new TreeDraftNode({
          doc,
          shape: nestedShape,
          emptyState: this.requiredEmptyState[key],
          getContainer: doc.getTree.bind(doc, key),
        })
    }
  }

  getOrCreateNode(key: string, shape: ContainerShape): DraftNode<Shape> {
    let node = this.propertyCache.get(key)
    if (!node) {
      node = this.createDraftNode(key, shape)
      if (!node) throw new Error("no container made")
      this.propertyCache.set(key, node)
    }

    return node
  }

  private createLazyProperties(): void {
    for (const key in this.shape.shapes) {
      const shape = this.shape.shapes[key]
      Object.defineProperty(this, key, {
        get: () => this.getOrCreateNode(key, shape),
      })
    }
  }

  absorbPlainValues(): void {
    // By iterating over the propertyCache, we achieve a small optimization
    // by only absorbing values that have been 'touched' in some way
    for (const node of this.propertyCache.values()) {
      node.absorbPlainValues()
    }
  }
}
