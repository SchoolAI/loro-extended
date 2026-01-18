import type { LoroDoc, Subscription } from "loro-crdt"
import { LORO_SYMBOL, type LoroRefBase } from "../loro.js"
import type { ContainerShape, DocShape, ShapeToContainer } from "../shape.js"
import type { Infer } from "../types.js"

/**
 * Symbol for internal methods that should not be enumerable or accessible to users.
 * Used to hide implementation details like absorbPlainValues(), getTypedRefParams(), etc.
 *
 * This achieves Success Criteria #7 from loro-api-refactor.md:
 * "Internal methods hidden - Via Symbol, not enumerable"
 */
export const INTERNAL_SYMBOL = Symbol.for("loro-extended:internal")

// ============================================================================
// Minimal Interface for absorbPlainValues contract
// ============================================================================

/**
 * Minimal interface for refs that only need absorbPlainValues.
 * Used by TreeNodeRef which doesn't extend TypedRef.
 */
export interface RefInternalsBase {
  /** Absorb mutated plain values back into Loro containers */
  absorbPlainValues(): void
}

// ============================================================================
// TypedRefParams and TypedRef Base Class
// ============================================================================

export type TypedRefParams<Shape extends DocShape | ContainerShape> = {
  shape: Shape
  placeholder?: Infer<Shape>
  getContainer: () => ShapeToContainer<Shape>
  autoCommit?: boolean // Auto-commit after mutations
  batchedMutation?: boolean // True when inside change() block - enables value shape caching for find-and-mutate patterns
  getDoc: () => LoroDoc // Needed for auto-commit
}

// ============================================================================
// BaseRefInternals - Abstract base class for all internal implementations
// ============================================================================

/**
 * Abstract base class for all ref internal implementations.
 * Contains shared logic that was previously in TypedRef.createBaseInternals().
 *
 * Subclasses implement specific behavior for each ref type.
 */
export abstract class BaseRefInternals<Shape extends DocShape | ContainerShape>
  implements RefInternalsBase
{
  protected cachedContainer: ShapeToContainer<Shape> | undefined
  protected loroNamespace: LoroRefBase | undefined
  private _suppressAutoCommit = false

  constructor(protected readonly params: TypedRefParams<Shape>) {}

  /** Get the underlying Loro container (cached) */
  getContainer(): ShapeToContainer<Shape> {
    if (!this.cachedContainer) {
      this.cachedContainer = this.params.getContainer()
    }
    return this.cachedContainer
  }

  /** Commit changes if autoCommit is enabled and not suppressed */
  commitIfAuto(): void {
    if (this.params.autoCommit && !this._suppressAutoCommit) {
      this.params.getDoc().commit()
    }
  }

  /**
   * Temporarily suppress auto-commit during batch operations.
   * Used by assignPlainValueToTypedRef() to batch multiple property assignments.
   */
  setSuppressAutoCommit(suppress: boolean): void {
    this._suppressAutoCommit = suppress
  }

  /** Check if auto-commit is currently suppressed */
  isSuppressAutoCommit(): boolean {
    return this._suppressAutoCommit
  }

  /** Get the shape for this ref */
  getShape(): Shape {
    return this.params.shape
  }

  /** Get the placeholder value */
  getPlaceholder(): Infer<Shape> | undefined {
    return this.params.placeholder
  }

  /** Check if autoCommit is enabled */
  getAutoCommit(): boolean {
    return !!this.params.autoCommit
  }

  /** Check if in batched mutation mode */
  getBatchedMutation(): boolean {
    return !!this.params.batchedMutation
  }

  /** Get the LoroDoc */
  getDoc(): LoroDoc {
    return this.params.getDoc()
  }

  /**
   * Get the TypedRefParams needed to recreate this ref.
   * Used by change() to create draft refs with modified params.
   *
   * Returns a new params object with the same shape, placeholder, getContainer, and getDoc,
   * but allows overriding autoCommit and batchedMutation for draft creation.
   */
  getTypedRefParams(): TypedRefParams<Shape> {
    return {
      shape: this.params.shape,
      placeholder: this.params.placeholder,
      getContainer: this.params.getContainer,
      autoCommit: this.params.autoCommit,
      batchedMutation: this.params.batchedMutation,
      getDoc: this.params.getDoc,
    }
  }

  /** Get the loro namespace (cached) */
  getLoroNamespace(): LoroRefBase {
    if (!this.loroNamespace) {
      this.loroNamespace = this.createLoroNamespace()
    }
    return this.loroNamespace
  }

  /** Absorb mutated plain values back into Loro containers - subclasses override */
  abstract absorbPlainValues(): void

  /** Create the loro() namespace object - subclasses override for specific types */
  protected createLoroNamespace(): LoroRefBase {
    const self = this
    return {
      get doc(): LoroDoc {
        return self.params.getDoc()
      },
      get container(): unknown {
        return self.getContainer()
      },
      subscribe(callback: (event: unknown) => void): Subscription {
        return (self.getContainer() as any).subscribe(callback)
      },
    }
  }
}

/**
 * Base class for all typed refs.
 *
 * All internal methods are accessed via [INTERNAL_SYMBOL] to prevent
 * namespace collisions with user data properties.
 *
 * Uses the Facade + Implementation pattern:
 * - TypedRef is the thin public facade
 * - BaseRefInternals subclasses contain all implementation logic
 */
export abstract class TypedRef<Shape extends DocShape | ContainerShape> {
  /**
   * Internal implementation accessed via Symbol.
   * Subclasses must set this to their specific internals class instance.
   */
  abstract [INTERNAL_SYMBOL]: BaseRefInternals<Shape>

  /**
   * Serializes the ref to a plain JSON-compatible value.
   * Returns the plain type inferred from the shape.
   */
  abstract toJSON(): Infer<Shape>

  /**
   * Access the loro() namespace via the well-known symbol.
   * This is used by the loro() function to access CRDT internals.
   */
  get [LORO_SYMBOL](): LoroRefBase {
    return this[INTERNAL_SYMBOL].getLoroNamespace()
  }
}
