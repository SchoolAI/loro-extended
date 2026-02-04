import { getLogger, type Logger } from "@logtape/logtape"
import type { DocShape, Infer, ValueShape } from "@loro-extended/change"
import {
  compileToJsonPath,
  createPathBuilder,
  createTypedDoc,
  evaluatePath,
  ext,
  hasWildcard,
  loro,
  type PathBuilder,
  type PathSelector,
  type TypedDoc,
} from "@loro-extended/change"
import type { EphemeralStore, Listener, LoroDoc, Value } from "loro-crdt"
import type { Synchronizer } from "./synchronizer.js"
import type { DocId, ReadyState } from "./types.js"
import { equal } from "./utils/equal.js"
import { withTimeout } from "./utils/with-timeout.js"

/**
 * Custom predicate for determining readiness.
 */
export type ReadinessCheck = (readyStates: ReadyState[]) => boolean

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
 * Error thrown when waitForSync() times out.
 */
export class SyncTimeoutError extends Error {
  constructor(
    public readonly kind: "network" | "storage",
    public readonly timeoutMs: number,
    public readonly docId: string,
    public readonly lastSeenStates?: ReadyState[],
  ) {
    super(
      `waitForSync({ kind: '${kind}' }) timed out after ${timeoutMs}ms for document '${docId}'. ` +
        `No ${kind} peer completed sync within the timeout period.`,
    )
    this.name = "SyncTimeoutError"
  }
}

/**
 * Error thrown when waitForSync() is called but no adapters of the requested kind exist.
 */
export class NoAdaptersError extends Error {
  constructor(
    public readonly kind: "network" | "storage",
    public readonly docId: string,
  ) {
    super(
      `waitForSync({ kind: '${kind}' }) called for document '${docId}' but no ${kind} adapters are configured. ` +
        `Add a ${kind} adapter to the Repo before calling waitForSync().`,
    )
    this.name = "NoAdaptersError"
  }
}

/**
 * Shape for ephemeral store declarations.
 * Each key becomes a TypedEphemeral property on the handle.
 */
export type EphemeralDeclarations = Record<string, ValueShape>

/**
 * TypedEphemeral provides type-safe access to an ephemeral store.
 * All ephemeral stores are shared key-value stores where keys can be anything
 * (often peerIds, but not required).
 */
export interface TypedEphemeral<T> {
  // ═══════════════════════════════════════════════════════════════
  // Core API - Shared key-value store
  // ═══════════════════════════════════════════════════════════════

  /** Set a value for any key */
  set(key: string, value: T): void

  /** Get a value by key */
  get(key: string): T | undefined

  /** Get all key-value pairs */
  getAll(): Map<string, T>

  /** Delete a key */
  delete(key: string): void

  // ═══════════════════════════════════════════════════════════════
  // Convenience API - For the common per-peer pattern
  // ═══════════════════════════════════════════════════════════════

  /** Get my value: equivalent to get(myPeerId) */
  readonly self: T | undefined

  /** Set my value: equivalent to set(myPeerId, value) */
  setSelf(value: T): void

  /** Get all peers except me */
  readonly peers: Map<string, T>

  // ═══════════════════════════════════════════════════════════════
  // Subscription
  // ═══════════════════════════════════════════════════════════════

  /** Subscribe to changes */
  subscribe(
    cb: (event: {
      key: string
      value: T | undefined
      source: "local" | "remote" | "initial"
    }) => void,
  ): () => void

  // ═══════════════════════════════════════════════════════════════
  // Escape Hatch
  // ═══════════════════════════════════════════════════════════════

  /** Access the underlying loro-crdt EphemeralStore */
  readonly raw: EphemeralStore
}

/**
 * Creates a TypedEphemeral wrapper around an EphemeralStore.
 *
 * Note: Broadcasting is handled automatically by the Synchronizer's subscription
 * to the store. When store.set() is called, the subscription fires with
 * by='local' and triggers the broadcast.
 */
export function createTypedEphemeral<T>(
  store: EphemeralStore,
  myPeerId: string,
  _shape: ValueShape, // For future validation
): TypedEphemeral<T> {
  return {
    set(key: string, value: T): void {
      store.set(key, value as Value)
    },

    get(key: string): T | undefined {
      return store.get(key) as T | undefined
    },

    getAll(): Map<string, T> {
      const states = store.getAllStates()
      const result = new Map<string, T>()
      for (const [key, value] of Object.entries(states)) {
        result.set(key, value as T)
      }
      return result
    },

    delete(key: string): void {
      store.delete(key)
    },

    get self(): T | undefined {
      return store.get(myPeerId) as T | undefined
    },

    setSelf(value: T): void {
      store.set(myPeerId, value as Value)
    },

    get peers(): Map<string, T> {
      const states = store.getAllStates()
      const result = new Map<string, T>()
      for (const [key, value] of Object.entries(states)) {
        if (key !== myPeerId) {
          result.set(key, value as T)
        }
      }
      return result
    },

    subscribe(
      cb: (event: {
        key: string
        value: T | undefined
        source: "local" | "remote" | "initial"
      }) => void,
    ): () => void {
      // Track previous state to detect actual changes
      let previousStates: Record<string, unknown> = {}

      // Call immediately with current state for each key
      const initialStates = store.getAllStates()
      for (const [key, value] of Object.entries(initialStates)) {
        cb({ key, value: value as T, source: "initial" })
      }
      previousStates = { ...initialStates }

      // Subscribe to future changes
      return store.subscribe(event => {
        const source = event.by === "local" ? "local" : "remote"
        const currentStates = store.getAllStates()

        // Find keys that were added or changed
        for (const [key, value] of Object.entries(currentStates)) {
          const prevValue = previousStates[key]
          if (!equal(value, prevValue)) {
            cb({ key, value: value as T, source })
          }
        }

        // Find keys that were deleted
        for (const key of Object.keys(previousStates)) {
          if (!(key in currentStates)) {
            cb({ key, value: undefined, source })
          }
        }

        // Update previous state
        previousStates = { ...currentStates }
      })
    },

    get raw(): EphemeralStore {
      return store
    },
  }
}

/**
 * Parameters for creating a Handle.
 */
type HandleParams<D extends DocShape, E extends EphemeralDeclarations> = {
  docId: DocId
  docShape: D
  ephemeralShapes?: E
  synchronizer: Synchronizer
  logger?: Logger
}

/**
 * A unified handle to a Loro document with typed ephemeral stores.
 *
 * This class provides:
 * - Type-safe document access via `.doc` (always a TypedDoc)
 * - Type-safe ephemeral store access via declared store names
 * - External store integration via `addEphemeral()` / `getEphemeral()`
 * - Sync infrastructure (readyStates, waitUntilReady, etc.)
 *
 * The Handle delegates ephemeral store management to the Synchronizer,
 * which is the single source of truth for all stores.
 *
 * @typeParam D - The document shape (use Shape.any() for untyped)
 * @typeParam E - The ephemeral store declarations
 */
export class Handle<
  D extends DocShape,
  E extends EphemeralDeclarations = Record<string, never>,
> {
  /**
   * The document ID.
   */
  public readonly docId: DocId

  /**
   * The peer ID of the local peer.
   */
  public readonly peerId: string

  /**
   * The Synchronizer for network operations.
   * This is the single source of truth for ephemeral stores.
   */
  private readonly synchronizer: Synchronizer

  /**
   * Logger instance.
   */
  private readonly logger: Logger

  /**
   * The document shape.
   */
  private readonly _docShape: D

  /**
   * The typed document.
   */
  private readonly _doc: TypedDoc<D>

  /**
   * Ephemeral shapes for declared stores.
   * Used to create TypedEphemeral wrappers on-demand.
   */
  private readonly _ephemeralShapes: E | undefined

  /**
   * Cache for TypedEphemeral wrappers.
   * Created on-demand and cached for performance.
   */
  private readonly _typedEphemeralCache: Map<string, TypedEphemeral<unknown>> =
    new Map()

  constructor({
    docId,
    docShape,
    ephemeralShapes,
    synchronizer,
    logger,
  }: HandleParams<D, E>) {
    this.docId = docId
    this.synchronizer = synchronizer
    this.peerId = synchronizer.identity.peerId
    this._docShape = docShape
    this._ephemeralShapes = ephemeralShapes

    this.logger = (logger ?? getLogger(["@loro-extended", "repo"])).with({
      docId,
    })

    // Ensure document state exists
    const docState = synchronizer.getOrCreateDocumentState(docId)

    // Create TypedDoc wrapper around the LoroDoc
    // Skip auto-initialization because:
    // 1. If doc already has metadata (from sync), it won't write anyway
    // 2. If doc is new, user can call handle.doc.initialize() when ready
    // 3. This preserves the initializeIfEmpty pattern
    this._doc = createTypedDoc(docShape, {
      doc: docState.doc,
      skipInitialize: true,
    })

    // Pre-create stores in Synchronizer for declared ephemeral shapes
    // This ensures the stores exist and are subscribed for network sync
    if (ephemeralShapes) {
      for (const name of Object.keys(ephemeralShapes)) {
        synchronizer.getOrCreateNamespacedStore(docId, name)
      }
    }

    this.logger.trace("new Handle")
  }

  /**
   * Get or create a TypedEphemeral wrapper for a store.
   * The wrapper is cached for performance.
   */
  private _getOrCreateTypedEphemeral<T>(
    name: string,
    shape: ValueShape,
  ): TypedEphemeral<T> {
    let typed = this._typedEphemeralCache.get(name)
    if (!typed) {
      const store = this.synchronizer.getOrCreateNamespacedStore(
        this.docId,
        name,
      )
      typed = createTypedEphemeral(store, this.peerId, shape)
      this._typedEphemeralCache.set(name, typed)
    }
    return typed as TypedEphemeral<T>
  }

  // ═══════════════════════════════════════════════════════════════
  // Document Access
  // ═══════════════════════════════════════════════════════════════

  /**
   * The strongly-typed document.
   * Always returns a TypedDoc - use Shape.any() for untyped access.
   * Access raw LoroDoc via getLoroDoc() for untyped operations.
   */
  get doc(): TypedDoc<D> {
    return this._doc
  }

  /**
   * Get the underlying LoroDoc for direct, untyped access.
   * Use this when you need to perform operations not supported by the typed API,
   * or when working with Shape.any() documents.
   *
   * @returns The raw LoroDoc instance
   *
   * @example
   * ```typescript
   * const handle = repo.get('my-doc', Shape.any())
   * handle.loroDoc.getMap('root').set('key', 'value')
   * ```
   */
  get loroDoc(): LoroDoc {
    return loro(this._doc)
  }

  /**
   * Whether this document uses mergeable (flattened) storage.
   * This is the effective value computed from metadata > schema > false.
   *
   * @returns true if the document uses mergeable storage
   */
  get isMergeable(): boolean {
    return ext(this._doc).mergeable
  }

  // ═══════════════════════════════════════════════════════════════
  // Document Subscriptions
  // ═══════════════════════════════════════════════════════════════

  /**
   * Subscribe to all changes on the document.
   *
   * The listener receives a `LoroEventBatch` from loro-crdt containing:
   * - `by`: The origin of the change ("local", "import", or "checkout")
   * - `origin`: Optional string identifying the change source
   * - `currentTarget`: The container ID of the event receiver (undefined for root doc)
   * - `events`: Array of `LoroEvent` objects with container diffs
   * - `from`: The frontiers before the change
   * - `to`: The frontiers after the change
   *
   * @param listener - Callback invoked on each document change
   * @returns Unsubscribe function
   */
  subscribe(listener: Listener): () => void

  /**
   * Subscribe to changes at a specific path using the type-safe DSL.
   *
   * The callback receives:
   * - `value`: The current value at the path (properly typed)
   * - `prev`: The previous value (undefined on first call)
   *
   * This uses two-stage filtering:
   * 1. WASM-side: subscribeJsonpath for efficient path matching
   * 2. JS-side: Deep equality check to filter false positives
   *
   * @param selector - Path selector function using the DSL
   * @param listener - Callback receiving the typed value and previous value
   * @returns Unsubscribe function
   *
   * @example
   * ```typescript
   * handle.subscribe(
   *   p => p.books.$each.title,
   *   (titles, prev) => {
   *     console.log("Titles changed from", prev, "to", titles)
   *   }
   * )
   * ```
   */
  subscribe<T>(
    selector: (path: PathBuilder<D>) => PathSelector<T>,
    listener: (value: T, prev: T | undefined) => void,
  ): () => void

  /**
   * Subscribe to changes that may affect a JSONPath query (escape hatch).
   *
   * Use this for complex queries not expressible in the DSL (filters, etc.).
   * Note: No type safety - callback receives unknown[].
   *
   * @param jsonpath - JSONPath expression (e.g., "$.users[*].name")
   * @param listener - Callback receiving the query result
   * @returns Unsubscribe function
   *
   * @example
   * ```typescript
   * // Subscribe to changes affecting books with price > 10
   * const unsubscribe = handle.subscribe(
   *   "$.books[?@.price>10].title",
   *   (titles) => {
   *     console.log("Expensive book titles:", titles);
   *   }
   * );
   * ```
   */
  subscribe(jsonpath: string, listener: (value: unknown[]) => void): () => void

  // Implementation of subscribe overloads
  subscribe(
    listenerOrSelectorOrJsonpath:
      | Listener
      | ((path: PathBuilder<D>) => PathSelector<unknown>)
      | string,
    pathListener?:
      | ((value: unknown, prev: unknown | undefined) => void)
      | ((value: unknown[]) => void),
  ): () => void {
    // Case 1: Regular subscription (all changes)
    // A regular Listener takes 1 argument and has no second argument
    // A path selector function also takes 1 argument but MUST have a second argument (the listener)
    if (typeof listenerOrSelectorOrJsonpath === "function" && !pathListener) {
      return loro(this._doc).subscribe(listenerOrSelectorOrJsonpath as Listener)
    }

    // Case 2: Raw JSONPath string (escape hatch)
    if (typeof listenerOrSelectorOrJsonpath === "string") {
      const jsonpath = listenerOrSelectorOrJsonpath
      const loroDoc = loro(this._doc)

      if (!pathListener) {
        throw new Error("JSONPath subscription requires a listener callback")
      }

      const wrappedCallback = () => {
        const value = loroDoc.JSONPath(jsonpath)
        ;(pathListener as (value: unknown[]) => void)(value)
      }

      return loroDoc.subscribeJsonpath(jsonpath, wrappedCallback)
    }

    // Case 3: Type-safe path selector DSL
    const selectorFn = listenerOrSelectorOrJsonpath as (
      path: PathBuilder<D>,
    ) => PathSelector<unknown>
    const listener = pathListener as (
      value: unknown,
      prev: unknown | undefined,
    ) => void

    if (!listener) {
      throw new Error("Path selector subscription requires a listener callback")
    }

    const pathBuilder = createPathBuilder(this._docShape)
    const selector = selectorFn(pathBuilder)
    const jsonpath = compileToJsonPath(selector.__segments)
    const needsDeepEqual = hasWildcard(selector.__segments)

    // Establish initial previousValue baseline synchronously
    // This is critical for detecting if the first signaled event is a genuine change
    let previousValue: unknown = evaluatePath(this._doc, selector)

    const wrappedCallback = () => {
      const newValue = evaluatePath(this._doc, selector)

      // For paths with wildcards, we need deep equality to filter false positives
      // For exact paths, subscribeJsonpath is already precise
      if (needsDeepEqual && equal(newValue, previousValue)) {
        return // False positive, skip callback
      }

      const prev = previousValue
      previousValue = newValue
      listener(newValue, prev)
    }

    return loro(this._doc).subscribeJsonpath(jsonpath, wrappedCallback)
  }

  /**
   * Execute a JSONPath query against the document.
   *
   * This is a general-purpose method for querying the document with full
   * JSONPath expressiveness. Use this for ad-hoc queries or within callbacks.
   *
   * @example
   * ```typescript
   * const expensiveBooks = handle.jsonPath("$.books[?@.price>10]")
   * const allTitles = handle.jsonPath("$..title")
   * ```
   */
  jsonPath(path: string): unknown[] {
    return loro(this._doc).JSONPath(path)
  }

  // ═══════════════════════════════════════════════════════════════
  // Ephemeral Store Access
  // ═══════════════════════════════════════════════════════════════

  /**
   * Get a typed ephemeral store by name.
   * Only works for stores declared in ephemeralShapes.
   */
  getTypedEphemeral<K extends keyof E>(name: K): TypedEphemeral<Infer<E[K]>> {
    if (!this._ephemeralShapes || !(name in this._ephemeralShapes)) {
      throw new Error(`Ephemeral store "${String(name)}" not found`)
    }
    const shape = this._ephemeralShapes[name as string]
    return this._getOrCreateTypedEphemeral(name as string, shape)
  }

  /**
   * Add an external ephemeral store for network sync.
   * Use this for libraries that bring their own EphemeralStore (like loro-prosemirror).
   *
   * @param name - The store name (namespace)
   * @param store - The EphemeralStore to register
   */
  addEphemeral(name: string, store: EphemeralStore): void {
    // Check if store already exists in Synchronizer
    const existing = this.synchronizer.getNamespacedStore(this.docId, name)
    if (existing) {
      throw new Error(`Ephemeral store "${name}" already exists`)
    }

    // Register with synchronizer for network sync
    this.synchronizer.registerExternalStore(this.docId, name, store)

    this.logger.debug("Added external ephemeral store: {name}", { name })
  }

  /**
   * Get a raw ephemeral store by name.
   * Delegates to Synchronizer which is the single source of truth.
   *
   * @param name - The store name
   * @returns The EphemeralStore or undefined if not found
   */
  getEphemeral(name: string): EphemeralStore | undefined {
    return this.synchronizer.getNamespacedStore(this.docId, name)
  }

  // ═══════════════════════════════════════════════════════════════
  // Sync Infrastructure
  // ═══════════════════════════════════════════════════════════════

  /**
   * Get the current ready states for this document.
   */
  get readyStates(): ReadyState[] {
    return this.synchronizer.readyStates.get(this.docId) ?? []
  }

  /**
   * Subscribe to ready state changes.
   * @param cb Callback that receives the new ready states
   * @returns Unsubscribe function
   */
  onReadyStateChange(cb: (readyStates: ReadyState[]) => void): () => void {
    return this.synchronizer.emitter.on("ready-state-changed", event => {
      if (event.docId === this.docId) {
        cb(event.readyStates)
      }
    })
  }

  /**
   * Wait until the document meets custom readiness criteria.
   * @param predicate Function that determines if the document is ready
   */
  async waitUntilReady(predicate: ReadinessCheck): Promise<Handle<D, E>> {
    await this.synchronizer.waitUntilReady(this.docId, predicate)
    return this
  }

  /**
   * Wait for sync to complete with a peer of the specified kind.
   *
   * Resolves when we've completed the sync handshake with a peer:
   * - Received document data (peer state = "loaded")
   * - Peer confirmed it doesn't have the document (peer state = "absent")
   *
   * This enables the common "initializeIfEmpty" pattern:
   * ```typescript
   * await handle.waitForSync()
   * if (handle.loroDoc.opCount() === 0) {
   *   // Server doesn't have it, safe to initialize
   *   initializeDocument(handle)
   * }
   * ```
   *
   * @param options - Configuration options
   * @param options.kind - The kind of channel to wait for ("network" or "storage"). Default: "network"
   * @param options.timeout - Timeout in milliseconds. Set to 0 to disable. Default: 30000
   * @param options.signal - Optional AbortSignal for cancellation
   * @throws {NoAdaptersError} If no adapters of the requested kind are configured
   * @throws {SyncTimeoutError} If the timeout is reached before sync completes
   * @throws {DOMException} If the signal is aborted (name: "AbortError")
   */
  async waitForSync(options?: WaitForSyncOptions): Promise<Handle<D, E>> {
    const kind = options?.kind ?? "network"
    const timeout = options?.timeout ?? 30_000
    const signal = options?.signal

    // Check if any adapters of the requested kind are configured
    // This uses the adapter's `kind` property, not channels, to avoid
    // race conditions during startup when channels may not exist yet.
    const hasAdapterOfKind = this.synchronizer.adapters.adapters.some(
      adapter => adapter.kind === kind,
    )

    if (!hasAdapterOfKind) {
      throw new NoAdaptersError(kind, this.docId)
    }

    // Create the predicate that checks for sync completion
    const predicate = this.createSyncPredicate(kind)

    // Wait for sync with timeout and abort support
    const syncPromise = this.synchronizer.waitUntilReady(this.docId, predicate)

    await withTimeout(syncPromise, {
      timeoutMs: timeout,
      signal,
      createTimeoutError: () =>
        new SyncTimeoutError(
          kind,
          timeout,
          this.docId,
          this.synchronizer.readyStates.get(this.docId),
        ),
    })

    return this
  }

  /**
   * Creates a predicate for checking sync completion with a peer of the specified kind.
   */
  private createSyncPredicate(
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

        // Accept both "loaded" (has data) and "absent" (confirmed no data)
        // "aware" means we know they exist but haven't completed sync yet
        return s.status === "synced" || s.status === "absent"
      })
  }
}

/**
 * Type helper to extract ephemeral store types from a Handle.
 * This allows accessing declared ephemeral stores as properties.
 */
export type HandleWithEphemerals<
  D extends DocShape,
  E extends EphemeralDeclarations,
> = Handle<D, E> & {
  [K in keyof E]: TypedEphemeral<Infer<E[K]>>
}

/**
 * Creates a Handle with ephemeral stores accessible as properties.
 */
export function createHandle<
  D extends DocShape,
  E extends EphemeralDeclarations = Record<string, never>,
>(params: HandleParams<D, E>): HandleWithEphemerals<D, E> {
  const handle = new Handle(params)

  // Create a proxy that exposes ephemeral stores as properties
  return new Proxy(handle, {
    get(target, prop, receiver) {
      // Check if it's an ephemeral store name
      if (
        typeof prop === "string" &&
        params.ephemeralShapes &&
        prop in params.ephemeralShapes
      ) {
        return target.getTypedEphemeral(prop as keyof E)
      }

      // Otherwise delegate to the handle
      return Reflect.get(target, prop, receiver)
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

    // Support Object.keys() - filter out Symbol properties and include ephemeral stores
    // This prevents React's "Object keys must be strings" error and ensures
    // ephemeral stores appear in enumeration.
    ownKeys(target) {
      // Get string keys from the Handle class, filtering out Symbols
      const handleKeys = Reflect.ownKeys(target).filter(
        key => typeof key === "string",
      )

      // Add ephemeral store names if declared
      if (params.ephemeralShapes) {
        const ephemeralKeys = Object.keys(params.ephemeralShapes)
        return [...new Set([...handleKeys, ...ephemeralKeys])]
      }

      return handleKeys
    },

    getOwnPropertyDescriptor(target, prop) {
      // For ephemeral stores, return a descriptor that makes them enumerable
      if (
        typeof prop === "string" &&
        params.ephemeralShapes &&
        prop in params.ephemeralShapes
      ) {
        return {
          configurable: true,
          enumerable: true,
          value: target.getTypedEphemeral(prop as keyof E),
        }
      }
      return Reflect.getOwnPropertyDescriptor(target, prop)
    },
  }) as HandleWithEphemerals<D, E>
}
