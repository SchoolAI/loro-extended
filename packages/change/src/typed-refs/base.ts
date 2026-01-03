import type { LoroDoc, Subscription } from "loro-crdt"
import type { ContainerShape, DocShape, ShapeToContainer } from "../shape.js"
import type { Infer } from "../types.js"

export type TypedRefParams<Shape extends DocShape | ContainerShape> = {
  shape: Shape
  placeholder?: Infer<Shape>
  getContainer: () => ShapeToContainer<Shape>
  autoCommit?: boolean // Auto-commit after mutations
  batchedMutation?: boolean // True when inside change() block - enables value shape caching for find-and-mutate patterns
  getDoc: () => LoroDoc // Needed for auto-commit
}

/**
 * Meta-operations namespace for typed refs.
 * Provides access to underlying Loro primitives.
 */
export interface RefMetaNamespace<Shape extends DocShape | ContainerShape> {
  /**
   * Access the underlying LoroDoc.
   */
  readonly loroDoc: LoroDoc

  /**
   * Access the underlying Loro container (correctly typed).
   */
  readonly loroContainer: ShapeToContainer<Shape>

  /**
   * Subscribe to container-level changes.
   * @param callback - Function called when the container changes
   * @returns Unsubscribe function
   */
  subscribe(callback: (event: unknown) => void): Subscription
}

// Base class for all typed refs
export abstract class TypedRef<Shape extends DocShape | ContainerShape> {
  protected _cachedContainer?: ShapeToContainer<Shape>
  private _$?: RefMetaNamespace<Shape>

  constructor(protected _params: TypedRefParams<Shape>) {}

  abstract absorbPlainValues(): void

  /**
   * Serializes the ref to a plain JSON-compatible value.
   * Returns the plain type inferred from the shape.
   */
  abstract toJSON(): Infer<Shape>

  /**
   * Meta-operations namespace for accessing underlying Loro primitives.
   *
   * @example
   * ```typescript
   * // Access the underlying LoroDoc
   * textRef.$.loroDoc.subscribe((event) => console.log("Doc changed"))
   *
   * // Access the underlying Loro container (correctly typed)
   * textRef.$.loroContainer  // LoroText
   *
   * // Subscribe to container-level changes
   * textRef.$.subscribe((event) => console.log("Text changed"))
   * ```
   */
  get $(): RefMetaNamespace<Shape> {
    if (!this._$) {
      const self = this
      this._$ = {
        get loroDoc(): LoroDoc {
          return self._params.getDoc()
        },
        get loroContainer(): ShapeToContainer<Shape> {
          return self.container
        },
        subscribe(callback: (event: unknown) => void): Subscription {
          // All Loro containers have a subscribe method
          return (self.container as any).subscribe(callback)
        },
      }
    }
    return this._$
  }

  protected get shape(): Shape {
    return this._params.shape
  }

  protected get placeholder(): Infer<Shape> | undefined {
    return this._params.placeholder
  }

  protected get autoCommit(): boolean {
    return !!this._params.autoCommit
  }

  protected get batchedMutation(): boolean {
    return !!this._params.batchedMutation
  }

  protected get doc(): LoroDoc {
    return this._params.getDoc()
  }

  /**
   * Commits changes if autoCommit is enabled.
   * Call this after any mutation operation.
   */
  protected commitIfAuto(): void {
    if (this.autoCommit) {
      this.doc.commit()
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
