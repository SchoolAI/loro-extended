import { LoroDoc, type PeerID, type VersionVector } from "loro-crdt"
import { Adapter } from "../adapter/adapter.js"
import type {
  BatchableMsg,
  ChannelMsg,
  ChannelMsgBatch,
  ChannelMsgDeleteRequest,
  ChannelMsgDirectoryRequest,
  ChannelMsgNewDoc,
  ChannelMsgSyncRequest,
  ConnectedChannel,
  GeneratedChannel,
} from "../channel.js"
import type { DocId } from "../types.js"
import { generatePeerId } from "../utils/generate-peer-id.js"

export type StorageKey = string[]

export type Chunk = {
  key: StorageKey
  data: Uint8Array
}

/**
 * A base class for storage adapters.
 *
 * This base class extends Adapter<void> and handles all channel communication
 * behind the scenes. Subclasses only need to implement the following storage
 * operations, and do not need specialized knowledge of Adapter message protocol:
 * - load, save, remove
 * - loadRange, removeRange
 *
 * The base class automatically:
 * - Creates a single channel for storage operations
 * - Responds to channel establishment requests
 * - Responds to document sync requests
 * - Translates channel messages into storage operations
 *
 * The StorageAdapter essentially mimics what would happen if there were another
 * repo to communicate with, but instead intercepts and responds with appropriate
 * messages itself.
 */
export abstract class StorageAdapter extends Adapter<void> {
  /**
   * Storage adapters always create storage channels.
   * This overrides the default "network" kind from the base Adapter class.
   */
  override readonly kind = "storage" as const

  protected storageChannel?: ConnectedChannel
  private lastTimestamp = 0
  private counter = 0

  // Since a StorageAdapter mimics the behavior of a peer, we need a PeerId
  private readonly storagePeerId: PeerID = generatePeerId()

  /**
   * Track pending async operations (saves, loads, etc.) so they can be
   * awaited during flush/shutdown.
   */
  readonly #pendingOps: Set<Promise<void>> = new Set()

  /**
   * Generate channel actions for storage operations.
   * The kind and adapterType are automatically added by the base class.
   *
   * The send function wraps handleChannelMessage to track pending async
   * operations, enabling flush() to await all in-flight saves.
   */
  protected generate(): GeneratedChannel {
    return {
      kind: this.kind,
      adapterType: this.adapterType,
      send: (msg: ChannelMsg) => {
        const op = this.handleChannelMessage(msg).catch(error => {
          this.logger.error("unhandled error in storage channel message", {
            error,
            type: msg.type,
          })
        })
        this.#trackOp(op)
        // Return the promise so callers that `await channel.send(...)` still
        // work (e.g., tests). The ChannelActions.send type is `void`, but
        // TypeScript allows returning a value from a void function.
        return op as unknown as void
      },
      stop: () => {},
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
    // Flush pending operations before stopping
    await this.flush()

    if (this.storageChannel) {
      this.removeChannel(this.storageChannel.channelId)
      this.storageChannel = undefined
    }
  }

  /**
   * Await all pending async storage operations (saves, loads, etc.).
   *
   * Call this before shutting down to ensure all data has been persisted.
   * This does NOT disconnect the adapter — it only waits for in-flight
   * operations to complete.
   */
  async flush(): Promise<void> {
    while (this.#pendingOps.size > 0) {
      await Promise.all(this.#pendingOps)
    }
  }

  /**
   * Track an async operation so flush() can await it.
   */
  #trackOp(op: Promise<void>): void {
    this.#pendingOps.add(op)
    op.finally(() => {
      this.#pendingOps.delete(op)
    })
  }

  /**
   * Handle incoming channel messages and translate them into storage operations.
   */
  private async handleChannelMessage(msg: ChannelMsg): Promise<void> {
    this.logger.trace("handleChannelMessage", { type: msg.type })

    try {
      switch (msg.type) {
        case "channel/establish-request":
          return await this.handleEstablishRequest()
        case "channel/establish-response":
          // Nothing to do
          break
        case "channel/sync-request":
          return await this.handleSyncRequest(msg)
        case "channel/sync-response":
          return await this.handleSyncResponse(msg)
        case "channel/update":
          return await this.handleUpdate(msg)
        case "channel/directory-request":
          return await this.handleDirectoryRequest(msg)
        case "channel/directory-response":
          // directory-response is only for request/response flow (future glob feature)
          // Storage adapters don't need to handle this
          break
        case "channel/new-doc":
          return await this.handleNewDoc(msg)
        case "channel/delete-request":
          return await this.handleDeleteRequest(msg)
        case "channel/delete-response":
          // Nothing to do
          break
        case "channel/ephemeral":
          // Storage adapters ignore ephemeral messages
          return
        case "channel/batch":
          // Handle batched messages by dispatching each one
          return await this.handleBatch(msg)
        default:
          this.logger.warn("unhandled message type", {
            type: (msg as ChannelMsg).type,
          })
      }
    } catch (error) {
      this.logger.error("error handling channel message", { error, msg })
    }
  }

  /**
   * Handle batched messages by dispatching each one.
   */
  private async handleBatch(msg: ChannelMsgBatch): Promise<void> {
    for (const innerMsg of msg.messages) {
      await this.handleChannelMessage(innerMsg)
    }
  }

  // ==========================================================================
  // Message Handlers
  // ==========================================================================

  /**
   * Automatically respond to establishment requests.
   * Storage has no concept of "connection establishment" - it's always ready.
   * We immediately respond with our identity so the channel becomes established.
   *
   * NOTE: We intentionally do NOT call requestStoredDocuments() here.
   * Storage is lazy-loaded - documents are loaded on-demand when network clients
   * request them via the storage-first sync mechanism. This approach:
   * - Scales to millions of documents
   * - Reduces startup time
   * - Avoids race conditions with eager loading
   */
  private async handleEstablishRequest(): Promise<void> {
    this.logger.debug("handleEstablishRequest: responding with identity")
    // Small delay to ensure the channel is fully registered
    await Promise.resolve()
    this.reply({
      type: "channel/establish-response",
      identity: {
        peerId: this.storagePeerId,
        name: this.adapterType,
        type: "service",
      },
    })

    // Storage is now lazy - documents are loaded on-demand via handleSyncRequest
    // when network clients request them. No eager loading needed.
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
    const { docId, requesterDocVersion, bidirectional } = msg

    this.logger.debug("handleSyncRequest: received request", {
      docId,
      bidirectional,
    })

    try {
      // Load all data for this document (snapshot + updates)
      const chunks = await this.loadRange([docId])
      this.logger.debug("handleSyncRequest: loaded chunks", {
        docId,
        count: chunks.length,
      })

      if (chunks.length === 0) {
        // Document not found in storage yet
        // Send "unavailable" to indicate we don't have the data
        this.logger.debug("handleSyncRequest: document not found in storage", {
          docId,
        })
        this.replyUnavailable(docId)

        // Even though we don't have the document, we want to receive future updates
        // Send reciprocal sync-request with empty version
        this.replyWithSyncRequest(
          [{ docId, requesterDocVersion: new LoroDoc().oplogVersion() }],
          false,
        )
        return
      }

      // Reconstruct document from storage chunks
      // Note: Order doesn't matter - Loro's CRDT is commutative
      const tempDoc = new LoroDoc()

      try {
        const updates = chunks.map(chunk => chunk.data)
        tempDoc.importBatch(updates)
        this.logger.debug("handleSyncRequest: imported chunks into tempDoc", {
          docId,
          chunkCount: chunks.length,
        })
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
      this.logger.debug("handleSyncRequest: version comparison", {
        docId,
        comparison,
        requesterVersionLength: requesterDocVersion.length(),
        currentVersionLength: currentVersion.length(),
      })

      if (comparison === 0) {
        // Versions are equal - requester is up to date
        this.logger.debug("handleSyncRequest: replying up-to-date", { docId })
        this.replyUpToDate(docId, currentVersion)
      } else if (comparison === 1) {
        // Requester version is greater - they're ahead (shouldn't happen normally)
        this.logger.debug(
          "handleSyncRequest: requester ahead, replying up-to-date",
          { docId },
        )
        this.replyUpToDate(docId, currentVersion)
      } else {
        // Requester version is less than or concurrent - send updates
        const data = tempDoc.export({
          mode: "update",
          from: requesterDocVersion,
        })
        this.logger.debug("handleSyncRequest: sending update", {
          docId,
          dataLength: data.length,
        })

        this.replyWithSyncResponse(docId, data, currentVersion)
      }

      // Send reciprocal sync-request to get added to the Repo's subscriptions
      // This ensures we receive future updates for this document
      this.logger.debug(
        "handleSyncRequest: sending reciprocal sync-request for subscription",
        { docId },
      )
      this.replyWithSyncRequest(
        [{ docId, requesterDocVersion: currentVersion }],
        false,
      )
    } catch (error) {
      this.logger.error("sync request failed", { docId, error })
      this.replyUnavailable(docId)

      // Still want updates even if we failed to load
      this.replyWithSyncRequest(
        [{ docId, requesterDocVersion: new LoroDoc().oplogVersion() }],
        false,
      )
    }
  }

  /**
   * Handle sync responses by saving document updates to storage.
   * This is called once in response to a sync-request.
   */
  private async handleSyncResponse(msg: ChannelMsg): Promise<void> {
    if (msg.type !== "channel/sync-response") return

    const { docId, transmission } = msg

    this.logger.debug("handleSyncResponse: received", {
      docId,
      transmissionType: transmission.type,
      dataLength: "data" in transmission ? transmission.data.length : 0,
    })

    // Only save if we received actual data
    if (transmission.type === "update" || transmission.type === "snapshot") {
      this.logger.debug(
        "handleSyncResponse: about to save data (this creates a new chunk!)",
        {
          docId,
          transmissionType: transmission.type,
          dataLength: transmission.data.length,
        },
      )
      await this.saveDocumentData(docId, transmission.data)
    }
  }

  /**
   * Handle ongoing updates from subscribed documents.
   * This is called when a document changes after the initial sync.
   */
  private async handleUpdate(msg: ChannelMsg): Promise<void> {
    if (msg.type !== "channel/update") return

    const { docId, transmission } = msg

    this.logger.debug("handleUpdate: received", {
      docId,
      transmissionType: transmission.type,
      dataLength: "data" in transmission ? transmission.data.length : 0,
    })

    // Only save if we received actual data
    if (transmission.type === "update" || transmission.type === "snapshot") {
      this.logger.debug(
        "handleUpdate: about to save data (this creates a new chunk!)",
        {
          docId,
          transmissionType: transmission.type,
          dataLength: transmission.data.length,
        },
      )
      await this.saveDocumentData(docId, transmission.data)
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
   * Handle new-doc announcements by eagerly requesting documents.
   * Storage adapters are "eager" - they automatically request all announced documents.
   */
  private async handleNewDoc(msg: ChannelMsgNewDoc): Promise<void> {
    const { docIds } = msg

    if (docIds.length === 0) return

    this.logger.debug("received new-doc announcement", {
      docIds,
      count: docIds.length,
    })

    // Storage is eager - request all announced documents
    // Use empty version to get full snapshot
    const docs = docIds.map(docId => ({
      docId,
      requesterDocVersion: new LoroDoc().version(),
    }))

    this.replyWithSyncRequest(docs, false)
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

  // ==========================================================================
  // Helper methods
  // ==========================================================================

  /**
   * Save document data to storage with a unique timestamped key.
   */
  private async saveDocumentData(
    docId: DocId,
    data: Uint8Array,
  ): Promise<void> {
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

    await this.save(key, data)
  }

  /**
   * Send a reply message through the storage channel.
   * Throws an error if the channel is not properly initialized.
   *
   * Delivers messages synchronously. The Synchronizer's receive queue handles
   * recursion prevention by queuing messages and processing them iteratively.
   */
  private reply(msg: ChannelMsg): void {
    if (!this.storageChannel) {
      throw new Error("Cannot reply: storage channel not initialized")
    }
    // Deliver synchronously - the Synchronizer's receive queue prevents recursion
    this.storageChannel.onReceive(msg)
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
   * Reply with sync request(s) for the given documents.
   * Uses channel/batch if multiple documents, single message otherwise.
   */
  private replyWithSyncRequest(
    docs: Array<{ docId: DocId; requesterDocVersion: VersionVector }>,
    bidirectional: boolean,
  ): void {
    if (docs.length === 0) {
      return
    }

    if (docs.length === 1) {
      // Single document - send single sync-request
      this.reply({
        type: "channel/sync-request",
        docId: docs[0].docId,
        requesterDocVersion: docs[0].requesterDocVersion,
        bidirectional,
      })
    } else {
      // Multiple documents - batch sync-requests
      const syncRequests: ChannelMsgSyncRequest[] = docs.map(doc => ({
        type: "channel/sync-request",
        docId: doc.docId,
        requesterDocVersion: doc.requesterDocVersion,
        bidirectional,
      }))

      this.reply({
        type: "channel/batch",
        messages: syncRequests as BatchableMsg[],
      })
    }
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
