/**
 * The `sync()` function - access sync/network capabilities for documents.
 *
 * Design Principle:
 * > `Doc<D>` is the public type alias for documents (simple, clean API)
 * > `sync(doc)` provides access to sync infrastructure (rare, escape hatch)
 *
 * This maintains clean separation between:
 * - `@loro-extended/change` — CRDT operations, `ext()` for forking/patches
 * - `@loro-extended/repo` — Sync/network, `sync()` for peerId/readyStates/ephemeral
 *
 * @example
 * ```typescript
 * import { sync } from "@loro-extended/repo"
 *
 * const doc = repo.get(docId, schema, { presence: PresenceSchema })
 *
 * // Access sync capabilities
 * sync(doc).peerId           // Local peer ID
 * sync(doc).docId            // Document ID
 * sync(doc).readyStates      // Sync status with channels
 * await sync(doc).waitForSync()  // Wait for sync completion
 * sync(doc).presence.setSelf({ ... })  // Ephemeral stores
 * ```
 */

import type { Logger } from "@logtape/logtape"
import type {
  DocShape,
  Infer,
  TypedDoc,
  ValueShape,
} from "@loro-extended/change"
import { createTypedDoc } from "@loro-extended/change"
import type { EphemeralStore, LoroDoc } from "loro-crdt"
import { NoAdaptersError, SyncTimeoutError } from "./sync-errors.js"
import type { Synchronizer } from "./synchronizer.js"
import { createTypedEphemeral, type TypedEphemeral } from "./typed-ephemeral.js"
import type { DocId, ReadyState } from "./types.js"
import { withTimeout } from "./utils/with-timeout.js"

// ============================================================================
// WeakMap for sync ref storage (primary storage mechanism)
// ============================================================================

/**
 * WeakMap to store SyncRef instances for documents.
 * We use a WeakMap as the primary storage mechanism because:
 * 1. TypedDoc is a Proxy that filters out Symbol properties in ownKeys
 * 2. This causes Proxy invariant violations when using non-configurable symbol properties
 * 3. WeakMap provides clean separation without modifying the TypedDoc proxy
 */
const syncRefMap = new WeakMap<object, SyncRefWithEphemerals<any>>()

/**
 * Well-known Symbol for sync() access.
 * This is exported for backward compatibility but the WeakMap is the primary storage.
 * Use the `sync()` function to access sync capabilities.
 */
export const SYNC_SYMBOL = Symbol.for("loro-extended:sync")

// ============================================================================
// SyncRef interface - what sync() returns
// ============================================================================

/**
 * Options for waitForSync().
 */
export type WaitForSyncOptions = {
  /**
   * The kind of channel to wait for.
   * @default "network"
   */
  kind?: "network" | "storage"

  /**
   * Timeout in milliseconds. Set to 0 to disable timeout.
   * @default 30000
   */
  timeout?: number

  /**
   * Optional AbortSignal for cancellation.
   * If aborted, the promise rejects with an AbortError.
   */
  signal?: AbortSignal
}

/**
 * SyncRef provides access to sync/network capabilities for a document.
 *
 * This interface is returned by `sync(doc)` and provides:
 * - `peerId` - The local peer ID
 * - `docId` - The document ID
 * - `readyStates` - Current sync status with all peers
 * - `loroDoc` - The underlying LoroDoc (for advanced use)
 * - `waitForSync()` - Wait for sync to complete
 * - `onReadyStateChange()` - Subscribe to sync status changes
 * - Ephemeral stores as properties (when declared)
 *
 * @typeParam E - Ephemeral store declarations
 */
export interface SyncRef<
  _E extends EphemeralDeclarations = Record<string, never>,
> {
  /** The local peer ID */
  readonly peerId: string

  /** The document ID */
  readonly docId: DocId

  /** Current sync status with all peers */
  readonly readyStates: ReadyState[]

  /** The underlying LoroDoc (for advanced use) */
  readonly loroDoc: LoroDoc

  /**
   * Wait for sync to complete with a peer of the specified kind.
   *
   * Resolves when we've completed the sync handshake with a peer:
   * - Received document data (peer state = "synced")
   * - Peer confirmed it doesn't have the document (peer state = "absent")
   *
   * @param options - Configuration options
   * @throws {NoAdaptersError} If no adapters of the requested kind are configured
   * @throws {SyncTimeoutError} If the timeout is reached before sync completes
   * @throws {DOMException} If the signal is aborted (name: "AbortError")
   */
  waitForSync(options?: WaitForSyncOptions): Promise<void>

  /**
   * Subscribe to ready state changes.
   * @param cb Callback that receives the new ready states
   * @returns Unsubscribe function
   */
  onReadyStateChange(cb: (readyStates: ReadyState[]) => void): () => void

  /**
   * Register an external ephemeral store for network sync.
   * Use this for libraries that bring their own EphemeralStore (like loro-prosemirror).
   *
   * @param name - The store name (namespace)
   * @param store - The EphemeralStore to register
   * @throws Error if store name already exists
   */
  addEphemeral(name: string, store: EphemeralStore): void

  /**
   * Get a raw ephemeral store by name.
   *
   * @param name - The store name
   * @returns The EphemeralStore or undefined if not found
   */
  getEphemeral(name: string): EphemeralStore | undefined

  /**
   * Get a typed ephemeral store by name.
   * This is primarily used internally - prefer accessing ephemeral stores
   * as properties (e.g., `sync(doc).presence`) when possible.
   *
   * @param name - The store name (must be a declared ephemeral store)
   * @returns The TypedEphemeral wrapper
   * @throws Error if store name is not found
   */
  getTypedEphemeral<K extends keyof _E>(name: K): TypedEphemeral<Infer<_E[K]>>
}

/**
 * SyncRef with ephemeral stores accessible as properties.
 * Each declared ephemeral store becomes a TypedEphemeral property.
 */
export type SyncRefWithEphemerals<E extends EphemeralDeclarations> =
  SyncRef<E> & {
    [K in keyof E]: TypedEphemeral<Infer<E[K]>>
  }

// ============================================================================
// Ephemeral declarations type
// ============================================================================

/**
 * Shape for ephemeral store declarations.
 * Each key becomes a TypedEphemeral property on the SyncRef.
 */
export type EphemeralDeclarations = Record<string, ValueShape>

// ============================================================================
// RepoDoc type - internal, TypedDoc with sync capabilities attached
// ============================================================================

/**
 * Internal type representing a TypedDoc with sync capabilities attached.
 * This is what `Repo.get()` actually creates internally.
 *
 * NOT exported - use `Doc<D>` for public API.
 */
export type RepoDoc<
  D extends DocShape,
  E extends EphemeralDeclarations = Record<string, never>,
> = TypedDoc<D> & {
  readonly [SYNC_SYMBOL]: SyncRefWithEphemerals<E>
}

// ============================================================================
// Doc type - public API, clean TypedDoc alias with phantom ephemeral type
// ============================================================================

/**
 * A collaborative document with sync capabilities.
 *
 * `Doc<D, E>` is the public type alias for documents returned by `repo.get()`.
 * It's a TypedDoc that can be used for reading values and mutations.
 *
 * For sync/network features, use `sync(doc)`:
 * ```typescript
 * sync(doc).peerId
 * await sync(doc).waitForSync()
 * ```
 *
 * When ephemeral stores are declared, the `E` type parameter carries that
 * information so `sync(doc)` can infer the correct ephemeral store types:
 * ```typescript
 * const doc = repo.get(docId, schema, { presence: PresenceSchema })
 * sync(doc).presence.setSelf({ ... })  // Type-safe without explicit type params
 * ```
 *
 * @typeParam D - The document shape
 * @typeParam E - The ephemeral store declarations (optional, defaults to empty)
 */
export type Doc<
  D extends DocShape,
  E extends EphemeralDeclarations = Record<string, never>,
> = TypedDoc<D> & { readonly __ephemeralType?: E }

// ============================================================================
// ExtractEphemeral - utility type for sync() to extract E from Doc<D, E>
// ============================================================================

/**
 * Extracts the ephemeral type parameter from a Doc type.
 * Used by `sync()` to infer the correct SyncRefWithEphemerals type.
 */
export type ExtractEphemeral<T> = T extends {
  __ephemeralType?: infer E extends EphemeralDeclarations
}
  ? E
  : Record<string, never>

// ============================================================================
// SyncRefImpl - implementation of SyncRef
// ============================================================================

/**
 * Implementation of SyncRef that wraps synchronizer functionality.
 */
class SyncRefImpl<E extends EphemeralDeclarations = Record<string, never>>
  implements SyncRef<E>
{
  readonly peerId: string
  readonly docId: DocId
  readonly #synchronizer: Synchronizer
  readonly #loroDoc: LoroDoc
  readonly #ephemeralShapes: E | undefined
  readonly #typedEphemeralCache: Map<string, TypedEphemeral<unknown>> =
    new Map()

  constructor(params: {
    peerId: string
    docId: DocId
    synchronizer: Synchronizer
    loroDoc: LoroDoc
    ephemeralShapes?: E
  }) {
    this.peerId = params.peerId
    this.docId = params.docId
    this.#synchronizer = params.synchronizer
    this.#loroDoc = params.loroDoc
    this.#ephemeralShapes = params.ephemeralShapes

    // Pre-create stores in Synchronizer for declared ephemeral shapes
    if (params.ephemeralShapes) {
      for (const name of Object.keys(params.ephemeralShapes)) {
        this.#synchronizer.getOrCreateNamespacedStore(params.docId, name)
      }
    }
  }

  get readyStates(): ReadyState[] {
    return this.#synchronizer.readyStates.get(this.docId) ?? []
  }

  get loroDoc(): LoroDoc {
    return this.#loroDoc
  }

  async waitForSync(options?: WaitForSyncOptions): Promise<void> {
    const kind = options?.kind ?? "network"
    const timeout = options?.timeout ?? 30_000
    const signal = options?.signal

    // Check if any adapters of the requested kind are configured
    const hasAdapterOfKind = this.#synchronizer.adapters.adapters.some(
      adapter => adapter.kind === kind,
    )

    if (!hasAdapterOfKind) {
      throw new NoAdaptersError(kind, this.docId)
    }

    // Create the predicate that checks for sync completion
    const predicate = this.#createSyncPredicate(kind)

    // Wait for sync with timeout and abort support
    const syncPromise = this.#synchronizer.waitUntilReady(this.docId, predicate)

    await withTimeout(syncPromise, {
      timeoutMs: timeout,
      signal,
      createTimeoutError: () =>
        new SyncTimeoutError(
          kind,
          timeout,
          this.docId,
          this.#synchronizer.readyStates.get(this.docId),
        ),
    })
  }

  onReadyStateChange(cb: (readyStates: ReadyState[]) => void): () => void {
    return this.#synchronizer.emitter.on("ready-state-changed", event => {
      if (event.docId === this.docId) {
        cb(event.readyStates)
      }
    })
  }

  addEphemeral(name: string, store: EphemeralStore): void {
    // Check if store already exists in Synchronizer
    const existing = this.#synchronizer.getNamespacedStore(this.docId, name)
    if (existing) {
      throw new Error(`Ephemeral store "${name}" already exists`)
    }

    // Register with synchronizer for network sync
    this.#synchronizer.registerExternalStore(this.docId, name, store)
  }

  getEphemeral(name: string): EphemeralStore | undefined {
    return this.#synchronizer.getNamespacedStore(this.docId, name)
  }

  /**
   * Get a typed ephemeral store by name.
   * Called via proxy when accessing ephemeral properties.
   */
  getTypedEphemeral<K extends keyof E>(name: K): TypedEphemeral<Infer<E[K]>> {
    if (!this.#ephemeralShapes || !(name in this.#ephemeralShapes)) {
      throw new Error(`Ephemeral store "${String(name)}" not found`)
    }

    const nameStr = name as string
    let typed = this.#typedEphemeralCache.get(nameStr)
    if (!typed) {
      const store = this.#synchronizer.getOrCreateNamespacedStore(
        this.docId,
        nameStr,
      )
      const shape = this.#ephemeralShapes[nameStr]
      typed = createTypedEphemeral(store, this.peerId, shape)
      this.#typedEphemeralCache.set(nameStr, typed)
    }
    return typed as TypedEphemeral<Infer<E[K]>>
  }

  #createSyncPredicate(
    kind: "network" | "storage",
  ): (readyStates: ReadyState[]) => boolean {
    return (readyStates: ReadyState[]): boolean =>
      readyStates.some(s => {
        // Must be a remote peer (not ourselves)
        if (s.identity.peerId === this.peerId) {
          return false
        }

        // Must have a channel of the requested kind
        const hasChannelOfRequestedKind = s.channels.some(c => c.kind === kind)
        if (!hasChannelOfRequestedKind) {
          return false
        }

        // Accept both "synced" (has data) and "absent" (confirmed no data)
        return s.status === "synced" || s.status === "absent"
      })
  }
}

/**
 * Creates a SyncRef with ephemeral stores accessible as properties via Proxy.
 */
function createSyncRef<
  E extends EphemeralDeclarations = Record<string, never>,
>(params: {
  peerId: string
  docId: DocId
  synchronizer: Synchronizer
  loroDoc: LoroDoc
  ephemeralShapes?: E
}): SyncRefWithEphemerals<E> {
  const impl = new SyncRefImpl(params)

  // If no ephemeral shapes, just return the impl (no proxy needed)
  if (!params.ephemeralShapes) {
    return impl as SyncRefWithEphemerals<E>
  }

  // Get ephemeral store keys for ownKeys trap
  const ephemeralKeys = Object.keys(params.ephemeralShapes)

  // Create a proxy to handle ephemeral store property access
  return new Proxy(impl, {
    get(target, prop, _receiver) {
      // Check if it's an ephemeral store name
      if (
        typeof prop === "string" &&
        params.ephemeralShapes &&
        prop in params.ephemeralShapes
      ) {
        return target.getTypedEphemeral(prop as keyof E)
      }

      // Get the value from target directly (not receiver) to support private fields
      const value = Reflect.get(target, prop, target)

      // If it's a function, bind it to the target to preserve private field access
      if (typeof value === "function") {
        return value.bind(target)
      }

      return value
    },

    has(target, prop) {
      if (
        typeof prop === "string" &&
        params.ephemeralShapes &&
        prop in params.ephemeralShapes
      ) {
        return true
      }
      return Reflect.has(target, prop)
    },

    ownKeys(target) {
      // Get the impl's own keys (filter out symbols)
      const implKeys = Reflect.ownKeys(target).filter(
        key => typeof key === "string",
      )
      // Add ephemeral store keys
      return [...new Set([...implKeys, ...ephemeralKeys])]
    },

    getOwnPropertyDescriptor(target, prop) {
      // For ephemeral store keys, return a descriptor
      if (typeof prop === "string" && ephemeralKeys.includes(prop)) {
        return {
          value: target.getTypedEphemeral(prop as keyof E),
          writable: false,
          enumerable: true,
          configurable: true,
        }
      }
      // Otherwise delegate to the impl
      return Reflect.getOwnPropertyDescriptor(target, prop)
    },
  }) as SyncRefWithEphemerals<E>
}

// ============================================================================
// createRepoDoc - creates a Doc with sync capabilities attached
// ============================================================================

/**
 * Parameters for creating a RepoDoc.
 */
export interface CreateRepoDocParams<
  D extends DocShape,
  E extends EphemeralDeclarations = Record<string, never>,
> {
  docId: DocId
  docShape: D
  ephemeralShapes?: E
  synchronizer: Synchronizer
  logger: Logger
}

/**
 * Creates a RepoDoc - a TypedDoc with sync capabilities attached via SYNC_SYMBOL.
 *
 * This is the internal function used by Repo.get() to create documents.
 * The returned doc:
 * - Is a TypedDoc<D> for all normal operations
 * - Has SYNC_SYMBOL attached for sync access via sync()
 *
 * @internal
 */
export function createRepoDoc<
  D extends DocShape,
  E extends EphemeralDeclarations = Record<string, never>,
>(params: CreateRepoDocParams<D, E>): RepoDoc<D, E> {
  const { docId, docShape, ephemeralShapes, synchronizer, logger } = params

  // Ensure document state exists in synchronizer
  const docState = synchronizer.getOrCreateDocumentState(docId)

  // Create TypedDoc wrapper around the LoroDoc
  // Skip auto-initialization to preserve the initializeIfEmpty pattern
  const typedDoc = createTypedDoc(docShape, {
    doc: docState.doc,
    skipInitialize: true,
  })

  // Create SyncRef with all sync capabilities
  const syncRef = createSyncRef({
    peerId: synchronizer.identity.peerId,
    docId,
    synchronizer,
    loroDoc: docState.doc,
    ephemeralShapes,
  })

  // Store SyncRef in WeakMap (primary storage)
  // This avoids Proxy invariant issues with TypedDoc's ownKeys trap
  syncRefMap.set(typedDoc, syncRef)

  // Also attach via SYNC_SYMBOL for backward compatibility and hasSync() check
  // Use configurable: true to avoid Proxy invariant violations
  const repoDoc = typedDoc as RepoDoc<D, E>
  Object.defineProperty(repoDoc, SYNC_SYMBOL, {
    value: syncRef,
    writable: false,
    enumerable: false,
    configurable: true, // Must be true to satisfy Proxy invariants
  })

  logger.with({ docId }).trace("new RepoDoc")

  return repoDoc
}

// ============================================================================
// sync() function - access sync capabilities
// ============================================================================

/**
 * Access sync/network capabilities for a document.
 *
 * Use this to access:
 * - `peerId` - The local peer ID
 * - `docId` - The document ID
 * - `readyStates` - Current sync status with all peers
 * - `loroDoc` - The underlying LoroDoc
 * - `waitForSync()` - Wait for sync to complete
 * - `onReadyStateChange()` - Subscribe to sync status changes
 * - Ephemeral stores (e.g., `sync(doc).presence`)
 *
 * @param doc - A document obtained from `repo.get()`
 * @returns SyncRef with sync capabilities
 * @throws {Error} If the document was not created via `repo.get()`
 *
 * @example
 * ```typescript
 * import { sync } from "@loro-extended/repo"
 *
 * const doc = repo.get(docId, schema)
 *
 * // Access sync capabilities
 * sync(doc).peerId
 * sync(doc).readyStates
 * await sync(doc).waitForSync()
 *
 * // With ephemeral stores
 * const doc2 = repo.get(docId, schema, { presence: PresenceSchema })
 * sync(doc2).presence.setSelf({ status: "online" })
 * ```
 */
export function sync<T extends Doc<DocShape, EphemeralDeclarations>>(
  doc: T,
): SyncRefWithEphemerals<ExtractEphemeral<T>> {
  // Try WeakMap first (primary storage)
  const syncRef = syncRefMap.get(doc) as
    | SyncRefWithEphemerals<ExtractEphemeral<T>>
    | undefined

  if (!syncRef) {
    throw new Error(
      "sync() requires a document from repo.get(). " +
        "Documents created with createTypedDoc() don't have sync capabilities. " +
        "Use repo.get(docId, schema) to get a document with sync support.",
    )
  }

  return syncRef
}

/**
 * Check if a document has sync capabilities (was created via repo.get()).
 *
 * @param doc - A document to check
 * @returns true if the document has sync capabilities
 */
export function hasSync<D extends DocShape>(doc: Doc<D>): boolean {
  return syncRefMap.has(doc)
}
