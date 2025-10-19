import { LoroDoc, type VersionVector } from "loro-crdt"
import { Adapter } from "../adapter/adapter.js"
import type {
  BaseChannel,
  Channel,
  ChannelId,
  ChannelMsg,
  ChannelMsgDeleteRequest,
  ChannelMsgDirectoryRequest,
  ChannelMsgEstablishRequest,
  ChannelMsgSyncRequest,
  ReceiveFn,
} from "../channel.js"
import type { DocId } from "../types.js"

export type StorageKey = string[]

export type Chunk = {
  key: StorageKey
  data: Uint8Array
}

/**
 * An adapter for persisting Loro documents and repo metadata.
 *
 * This base class extends Adapter<void> and handles all channel communication
 * behind the scenes. Subclasses only need to implement the storage operations
 * (load, save, remove, loadRange, removeRange) without any knowledge of channels.
 *
 * The base class automatically:
 * - Creates a single channel for storage operations
 * - Responds to channel establishment requests
 * - Translates channel messages into storage operations
 * - Sends appropriate responses back through the channel
 */
export abstract class StorageAdapter extends Adapter<void> {
  protected storageChannel?: Channel
  protected receive?: ReceiveFn

  /**
   * Generate the base channel for this storage adapter.
   * This is called by the ChannelDirectory when creating the channel.
   */
  protected generate(): BaseChannel {
    return {
      kind: "storage",
      adapterId: this.adapterId,
      send: this.handleChannelMessage.bind(this),
      start: receive => {
        this.receive = receive
      },
      stop: () => {
        this.receive = undefined
      },
    }
  }

  /**
   * Initialize the storage adapter by creating its single channel.
   */
  init({
    addChannel,
  }: {
    addChannel: (context: void) => Channel
    removeChannel: (channelId: ChannelId) => Channel | undefined
  }): void {
    this.storageChannel = addChannel()
  }

  /**
   * Clean up the storage adapter.
   */
  deinit(): void {
    this.storageChannel = undefined
    this.receive = undefined
  }

  /**
   * Start the storage adapter. Storage is always "ready" - nothing to do.
   */
  start(): void {
    // Storage is always ready - no async initialization needed
  }

  /**
   * Handle incoming channel messages and translate them into storage operations.
   */
  private async handleChannelMessage(msg: ChannelMsg): Promise<void> {
    try {
      switch (msg.type) {
        case "channel/establish-request":
          this.autoEstablish(msg)
          break
        case "channel/sync-request":
          await this.handleSyncRequest(msg)
          break
        case "channel/directory-request":
          await this.handleDirectoryRequest(msg)
          break
        case "channel/delete-request":
          await this.handleDeleteRequest(msg)
          break
        default:
          this.logger.warn("unhandled message type", { type: msg.type })
      }
    } catch (error) {
      this.logger.error("error handling channel message", { error, msg })
    }
  }

  /**
   * Automatically respond to establishment requests.
   * Storage has no concept of "connection establishment" - it's always ready.
   */
  private autoEstablish(msg: ChannelMsgEstablishRequest): void {
    if (!this.receive || !this.storageChannel) return

    this.receive({
      type: "channel/establish-response",
      identity: { name: this.adapterId },
      responderPublishDocId: this.storageChannel.publishDocId,
    })
  }

  /**
   * Handle sync requests by loading documents from storage.
   *
   * This implementation:
   * 1. Loads snapshot + incremental updates using loadRange
   * 2. Reconstructs document in temporary LoroDoc (order doesn't matter - Loro handles it)
   * 3. Uses requesterDocVersion to export only needed changes
   * 4. Enables efficient incremental sync
   */
  private async handleSyncRequest(msg: ChannelMsgSyncRequest): Promise<void> {
    for (const { docId, requesterDocVersion } of msg.docs) {
      try {
        // Load all data for this document (snapshot + updates)
        const chunks = await this.loadRange([docId])

        if (chunks.length === 0) {
          // Document not found in storage
          this.sendUnavailable(docId)
          continue
        }

        // Reconstruct document from storage chunks
        // Note: Order doesn't matter - Loro's CRDT is commutative
        const tempDoc = new LoroDoc()

        for (const chunk of chunks) {
          try {
            tempDoc.import(chunk.data)
          } catch (error) {
            this.logger.warn("failed to import chunk", {
              docId,
              key: chunk.key,
              error,
            })
          }
        }

        // Export version-aware response
        const currentVersion = tempDoc.oplogVersion()

        // Use Loro's built-in version comparison
        const comparison = requesterDocVersion.compare(currentVersion)

        if (comparison === 0) {
          // Versions are equal - requester is up to date
          this.sendUpToDate(docId, currentVersion)
        } else if (comparison === 1) {
          // Requester version is greater - they're ahead (shouldn't happen normally)
          this.sendUpToDate(docId, currentVersion)
        } else {
          // Requester version is less than or concurrent - send updates
          const data = tempDoc.export({
            mode: "update",
            from: requesterDocVersion,
          })

          this.sendSyncResponse(docId, data, currentVersion)
        }
      } catch (error) {
        this.logger.error("sync request failed", { docId, error })
        this.sendUnavailable(docId)
      }
    }
  }

  /**
   * Handle directory requests by listing available documents.
   */
  private async handleDirectoryRequest(
    msg: ChannelMsgDirectoryRequest,
  ): Promise<void> {
    try {
      if (msg.docIds) {
        // Check specific docIds
        const available = await this.checkDocIds(msg.docIds)
        this.sendDirectoryResponse(available)
      } else {
        // List all documents
        const chunks = await this.loadRange([])
        const docIds = chunks.map(chunk => chunk.key[0])
        this.sendDirectoryResponse(docIds)
      }
    } catch (error) {
      this.logger.error("directory request failed", { error })
      this.sendDirectoryResponse([])
    }
  }

  /**
   * Handle delete requests by removing documents from storage.
   */
  private async handleDeleteRequest(
    msg: ChannelMsgDeleteRequest,
  ): Promise<void> {
    try {
      await this.remove([msg.docId])
      this.sendDeleteResponse(msg.docId, "deleted")
    } catch (error) {
      this.logger.warn("delete failed", { docId: msg.docId, error })
      this.sendDeleteResponse(msg.docId, "ignored")
    }
  }

  /**
   * Check which of the given docIds are available in storage.
   */
  private async checkDocIds(docIds: DocId[]): Promise<DocId[]> {
    const available: DocId[] = []
    for (const docId of docIds) {
      try {
        const data = await this.load([docId])
        if (data) {
          available.push(docId)
        }
      } catch (error) {
        this.logger.warn("error checking docId", { docId, error })
      }
    }
    return available
  }

  /**
   * Send a sync response with document data.
   */
  private sendSyncResponse(
    docId: DocId,
    data: Uint8Array,
    version: VersionVector,
  ): void {
    if (!this.receive || !this.storageChannel) return

    this.receive({
      type: "channel/sync-response",
      docId,
      hopCount: 0,
      transmission: {
        type: "update",
        data,
      },
    })
  }

  /**
   * Send an up-to-date response when requester already has latest version.
   */
  private sendUpToDate(docId: DocId, version: VersionVector): void {
    if (!this.receive || !this.storageChannel) return

    this.receive({
      type: "channel/sync-response",
      docId,
      hopCount: 0,
      transmission: {
        type: "up-to-date",
        version,
      },
    })
  }

  /**
   * Send an unavailable response when document is not found.
   */
  private sendUnavailable(docId: DocId): void {
    if (!this.receive || !this.storageChannel) return

    this.receive({
      type: "channel/sync-response",
      docId,
      hopCount: 0,
      transmission: { type: "unavailable" },
    })
  }

  /**
   * Send a directory response with available docIds.
   */
  private sendDirectoryResponse(docIds: DocId[]): void {
    if (!this.receive) return

    this.receive({
      type: "channel/directory-response",
      docIds,
    })
  }

  /**
   * Send a delete response.
   */
  private sendDeleteResponse(
    docId: DocId,
    status: "deleted" | "ignored",
  ): void {
    if (!this.receive) return

    this.receive({
      type: "channel/delete-response",
      docId,
      status,
    })
  }

  // Abstract storage interface - implemented by subclasses

  /** Load a binary blob for a given key. */
  abstract load(key: StorageKey): Promise<Uint8Array | undefined>

  /** Save a binary blob to a given key. */
  abstract save(key: StorageKey, data: Uint8Array): Promise<void>

  /** Remove a binary blob from a given key. */
  abstract remove(key: StorageKey): Promise<void>

  /** Load all chunks whose keys begin with the given prefix. */
  abstract loadRange(keyPrefix: StorageKey): Promise<Chunk[]>

  /** Remove all chunks whose keys begin with the given prefix. */
  abstract removeRange(keyPrefix: StorageKey): Promise<void>
}
