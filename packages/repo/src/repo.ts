import { getLogger, type Logger } from "@logtape/logtape"
import type { DocShape } from "@loro-extended/change"
import type { AnyAdapter } from "./adapter/adapter.js"
import {
  createHandle,
  type EphemeralDeclarations,
  type HandleWithEphemerals,
} from "./handle.js"
import type { Middleware } from "./middleware.js"
import { createPermissions, type Permissions } from "./permissions.js"
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
  // PUBLIC API - Unified Handle API
  //

  /**
   * Gets (or creates) a unified handle with typed document and ephemeral stores.
   *
   * This is the primary API for accessing documents. It supports:
   * - Typed documents (use Shape.any() for untyped)
   * - Multiple typed ephemeral stores
   * - External store integration via handle.addEphemeral()
   *
   * @param docId The document ID
   * @param docShape The shape of the document (use Shape.any() for untyped)
   * @param ephemeralShapes Optional ephemeral store declarations
   * @returns A Handle with typed document and ephemeral store access
   *
   * @example
   * ```typescript
   * // Typed document with typed ephemeral stores
   * const handle = repo.get('my-doc', DocSchema, {
   *   presence: PresenceSchema,
   *   cursors: CursorSchema
   * })
   * handle.change(draft => { draft.title = 'Hello' })
   * handle.presence.setSelf({ status: 'online' })
   *
   * // Untyped document with typed ephemeral stores
   * const handle = repo.get('my-doc', Shape.any(), {
   *   cursors: CursorSchema
   * })
   * handle.loroDoc.getMap('root').set('key', 'value')
   * handle.cursors.setSelf({ position: 42 })
   * ```
   */
  get<
    D extends DocShape,
    E extends EphemeralDeclarations = Record<string, never>,
  >(
    docId: DocId,
    docShape: D,
    ephemeralShapes?: E,
  ): HandleWithEphemerals<D, E> {
    return createHandle({
      docId,
      docShape,
      ephemeralShapes,
      synchronizer: this.#synchronizer,
      logger: this.logger,
    })
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
    // Clear synchronizer model
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
   * const handle = repo.get('doc', DocSchema)
   * handle.change(draft => { draft.title = 'Hello' })
   * await repo.shutdown() // Data is safely persisted
   *
   * // Session 2: load from same storage
   * const repo2 = new Repo({ adapters: [storage2] })
   * const handle2 = repo2.get('doc', DocSchema)
   * await handle2.waitForSync({ kind: 'storage' })
   * // handle2.doc.title === 'Hello' ✓
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
