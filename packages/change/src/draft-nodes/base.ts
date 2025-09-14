import type { LoroDoc } from "loro-crdt"
import type { ContainerShape, DocShape, ShapeToContainer } from "../shape.js"
import type { InferPlainType } from "../types.js"

export type DraftNodeParams<Shape extends DocShape | ContainerShape> = {
  doc: LoroDoc
  shape: Shape
  emptyState?: InferPlainType<Shape>
  getContainer: () => ShapeToContainer<Shape>
}

// Base class for all draft nodes
export abstract class DraftNode<Shape extends DocShape | ContainerShape> {
  protected _cachedContainer?: ShapeToContainer<Shape>

  constructor(protected _params: DraftNodeParams<Shape>) {}

  abstract absorbPlainValues(): void

  // protected getParentContainer(parentPath: string[]): LoroMap {
  //   if (parentPath.length === 1) {
  //     return this.doc.getMap(parentPath[0])
  //   } else {
  //     const grandParentPath = parentPath.slice(0, -1)
  //     const parentKey = parentPath[parentPath.length - 1]
  //     const grandParent = this.getParentContainer(grandParentPath)
  //     return grandParent.getOrCreateContainer(parentKey, new LoroMap())
  //   }
  // }

  protected get doc(): LoroDoc {
    return this._params.doc
  }

  protected get shape(): Shape {
    return this._params.shape
  }

  protected get emptyState(): InferPlainType<Shape> | undefined {
    return this._params.emptyState
  }

  protected get container(): ShapeToContainer<Shape> {
    if (!this._cachedContainer) {
      const container = this._params.getContainer()
      this._cachedContainer = container
      return container
    }
    return this._cachedContainer
  }
}
