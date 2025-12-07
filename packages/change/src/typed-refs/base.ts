import type { ContainerShape, DocShape, ShapeToContainer } from "../shape.js"
import type { Infer } from "../types.js"

export type TypedRefParams<Shape extends DocShape | ContainerShape> = {
  shape: Shape
  placeholder?: Infer<Shape>
  getContainer: () => ShapeToContainer<Shape>
  readonly?: boolean
}

// Base class for all typed refs
export abstract class TypedRef<Shape extends DocShape | ContainerShape> {
  protected _cachedContainer?: ShapeToContainer<Shape>

  constructor(protected _params: TypedRefParams<Shape>) {}

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
