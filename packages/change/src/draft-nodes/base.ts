import type { ContainerShape, DocShape, ShapeToContainer } from "../shape.js"
import type { Infer } from "../types.js"

export type DraftNodeParams<Shape extends DocShape | ContainerShape> = {
  shape: Shape
  placeholder?: Infer<Shape>
  getContainer: () => ShapeToContainer<Shape>
  readonly?: boolean
}

// Base class for all draft nodes
export abstract class DraftNode<Shape extends DocShape | ContainerShape> {
  protected _cachedContainer?: ShapeToContainer<Shape>

  constructor(protected _params: DraftNodeParams<Shape>) {}

  abstract absorbPlainValues(): void

  protected get shape(): Shape {
    return this._params.shape
  }

  protected get placeholder(): Infer<Shape> | undefined {
    return this._params.placeholder
  }

  protected get readonly(): boolean {
    return !!this._params.readonly
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
