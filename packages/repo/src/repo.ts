import { getLogger, type Logger } from "@logtape/logtape"
import { v4 as uuidv4 } from "uuid"
import type { AnyAdapter } from "./adapter/adapter.js"
import { DocHandle } from "./doc-handle.js"
import { createPermissions, type Rules } from "./rules.js"
import { type HandleUpdateFn, Synchronizer } from "./synchronizer.js"
import type { DocContent, DocId, PeerIdentityDetails } from "./types.js"

export interface RepoParams {
  adapters: AnyAdapter[]
  identity?: PeerIdentityDetails
  permissions?: Partial<Rules>
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
  readonly #handles: Map<DocId, DocHandle> = new Map()

  constructor({ identity, adapters, permissions, onUpdate }: RepoParams) {
    this.identity = identity ?? { name: uuidv4() }

    const logger = getLogger(["@loro-extended", "repo"]).with({ identity })
    this.logger = logger

    logger.debug("new Repo", { identity: this.identity })

    // Instantiate synchronizer
    const synchronizer = new Synchronizer({
      identity: this.identity,
      adapters,
      permissions: createPermissions(permissions),
      logger,
      onUpdate,
    })

    this.#synchronizer = synchronizer
  }

  //
  // PUBLIC API - Simplified with always-available documents
  //

  /**
   * Gets (or creates) a new document with an optional documentId.
   *
   * The document is immediately available for use.
   *
   * @param options Configuration options for document creation
   * @returns The DocHandle with an immediately available document
   */
  get<T extends DocContent>(docId: DocId): DocHandle<T> {
    let handle = this.#handles.get(docId)

    if (!handle) {
      handle = new DocHandle({
        docId,
        synchronizer: this.#synchronizer,
        logger: this.logger,
      })
      this.#handles.set(docId, handle)
    }

    return handle as unknown as DocHandle<T>
  }

  has(docId: DocId): boolean {
    return this.#handles.has(docId)
  }

  /**
   * Deletes a document from the repo.
   * @param documentId The ID of the document to delete
   */
  delete(docId: DocId): void {
    this.#handles.delete(docId)
    // TODO: Also remove from synchronizer and send delete messages to adapters
    // this.#synchronizer.removeDocument(docId)
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
