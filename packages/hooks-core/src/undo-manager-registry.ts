import type { Cursor, LoroDoc, LoroEventBatch, Value } from "loro-crdt"
import { UndoManager } from "loro-crdt"
import { validateNamespaceSafe } from "./utils/validate-namespace"

/** Origin prefix for namespace-based undo */
export const NAMESPACE_ORIGIN_PREFIX = "loro-extended:ns:"

/**
 * Callback type for onPush - stores cursor state with undo step
 */
export type OnPushCallback = (
  isUndo: boolean,
  counterRange: { start: number; end: number },
  event?: LoroEventBatch,
) => { value: Value; cursors: Cursor[] }

/**
 * Callback type for onPop - restores cursor state from undo step
 */
export type OnPopCallback = (
  isUndo: boolean,
  meta: { value: Value; cursors: Cursor[] },
  counterRange: { start: number; end: number },
) => void

/**
 * Information about a registered undo manager
 */
export interface RegisteredUndoManager {
  /** The UndoManager instance */
  undoManager: UndoManager
  /** The namespace this manager handles (undefined for default) */
  namespace: string | undefined
}

/**
 * Registry for managing multiple UndoManager instances by namespace.
 * Coordinates excludeOriginPrefixes across all managers to ensure
 * namespace isolation.
 */
export class UndoManagerRegistry {
  /** Map of namespace to registered undo manager info */
  private managers = new Map<string | undefined, RegisteredUndoManager>()

  /** The LoroDoc all managers are associated with */
  private loroDoc: LoroDoc

  constructor(loroDoc: LoroDoc) {
    this.loroDoc = loroDoc
  }

  /**
   * Get or create an UndoManager for a specific namespace.
   *
   * **Important**: UndoManager's `excludeOriginPrefixes` cannot be updated after creation.
   * For proper namespace isolation, register all namespaces before making any changes.
   * If a namespace is registered after other managers exist, a warning will be logged
   * because existing managers won't exclude the new namespace's changes.
   *
   * @param namespace - The namespace for this manager (undefined for default)
   * @param options - Additional options for the UndoManager
   * @returns The UndoManager for this namespace
   */
  getOrCreate(
    namespace: string | undefined,
    options?: {
      mergeInterval?: number
      onPush?: OnPushCallback
      onPop?: OnPopCallback
    },
  ): UndoManager {
    // Validate namespace format if provided
    if (namespace !== undefined) {
      validateNamespaceSafe(namespace)
    }

    // Check if we already have a manager for this namespace
    const existing = this.managers.get(namespace)
    if (existing) {
      return existing.undoManager
    }

    // Warn if registering a new namespace after other managers exist
    // This is important because excludeOriginPrefixes cannot be updated after creation
    if (this.managers.size > 0 && namespace !== undefined) {
      console.warn(
        `[UndoManagerRegistry] Registering namespace "${namespace}" after other managers exist. ` +
          `Existing managers will not exclude this namespace's changes from their undo stacks. ` +
          `For best results, register all namespaces before making changes.`,
      )
    }

    // Calculate excludeOriginPrefixes for this new manager
    // It should exclude all OTHER namespaces
    const excludeOriginPrefixes = this.calculateExcludePrefixes(namespace)

    // Create the new UndoManager
    const undoManager = new UndoManager(this.loroDoc, {
      mergeInterval: options?.mergeInterval ?? 500,
      excludeOriginPrefixes,
      onPush: options?.onPush,
      onPop: options?.onPop,
    })

    // Register it
    this.managers.set(namespace, { undoManager, namespace })

    return undoManager
  }

  /**
   * Get an existing UndoManager for a namespace.
   *
   * @param namespace - The namespace to look up
   * @returns The UndoManager, or undefined if not found
   */
  get(namespace: string | undefined): UndoManager | undefined {
    return this.managers.get(namespace)?.undoManager
  }

  /**
   * Get all registered namespaces.
   *
   * @returns Array of all registered namespaces (including undefined for default)
   */
  getAllNamespaces(): (string | undefined)[] {
    return Array.from(this.managers.keys())
  }

  /**
   * Calculate the excludeOriginPrefixes for a new manager.
   * This includes all existing namespaces except the one being created.
   */
  private calculateExcludePrefixes(forNamespace: string | undefined): string[] {
    const prefixes: string[] = []

    for (const [ns] of this.managers) {
      // Skip the namespace we're creating a manager for
      if (ns === forNamespace) continue

      // Add the origin prefix for this namespace
      if (ns !== undefined) {
        prefixes.push(`${NAMESPACE_ORIGIN_PREFIX}${ns}`)
      }
    }

    return prefixes
  }

  /**
   * Clear all registered managers.
   */
  clear(): void {
    this.managers.clear()
  }
}
