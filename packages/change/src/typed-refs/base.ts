import type { LoroDoc, Subscription } from "loro-crdt"
import { LORO_SYMBOL, type LoroRefBase } from "../loro.js"
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
 *
 * @deprecated Use `loro(ref)` instead. The `$` namespace will be removed in a future version.
 */
export interface RefMetaNamespace<Shape extends DocShape | ContainerShape> {
  /**
   * Access the underlying LoroDoc.
   * @deprecated Use `loro(ref).doc` instead.
   */
  readonly loroDoc: LoroDoc

  /**
   * Access the underlying Loro container (correctly typed).
   * @deprecated Use `loro(ref).container` instead.
   */
  readonly loroContainer: ShapeToContainer<Shape>

  /**
   * Subscribe to container-level changes.
   * @param callback - Function called when the container changes
   * @returns Unsubscribe function
   * @deprecated Use `loro(ref).subscribe(callback)` instead.
   */
  subscribe(callback: (event: unknown) => void): Subscription
}

// Base class for all typed refs
export abstract class TypedRef<Shape extends DocShape | ContainerShape> {
  protected _cachedContainer?: ShapeToContainer<Shape>
  private _$?: RefMetaNamespace<Shape>
  private _loroNamespace?: LoroRefBase

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
   * @deprecated Use `loro(ref)` instead. The `$` namespace will be removed in a future version.
   *
   * @example
   * ```typescript
   * // OLD (deprecated):
   * textRef.$.loroDoc
   * textRef.$.loroContainer
   * textRef.$.subscribe(callback)
   *
   * // NEW (recommended):
   * import { loro } from "@loro-extended/change"
   * loro(textRef).doc
   * loro(textRef).container
   * loro(textRef).subscribe(callback)
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

  /**
   * Access the loro() namespace via the well-known symbol.
   * This is used by the loro() function to access CRDT internals.
   * Subclasses can override createLoroNamespace() to add container-specific methods.
   */
  get [LORO_SYMBOL](): LoroRefBase {
    if (!this._loroNamespace) {
      this._loroNamespace = this.createLoroNamespace()
    }
    return this._loroNamespace
  }

  /**
   * Creates the loro() namespace object.
   * Subclasses can override this to add container-specific methods.
   */
  protected createLoroNamespace(): LoroRefBase {
    const self = this
    return {
      get doc(): LoroDoc {
        return self._params.getDoc()
      },
      get container(): unknown {
        return self.container
      },
      subscribe(callback: (event: unknown) => void): Subscription {
        return (self.container as any).subscribe(callback)
      },
    }
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
