import { v4 as uuidv4 } from "uuid"
import type { AnyAdapter } from "./adapter/adapter.js"
import { DocHandle } from "./doc-handle.js"
import {
  createPermissions,
  type PermissionManager,
} from "./permission-manager.js"
import { Synchronizer } from "./synchronizer.js"
import type { DocContent, DocId, IdentityDetails } from "./types.js"

export interface RepoConfig {
  adapters: AnyAdapter[]
  identity?: IdentityDetails
  permissions?: Partial<PermissionManager>
}

/**
 * The Repo class is the central orchestrator for the Loro state synchronization system.
 * It manages the lifecycle of documents, coordinates subsystems, and provides the main
 * public API for document operations.
 *
 * With the simplified DocHandle architecture, Repo becomes a simpler orchestrator
 * that wires together the various subsystems without complex state management.
 */
export class Repo {
  readonly identity: IdentityDetails

  // Subsystems
  readonly #synchronizer: Synchronizer
  readonly #handles: Map<DocId, DocHandle> = new Map()

  constructor({ identity, adapters, permissions }: RepoConfig) {
    this.identity = identity ?? { name: uuidv4() }

    // Instantiate synchronizer
    const synchronizer = new Synchronizer({
      identity: this.identity,
      adapters,
      permissions: createPermissions(permissions),
    })

    this.#synchronizer = synchronizer
  }

  //
  // PUBLIC API - Simplified with always-available documents
  //

  /**
   * Gets or creates a new document with an optional documentId.
   * The document is immediately available for use.
   * @param options Configuration options for document creation
   * @returns The DocHandle with an immediately available document
   */
  get<T extends DocContent>(docId: DocId): DocHandle<T> {
    let handle = this.#handles.get(docId)

    if (!handle) {
      handle = new DocHandle(this.#synchronizer, docId)
      this.#handles.set(docId, handle)
    }

    return handle as unknown as DocHandle<T>
  }

  /**
   * Deletes a document from the repo.
   * @param documentId The ID of the document to delete
   */
  async delete(documentId: DocId): Promise<void> {
    // TODO: move this logic to the synchronizer
    // const handle = this.handleCache.get(documentId)
    // if (handle) {
    //   this.handleCache.delete(documentId)
    //   await this.storageAdapter.remove([documentId])
    //   this.synchronizer.removeDocument(documentId)
    // }
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
