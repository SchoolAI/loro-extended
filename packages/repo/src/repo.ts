import { getLogger, type Logger } from "@logtape/logtape"
import type { DocShape } from "@loro-extended/change"
import type { AnyAdapter } from "./adapter/adapter.js"
import {
  createHandle,
  type EphemeralDeclarations,
  type HandleWithEphemerals,
} from "./handle.js"
import { createRules, type Rules } from "./rules.js"
import { type HandleUpdateFn, Synchronizer } from "./synchronizer.js"
import type { DocId, PeerIdentityDetails } from "./types.js"
import { generatePeerId } from "./utils/generate-peer-id.js"
import { validatePeerId } from "./utils/validate-peer-id.js"

export interface RepoParams {
  identity: Omit<PeerIdentityDetails, "peerId"> & { peerId?: `${number}` }
  adapters: AnyAdapter[]
  rules?: Partial<Rules>
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

  constructor({ identity, adapters, rules, onUpdate }: RepoParams) {
    // Validate peerId if provided, otherwise generate one
    const peerId = identity.peerId ?? generatePeerId()
    validatePeerId(peerId)

    // Ensure identity has both peerId and name
    this.identity = { ...identity, peerId }

    const logger = getLogger(["@loro-extended", "repo"]).with({
      identity: this.identity,
    })
    this.logger = logger

    logger.debug("new Repo: {identity}", { identity: this.identity })

    // Instantiate synchronizer
    const synchronizer = new Synchronizer({
      identity: this.identity,
      adapters,
      rules: createRules(rules),
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
   */
  reset(): void {
    // Clear synchronizer model
    this.#synchronizer.reset()
  }

  // For debugging/testing purposes
  get synchronizer() {
    return this.#synchronizer
  }
}
