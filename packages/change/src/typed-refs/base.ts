import type { LoroDoc } from "loro-crdt"
import type { ContainerShape, DocShape, ShapeToContainer } from "../shape.js"
import type { Infer } from "../types.js"

export type TypedRefParams<Shape extends DocShape | ContainerShape> = {
  shape: Shape
  placeholder?: Infer<Shape>
  getContainer: () => ShapeToContainer<Shape>
  readonly?: boolean // DEPRECATED - remove in future
  autoCommit?: boolean // NEW: auto-commit after mutations
  getDoc?: () => LoroDoc // NEW: needed for auto-commit
}

// Base class for all typed refs
export abstract class TypedRef<Shape extends DocShape | ContainerShape> {
  protected _cachedContainer?: ShapeToContainer<Shape>

  constructor(protected _params: TypedRefParams<Shape>) {}

  abstract absorbPlainValues(): void

  /**
   * Serializes the ref to a plain JSON-compatible value.
   * Returns the plain type inferred from the shape.
   */
  abstract toJSON(): Infer<Shape>

  protected get shape(): Shape {
    return this._params.shape
  }

  protected get placeholder(): Infer<Shape> | undefined {
    return this._params.placeholder
  }

  protected get readonly(): boolean {
    return !!this._params.readonly
  }

  protected get autoCommit(): boolean {
    return !!this._params.autoCommit
  }

  protected get doc(): LoroDoc | undefined {
    return this._params.getDoc?.()
  }

  /**
   * Commits changes if autoCommit is enabled.
   * Call this after any mutation operation.
   */
  protected commitIfAuto(): void {
    if (this.autoCommit && this.doc) {
      this.doc.commit()
    }
  }

  /**
   * Throws an error if this ref is in readonly mode.
   * Call this at the start of any mutating method.
   * @deprecated Mutations are always allowed now; this will be removed.
   */
  protected assertMutable(): void {
    if (this.readonly) {
      throw new Error("Cannot modify readonly ref")
    }
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
