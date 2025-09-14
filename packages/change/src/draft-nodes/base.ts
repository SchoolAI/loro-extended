import type { LoroDoc } from "loro-crdt"
import type { ContainerShape, DocShape, ShapeToContainer } from "../shape.js"
import type { InferPlainType } from "../types.js"

export type DraftNodeParams<Shape extends DocShape | ContainerShape> = {
  shape: Shape
  emptyState?: InferPlainType<Shape>
  getContainer: () => ShapeToContainer<Shape>
}

// Base class for all draft nodes
export abstract class DraftNode<Shape extends DocShape | ContainerShape> {
  protected _cachedContainer?: ShapeToContainer<Shape>

  constructor(protected _params: DraftNodeParams<Shape>) {}

  abstract absorbPlainValues(): void

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
