import { LoroDoc, type VersionVector } from "loro-crdt"
import { Adapter } from "../adapter/adapter.js"
import type {
  ChannelMsg,
  ChannelMsgDeleteRequest,
  ChannelMsgDirectoryRequest,
  ChannelMsgSyncRequest,
  ConnectedChannel,
  GeneratedChannel,
} from "../channel.js"
import type { DocId, PeerID } from "../types.js"
import { generatePeerId } from "../utils/generate-peer-id.js"

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
  protected storageChannel?: ConnectedChannel
  private readonly storagePeerId: PeerID
  private lastTimestamp = 0
  private counter = 0

  constructor(params: { adapterId: string }) {
    super(params)
    // Generate a cryptographically random peerId for this storage adapter instance
    this.storagePeerId = generatePeerId()
  }

  /**
   * Generate the base channel for this storage adapter.
   * This is called by the ChannelDirectory when creating the channel.
   * The channel is ready to use immediately.
   */
  protected generate(): GeneratedChannel {
    return {
      kind: "storage",
      adapterId: this.adapterId,
      send: this.handleChannelMessage.bind(this),
      stop: () => {
        // Cleanup if needed
      },
    }
  }

  /**
   * Start the storage adapter by creating its single channel.
   * Storage is always "ready" - no async initialization needed.
   */
  async onStart(): Promise<void> {
    this.storageChannel = this.addChannel()
    // Establish the channel to trigger the establishment handshake
    this.establishChannel(this.storageChannel.channelId)
  }

  /**
   * Stop the storage adapter and clean up resources.
   */
  async onStop(): Promise<void> {
    if (this.storageChannel) {
      this.removeChannel(this.storageChannel.channelId)
      this.storageChannel = undefined
    }
  }

  /**
   * Handle incoming channel messages and translate them into storage operations.
   */
  private async handleChannelMessage(msg: ChannelMsg): Promise<void> {
    this.logger.trace("handleChannelMessage", { msg })

    try {
      switch (msg.type) {
        case "channel/establish-request":
          return await this.handleEstablishRequest()
        case "channel/sync-request":
          return await this.handleSyncRequest(msg)
        case "channel/sync-response":
          return await this.handleSyncResponse(msg)
        case "channel/directory-request":
          return await this.handleDirectoryRequest(msg)
        case "channel/directory-response":
          return await this.handleDirectoryResponse(msg)
        case "channel/delete-request":
          return await this.handleDeleteRequest(msg)
        case "channel/ephemeral":
          // Storage adapters ignore ephemeral messages
          return
        default:
          this.logger.warn("unhandled message type", { type: msg.type })
      }
    } catch (error) {
      this.logger.error("error handling channel message", { error, msg })
    }
  }

  /**
   * Handle sync responses by saving document updates to storage.
   */
  private async handleSyncResponse(msg: ChannelMsg): Promise<void> {
    if (msg.type !== "channel/sync-response") return

    const { docId, transmission } = msg

    // Only save if we received actual data
    if (transmission.type === "update" || transmission.type === "snapshot") {
      // Generate a unique key for this update
      // Format: [docId, "update", timestamp]
      const now = Date.now()
      if (now === this.lastTimestamp) {
        this.counter++
      } else {
        this.lastTimestamp = now
        this.counter = 0
      }

      const timestamp = `${now}-${this.counter.toString().padStart(4, "0")}`
      const key: StorageKey = [docId, "update", timestamp]

      await this.save(key, transmission.data)
    }
  }

  /**
   * Send a reply message through the storage channel.
   * Throws an error if the channel is not properly initialized.
   */
  private reply(msg: ChannelMsg): void {
    if (!this.storageChannel) {
      throw new Error("Cannot reply: storage channel not initialized")
    }
    this.storageChannel.onReceive(msg)
  }

  /**
   * Automatically respond to establishment requests.
   * Storage has no concept of "connection establishment" - it's always ready.
   * We immediately respond with our identity so the channel becomes established.
   */
  private async handleEstablishRequest(): Promise<void> {
    // Small delay to ensure the channel is fully registered
    await Promise.resolve()
    this.reply({
      type: "channel/establish-response",
      identity: {
        peerId: this.storagePeerId,
        name: this.adapterId,
        type: "service",
      },
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
   *
   * WARNING: This implementation loads all chunks for a document into memory at once.
   * For very large documents or documents with long histories, this could lead to
   * high memory usage. A future improvement would be to stream chunks or use
   * a more memory-efficient reconstruction strategy.
   */
  private async handleSyncRequest(msg: ChannelMsgSyncRequest): Promise<void> {
    for (const { docId, requesterDocVersion } of msg.docs) {
      try {
        // Load all data for this document (snapshot + updates)
        const chunks = await this.loadRange([docId])
        this.logger.debug("loaded chunks", { docId, count: chunks.length })

        if (chunks.length === 0) {
          // Document not found in storage yet
          // Send "unavailable" to indicate we don't have the data
          // The synchronizer will keep wantsUpdates=true for storage channels
          // so future updates will still be sent to us for persistence
          this.logger.debug("document not found in storage", { docId })
          this.replyUnavailable(docId)
          continue
        }

        // Reconstruct document from storage chunks
        // Note: Order doesn't matter - Loro's CRDT is commutative
        const tempDoc = new LoroDoc()

        try {
          const updates = chunks.map(chunk => chunk.data)
          tempDoc.importBatch(updates)
        } catch (error) {
          this.logger.warn("failed to import chunk batch", {
            docId,
            error,
          })
        }

        // Export version-aware response
        const currentVersion = tempDoc.oplogVersion()

        // Use Loro's built-in version comparison
        const comparison = requesterDocVersion.compare(currentVersion)

        if (comparison === 0) {
          // Versions are equal - requester is up to date
          this.replyUpToDate(docId, currentVersion)
        } else if (comparison === 1) {
          // Requester version is greater - they're ahead (shouldn't happen normally)
          this.replyUpToDate(docId, currentVersion)
        } else {
          // Requester version is less than or concurrent - send updates
          const data = tempDoc.export({
            mode: "update",
            from: requesterDocVersion,
          })

          this.replyWithSyncResponse(docId, data, currentVersion)
        }
      } catch (error) {
        this.logger.error("sync request failed", { docId, error })
        this.replyUnavailable(docId)
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
        this.replyWithDirectoryResponse(available)
      } else {
        // List all documents
        const chunks = await this.loadRange([])
        // Extract unique docIds from chunks (each doc may have multiple chunks)
        const docIds = Array.from(new Set(chunks.map(chunk => chunk.key[0])))
        this.replyWithDirectoryResponse(docIds)
      }
    } catch (error) {
      this.logger.error("directory request failed", { error })
      this.replyWithDirectoryResponse([])
    }
  }

  /**
   * Handle directory responses (announcements) by eagerly requesting documents.
   * Storage adapters are "eager" - they automatically request all announced documents.
   */
  private async handleDirectoryResponse(msg: ChannelMsg): Promise<void> {
    if (msg.type !== "channel/directory-response") return

    const { docIds } = msg

    if (docIds.length === 0) return

    this.logger.debug("received directory-response announcement", {
      docIds,
      count: docIds.length,
    })

    // Storage is eager - request all announced documents
    // Use empty version to get full snapshot
    const docs = docIds.map(docId => ({
      docId,
      requesterDocVersion: new LoroDoc().version(),
    }))

    this.reply({
      type: "channel/sync-request",
      docs,
    })
  }

  /**
   * Handle delete requests by removing documents from storage.
   */
  private async handleDeleteRequest(
    msg: ChannelMsgDeleteRequest,
  ): Promise<void> {
    try {
      await this.remove([msg.docId])
      this.replyWithDeleteResponse(msg.docId, "deleted")
    } catch (error) {
      this.logger.warn("delete failed", { docId: msg.docId, error })
      this.replyWithDeleteResponse(msg.docId, "ignored")
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
   * Reply with a sync response containing document data.
   */
  private replyWithSyncResponse(
    docId: DocId,
    data: Uint8Array,
    version: VersionVector,
  ): void {
    this.reply({
      type: "channel/sync-response",
      docId,
      transmission: {
        type: "update",
        data,
        version,
      },
    })
  }

  /**
   * Reply that the requester already has the latest version.
   */
  private replyUpToDate(docId: DocId, version: VersionVector): void {
    this.reply({
      type: "channel/sync-response",
      docId,
      transmission: {
        type: "up-to-date",
        version,
      },
    })
  }

  /**
   * Reply that the document is not available.
   */
  private replyUnavailable(docId: DocId): void {
    this.reply({
      type: "channel/sync-response",
      docId,
      transmission: { type: "unavailable" },
    })
  }

  /**
   * Reply with a directory listing of available docIds.
   */
  private replyWithDirectoryResponse(docIds: DocId[]): void {
    this.reply({
      type: "channel/directory-response",
      docIds,
    })
  }

  /**
   * Reply with the result of a delete operation.
   */
  private replyWithDeleteResponse(
    docId: DocId,
    status: "deleted" | "ignored",
  ): void {
    this.reply({
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
