import type { LoroDoc } from "loro-crdt"
import { EXT_SYMBOL, type ExtRefBase } from "../ext.js"
import { LORO_SYMBOL } from "../loro.js"
import { buildRootContainerName } from "../path-encoding.js"
import type { ContainerShape, DocShape, ShapeToContainer } from "../shape.js"
import type { Infer } from "../types.js"

/**
 * Symbol for internal methods that should not be enumerable or accessible to users.
 * Used to hide implementation details like getTypedRefParams(), finalizeTransaction(), etc.
 *
 * This achieves Success Criteria #7 from loro-api-refactor.md:
 * "Internal methods hidden - Via Symbol, not enumerable"
 */
export const INTERNAL_SYMBOL = Symbol.for("loro-extended:internal")

// ============================================================================
// Minimal Interface for ref internals contract
// ============================================================================

/**
 * Minimal interface for ref internals.
 * Used by TreeNodeRef which doesn't extend TypedRef.
 */
export interface RefInternalsBase {
  /** Force materialization of the container and its nested containers */
  materialize(): void
  /** Optional cleanup after change() completes (e.g., clear caches) */
  finalizeTransaction?(): void
}

// ============================================================================
// TypedRefParams and TypedRef Base Class
// ============================================================================

export type { DiffOverlay } from "../diff-overlay.js"

// Re-export so typed-refs/index.ts and other internal consumers can import from here
import type { DiffOverlay } from "../diff-overlay.js"

export type TypedRefParams<Shape extends DocShape | ContainerShape> = {
  shape: Shape
  placeholder?: Infer<Shape>
  getContainer: () => ShapeToContainer<Shape>
  autoCommit?: boolean // Auto-commit after mutations
  batchedMutation?: boolean // True when inside change() block - enables value shape caching for find-and-mutate patterns
  getDoc: () => LoroDoc // Needed for auto-commit
  overlay?: DiffOverlay // Optional reverse diff overlay for "before" reads
  /**
   * Path prefix for flattened root container storage (mergeable containers).
   * When set, child containers are stored at the document root with path-based names.
   * Example: pathPrefix = ["data", "nested"] means child "items" becomes root container "data-nested-items"
   */
  pathPrefix?: string[]
  /**
   * Whether this ref is part of a mergeable document.
   * When true, containers use flattened root storage for deterministic IDs.
   */
  mergeable?: boolean
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
  protected extNamespace: ExtRefBase | undefined
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

  /**
   * Execute a function with auto-commit suppressed, then commit once at the end.
   * This batches multiple mutations into a single commit to avoid intermediate
   * subscription notifications with partial data.
   *
   * Reentrant-safe: if auto-commit is already suppressed (e.g., nested call),
   * the inner call runs without double-restoring.
   */
  withBatchedCommit(fn: () => void): void {
    const wasSuppressed = this._suppressAutoCommit
    if (!wasSuppressed) {
      this._suppressAutoCommit = true
    }
    try {
      fn()
    } finally {
      if (!wasSuppressed) {
        this._suppressAutoCommit = false
      }
    }
    this.commitIfAuto()
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

  /** Get the diff overlay map (if provided) */
  getOverlay(): DiffOverlay | undefined {
    return this.params.overlay
  }

  /** Get the path prefix for flattened root container storage */
  getPathPrefix(): string[] | undefined {
    return this.params.pathPrefix
  }

  /** Check if this ref is part of a mergeable document */
  isMergeable(): boolean {
    return !!this.params.mergeable
  }

  /**
   * Compute the root container name for a child key.
   * Used when mergeable is true to create flattened root containers.
   *
   * @param key - The child key to append to the path
   * @returns The encoded root container name
   */
  computeChildRootContainerName(key: string): string {
    const prefix = this.params.pathPrefix || []
    return buildRootContainerName([...prefix, key])
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
      overlay: this.params.overlay,
      pathPrefix: this.params.pathPrefix,
      mergeable: this.params.mergeable,
    }
  }

  /** Get the ext namespace (cached) */
  getExtNamespace(): ExtRefBase {
    if (!this.extNamespace) {
      this.extNamespace = this.createExtNamespace()
    }
    return this.extNamespace
  }

  /** Optional cleanup after change() completes - subclasses override if needed */
  finalizeTransaction?(): void

  /** Force materialization of the container and its nested containers */
  materialize(): void {
    this.getContainer()
  }

  /** Create the ext() namespace object - subclasses override for specific types */
  protected createExtNamespace(): ExtRefBase {
    const self = this
    return {
      get doc(): LoroDoc {
        return self.params.getDoc()
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
   * Access the native Loro container via the well-known symbol.
   * This is used by the loro() function to access the container directly.
   */
  get [LORO_SYMBOL](): ShapeToContainer<Shape> {
    return this[INTERNAL_SYMBOL].getContainer()
  }

  /**
   * Access the ext() namespace via the well-known symbol.
   * This is used by the ext() function to access loro-extended features.
   */
  get [EXT_SYMBOL](): ExtRefBase {
    return this[INTERNAL_SYMBOL].getExtNamespace()
  }
}
