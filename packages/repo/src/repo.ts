import { getLogger, type Logger } from "@logtape/logtape"
import type { DocShape, ValueShape } from "@loro-extended/change"
import type { AnyAdapter } from "./adapter/adapter.js"
import type { Middleware } from "./middleware.js"
import { createPermissions, type Permissions } from "./permissions.js"
import {
  createRepoDoc,
  type Doc,
  type RepoDoc,
  type EphemeralDeclarations as SyncEphemeralDeclarations,
} from "./sync.js"
import { type HandleUpdateFn, Synchronizer } from "./synchronizer.js"
import type { DocId, PeerIdentityDetails } from "./types.js"
import { generatePeerId } from "./utils/generate-peer-id.js"
import { validatePeerId } from "./utils/validate-peer-id.js"

export interface RepoParams {
  identity?: Partial<PeerIdentityDetails>
  adapters?: AnyAdapter[]
  /**
   * Permissions control access to documents.
   *
   * Permissions are simple, synchronous predicates that determine what peers can do.
   * For advanced use cases (rate limiting, external auth, audit logging),
   * use middleware instead.
   *
   * @example
   * ```typescript
   * const repo = new Repo({
   *   permissions: {
   *     visibility: (doc, peer) => doc.id.startsWith('public/'),
   *     mutability: (doc, peer) => peer.peerType !== 'bot',
   *     deletion: (doc, peer) => peer.peerType === 'service',
   *   }
   * })
   * ```
   */
  permissions?: Partial<Permissions>
  /**
   * Middleware for advanced access control and cross-cutting concerns.
   *
   * Middleware runs BEFORE the synchronizer processes messages, at the async boundary.
   * Use middleware for:
   * - Rate limiting
   * - Size limits
   * - External auth service integration
   * - Audit logging
   *
   * For simple permission checks, use `permissions` instead.
   *
   * @example
   * ```typescript
   * const repo = new Repo({
   *   middleware: [
   *     {
   *       name: 'rate-limiter',
   *       requires: ['peer'],
   *       check: (ctx) => {
   *         const count = getRequestCount(ctx.peer.peerId)
   *         return count < 100 ? { allow: true } : { allow: false, reason: 'rate-limited' }
   *       }
   *     }
   *   ]
   * })
   * ```
   */
  middleware?: Middleware[]
  onUpdate?: HandleUpdateFn
}

/**
 * Cache entry for document instances.
 * Stores the doc and schema for validation on subsequent get() calls.
 */
interface DocCacheEntry {
  doc: RepoDoc<any, any>
  schema: DocShape
  ephemeralShapes: Record<string, ValueShape> | undefined
}

/**
 * The Repo class is the central orchestrator for the Loro state synchronization system.
 * It manages the lifecycle of documents, coordinates subsystems, and provides the main
 * public API for document operations.
 *
 * With the simplified DocHandle architecture, Repo becomes a simpler orchestrator
 * that wires together the various subsystems without complex state management.
 *
 * Adapters are used to indicate how to retrieve doc state (updates, sync, etc.) from
 * storage or network systems.
 */
export class Repo {
  readonly logger: Logger
  readonly identity: PeerIdentityDetails

  // Subsystems
  readonly #synchronizer: Synchronizer

  // Document cache - ensures same Doc instance for same docId
  readonly #docCache: Map<DocId, DocCacheEntry> = new Map()

  constructor({
    identity = {},
    adapters = [],
    permissions,
    middleware,
    onUpdate,
  }: RepoParams = {}) {
    // Validate peerId if provided, otherwise generate one
    const peerId = identity.peerId ?? generatePeerId()
    validatePeerId(peerId)

    // Build complete identity with defaults
    this.identity = {
      peerId,
      name: identity.name, // undefined is fine - peerId is the unique identifier
      type: identity.type ?? "user",
    }

    const logger = getLogger(["@loro-extended", "repo"]).with({
      identity: this.identity,
    })
    this.logger = logger

    logger.debug("new Repo: {identity}", { identity: this.identity })

    // Instantiate synchronizer
    const synchronizer = new Synchronizer({
      identity: this.identity,
      adapters,
      permissions: createPermissions(permissions),
      middleware: middleware ?? [],
      logger,
      onUpdate,
    })

    this.#synchronizer = synchronizer
  }

  //
  // PUBLIC API - Doc API (new, recommended)
  //

  /**
   * Gets (or creates) a document with typed schema and optional ephemeral stores.
   *
   * This is the primary API for accessing documents. It supports:
   * - Typed documents (use Shape.any() for untyped)
   * - Multiple typed ephemeral stores via sync(doc)
   *
   * Returns a `Doc<D>` (or `Doc<D, E>` when ephemeral stores are provided) which
   * is a TypedDoc with sync capabilities.
   * Use `sync(doc)` to access sync features like waitForSync, readyStates, and ephemeral stores.
   *
   * @param docId The document ID
   * @param docShape The shape of the document (use Shape.any() for untyped)
   * @param ephemeralShapes Optional ephemeral store declarations
   * @returns A Doc with typed document access and sync capabilities via sync()
   *
   * @example
   * ```typescript
   * import { sync } from "@loro-extended/repo"
   *
   * // Get a typed document
   * const doc = repo.get('my-doc', DocSchema)
   * doc.title.insert(0, "Hello")  // Direct mutation
   *
   * // Access sync capabilities
   * await sync(doc).waitForSync()
   * sync(doc).readyStates
   *
   * // With ephemeral stores - sync() infers the ephemeral types automatically
   * const doc = repo.get('my-doc', DocSchema, { presence: PresenceSchema })
   * sync(doc).presence.setSelf({ status: 'online' })  // Type-safe!
   * ```
   */
  // Overload: without ephemeral stores - returns Doc<D>
  get<D extends DocShape>(docId: DocId, docShape: D): Doc<D>

  // Overload: with ephemeral stores - returns Doc<D, E> for type inference in sync()
  get<D extends DocShape, E extends SyncEphemeralDeclarations>(
    docId: DocId,
    docShape: D,
    ephemeralShapes: E,
  ): Doc<D, E>

  // Implementation
  get<D extends DocShape, E extends SyncEphemeralDeclarations>(
    docId: DocId,
    docShape: D,
    ephemeralShapes?: E,
  ): Doc<D, E> {
    // Check cache first
    const cached = this.#docCache.get(docId)

    if (cached) {
      // Validate schema matches - throw if different schema for same docId
      if (cached.schema !== docShape) {
        throw new Error(
          `Document '${docId}' already exists with a different schema. ` +
            `Use the same schema object when calling repo.get() for the same document.`,
        )
      }

      // Also check ephemeral shapes match
      const cachedEphKeys = cached.ephemeralShapes
        ? Object.keys(cached.ephemeralShapes).sort().join(",")
        : ""
      const newEphKeys = ephemeralShapes
        ? Object.keys(ephemeralShapes).sort().join(",")
        : ""

      if (cachedEphKeys !== newEphKeys) {
        throw new Error(
          `Document '${docId}' already exists with different ephemeral stores. ` +
            `Use the same ephemeral configuration when calling repo.get() for the same document.`,
        )
      }

      // RepoDoc<D, E> extends TypedDoc<D> which is Doc<D, E>
      // The cast is safe because we're just hiding the SYNC_SYMBOL from the public type
      return cached.doc as unknown as Doc<D, E>
    }

    // Create new RepoDoc and cache it
    const doc = createRepoDoc({
      docId,
      docShape,
      ephemeralShapes,
      synchronizer: this.#synchronizer,
      logger: this.logger,
    })

    this.#docCache.set(docId, {
      doc,
      schema: docShape,
      ephemeralShapes,
    })

    // RepoDoc<D, E> extends TypedDoc<D> which is Doc<D, E>
    // The cast is safe because we're just hiding the SYNC_SYMBOL from the public type
    return doc as unknown as Doc<D, E>
  }

  /**
   * Check if a document exists in the repo.
   * @param docId The document ID
   * @returns true if the document exists
   */
  has(docId: DocId): boolean {
    return this.#synchronizer.getDocumentState(docId) !== undefined
  }

  /**
   * Deletes a document from the repo.
   * @param docId The ID of the document to delete
   */
  async delete(docId: DocId): Promise<void> {
    this.#docCache.delete(docId)
    await this.#synchronizer.removeDocument(docId)
  }

  /**
   * Disconnects all network adapters and cleans up resources.
   * This should be called when the Repo is no longer needed.
   *
   * ⚠️ WARNING: This is synchronous and does NOT wait for pending storage
   * saves to complete. If you need to ensure data persistence (e.g., before
   * app shutdown or between test sessions), use {@link shutdown} instead.
   */
  reset(): void {
    this.#docCache.clear()
    this.#synchronizer.reset()
  }

  /**
   * Await all pending storage operations without disconnecting adapters.
   *
   * Use this when you want to ensure all data has been persisted but
   * plan to continue using the Repo afterwards.
   *
   * @example
   * ```typescript
   * handle.change(draft => { draft.title = 'Hello' })
   * await repo.flush() // Ensure the change is saved to storage
   * ```
   */
  async flush(): Promise<void> {
    await this.#synchronizer.flush()
  }

  /**
   * Gracefully shut down: flush all pending storage operations, then
   * disconnect all adapters and clean up resources.
   *
   * This is the recommended way to stop a Repo when using persistent
   * storage adapters. It ensures all in-flight saves complete before
   * the adapters are disconnected.
   *
   * @example
   * ```typescript
   * // Session 1: create and save
   * const repo = new Repo({ adapters: [storage] })
   * const doc = repo.get('doc', DocSchema)
   * doc.title.insert(0, 'Hello')
   * await repo.shutdown() // Data is safely persisted
   *
   * // Session 2: load from same storage
   * const repo2 = new Repo({ adapters: [storage2] })
   * const doc2 = repo2.get('doc', DocSchema)
   * await sync(doc2).waitForSync({ kind: 'storage' })
   * // doc2.title === 'Hello' ✓
   * ```
   */
  async shutdown(): Promise<void> {
    await this.#synchronizer.shutdown()
  }

  //
  // PUBLIC API - Adapter Management
  //

  /**
   * Add an adapter at runtime.
   * Idempotent: adding an adapter with the same adapterId is a no-op.
   */
  async addAdapter(adapter: AnyAdapter): Promise<void> {
    await this.#synchronizer.addAdapter(adapter)
  }

  /**
   * Remove an adapter at runtime.
   * Idempotent: removing a non-existent adapter is a no-op.
   */
  async removeAdapter(adapterId: string): Promise<void> {
    await this.#synchronizer.removeAdapter(adapterId)
  }

  /**
   * Check if an adapter exists by ID.
   */
  hasAdapter(adapterId: string): boolean {
    return this.#synchronizer.hasAdapter(adapterId)
  }

  /**
   * Get an adapter by ID.
   */
  getAdapter(adapterId: string): AnyAdapter | undefined {
    return this.#synchronizer.getAdapter(adapterId)
  }

  /**
   * Get all current adapters.
   */
  get adapters(): AnyAdapter[] {
    return this.#synchronizer.adapters.adapters
  }

  // For debugging/testing purposes
  get synchronizer() {
    return this.#synchronizer
  }
}
