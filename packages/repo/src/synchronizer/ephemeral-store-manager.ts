import type { Logger } from "@logtape/logtape"
import type { EphemeralStore } from "loro-crdt"
import type { EphemeralStoreData } from "../channel.js"
import type { DocId, PeerID, PeerIdentityDetails } from "../types.js"
import { TimerlessEphemeralStore } from "../utils/timerless-ephemeral-store.js"

/**
 * EphemeralStoreManager - Manages namespaced ephemeral stores for documents
 *
 * Each document can have multiple named ephemeral stores (e.g., 'presence', 'cursors').
 * This supports both internal stores (created via getOrCreate) and external stores
 * (registered via registerExternal, e.g., from loro-prosemirror).
 *
 * @example
 * ```typescript
 * const manager = new EphemeralStoreManager(
 *   identity,
 *   (docId, namespace) => dispatch({ type: 'ephemeral-local-change', docId, namespace }),
 *   logger
 * )
 *
 * // Get or create a store
 * const presenceStore = manager.getOrCreate('doc-1', 'presence')
 * presenceStore.set('cursor', { x: 10, y: 20 })
 *
 * // Register an external store
 * manager.registerExternal('doc-1', 'prosemirror', externalStore)
 *
 * // Encode all stores for transmission
 * const encoded = manager.encodeAll('doc-1')
 * ```
 */
export class EphemeralStoreManager {
  /**
   * Per-doc namespaced ephemeral stores.
   * Structure: Map<DocId, Map<Namespace, EphemeralStore>>
   */
  readonly stores = new Map<DocId, Map<string, EphemeralStore>>()

  /**
   * External store subscriptions for cleanup.
   * Maps store to its unsubscribe function.
   */
  readonly #subscriptions = new Map<EphemeralStore, () => void>()

  readonly #identity: PeerIdentityDetails
  readonly #onLocalChange: (docId: DocId, namespace: string) => void
  readonly #logger: Logger

  /**
   * Create a new EphemeralStoreManager.
   *
   * @param identity - Our peer identity (for peerId in encoded data)
   * @param onLocalChange - Callback when a local change is made to any store
   * @param logger - Logger for debugging
   */
  constructor(
    identity: PeerIdentityDetails,
    onLocalChange: (docId: DocId, namespace: string) => void,
    logger: Logger,
  ) {
    this.#identity = identity
    this.#onLocalChange = onLocalChange
    this.#logger = logger
  }

  /**
   * Get or create a namespaced ephemeral store for a document.
   *
   * @param docId - The document ID
   * @param namespace - The store namespace (e.g., 'presence', 'cursors')
   * @returns The ephemeral store for this namespace
   */
  getOrCreate(docId: DocId, namespace: string): EphemeralStore {
    let namespaceStores = this.stores.get(docId)
    if (!namespaceStores) {
      namespaceStores = new Map()
      this.stores.set(docId, namespaceStores)
    }

    let store = namespaceStores.get(namespace)
    if (!store) {
      // Create a new TimerlessEphemeralStore for internal stores
      store = new TimerlessEphemeralStore()
      namespaceStores.set(namespace, store)

      // Subscribe to changes and broadcast
      this.#subscribeToStore(docId, namespace, store)

      this.#logger.debug(
        "Created namespaced store {namespace} for doc {docId}",
        { namespace, docId },
      )
    }

    return store
  }

  /**
   * Register an external ephemeral store for network sync.
   * Use this for libraries that bring their own EphemeralStore (like loro-prosemirror).
   *
   * @param docId - The document ID
   * @param namespace - The store namespace
   * @param store - The external EphemeralStore to register
   * @throws Error if a store with this namespace already exists
   */
  registerExternal(docId: DocId, namespace: string, store: EphemeralStore): void {
    let namespaceStores = this.stores.get(docId)
    if (!namespaceStores) {
      namespaceStores = new Map()
      this.stores.set(docId, namespaceStores)
    }

    if (namespaceStores.has(namespace)) {
      throw new Error(
        `Ephemeral store "${namespace}" already exists for doc "${docId}"`,
      )
    }

    namespaceStores.set(namespace, store)

    // Subscribe to changes and broadcast
    this.#subscribeToStore(docId, namespace, store)

    this.#logger.debug("Registered external store {namespace} for doc {docId}", {
      namespace,
      docId,
    })
  }

  /**
   * Get a namespaced store by name.
   *
   * @param docId - The document ID
   * @param namespace - The store namespace
   * @returns The EphemeralStore or undefined if not found
   */
  get(docId: DocId, namespace: string): EphemeralStore | undefined {
    return this.stores.get(docId)?.get(namespace)
  }

  /**
   * Encode all namespaced stores for a document.
   * Returns an array of store data for each store with data.
   *
   * @param docId - The document ID
   * @returns Array of encoded store data
   */
  encodeAll(docId: DocId): EphemeralStoreData[] {
    const result: EphemeralStoreData[] = []

    const namespaceStores = this.stores.get(docId)
    if (namespaceStores) {
      for (const [namespace, store] of namespaceStores) {
        // Touch the store to update timestamps before encoding
        if (store instanceof TimerlessEphemeralStore) {
          store.touch()
        }
        const data = store.encodeAll()
        if (data.length > 0) {
          result.push({
            peerId: this.#identity.peerId,
            data,
            namespace,
          })
        }
      }
    }

    return result
  }

  /**
   * Apply ephemeral data from a remote peer.
   *
   * @param docId - The document ID
   * @param storeData - The store data to apply
   */
  applyRemote(docId: DocId, storeData: EphemeralStoreData): void {
    const { peerId, data, namespace } = storeData

    if (!namespace) {
      this.#logger.warn(
        "applyRemote: received message without namespace from {peerId} in {docId}, ignoring",
        { peerId, docId },
      )
      return
    }

    if (data.length === 0) {
      // Empty data - could indicate deletion, but for namespaced stores
      // we don't delete the whole store, just let the data expire
      this.#logger.debug(
        "applyRemote: received empty data for namespace {namespace} from {peerId} in {docId}",
        { namespace, peerId, docId },
      )
      return
    }

    // Get or create the namespaced store and apply the data
    const store = this.getOrCreate(docId, namespace)
    store.apply(data)

    this.#logger.trace(
      "applyRemote: applied {dataLength} bytes to namespace {namespace} from {peerId} in {docId}",
      { namespace, peerId, docId, dataLength: data.length },
    )
  }

  /**
   * Remove a peer's data from all documents' namespaced stores.
   *
   * @param peerId - The peer ID to remove
   * @returns Array of { docId, namespace } for stores that had data removed
   */
  removePeer(peerId: PeerID): { docId: DocId; namespace: string }[] {
    const removed: { docId: DocId; namespace: string }[] = []

    for (const [docId, namespaceStores] of this.stores) {
      for (const [namespace, store] of namespaceStores) {
        const allStates = store.getAllStates()
        if (allStates[peerId] !== undefined) {
          store.delete(peerId)
          removed.push({ docId, namespace })
        }
      }
    }

    return removed
  }

  /**
   * Get all namespaces for a document.
   *
   * @param docId - The document ID
   * @returns Array of namespace names
   */
  getNamespaces(docId: DocId): string[] {
    const namespaceStores = this.stores.get(docId)
    return namespaceStores ? Array.from(namespaceStores.keys()) : []
  }

  /**
   * Touch all stores for a document to refresh timestamps.
   * Used before encoding for heartbeat.
   *
   * @param docId - The document ID
   */
  touchAll(docId: DocId): void {
    const namespaceStores = this.stores.get(docId)
    if (namespaceStores) {
      for (const store of namespaceStores.values()) {
        if (store instanceof TimerlessEphemeralStore) {
          store.touch()
        }
      }
    }
  }

  /**
   * Unsubscribe from all stores and clean up.
   */
  unsubscribeAll(): void {
    for (const unsub of this.#subscriptions.values()) {
      unsub()
    }
    this.#subscriptions.clear()
  }

  /**
   * Subscribe to a namespaced store and set up broadcasting.
   *
   * Uses the EphemeralStore.subscribe() callback's `by` field to filter:
   * - `by: 'local'` → broadcast (change was made via `set()`)
   * - `by: 'import'` → don't broadcast (change came from network via `apply()`)
   */
  #subscribeToStore(docId: DocId, namespace: string, store: EphemeralStore): void {
    const unsub = store.subscribe(event => {
      // Only broadcast local changes (not imported data from network)
      if (event.by === "local") {
        this.#onLocalChange(docId, namespace)
      }
    })

    // Store the unsubscribe function for cleanup
    this.#subscriptions.set(store, unsub)
  }
}
