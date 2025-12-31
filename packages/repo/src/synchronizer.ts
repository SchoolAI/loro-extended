import { getLogger, type Logger } from "@logtape/logtape"
import Emittery from "emittery"
import type { EphemeralStore, Value, VersionVector } from "loro-crdt"
import { create, type Patch } from "mutative"
import type { AnyAdapter } from "./adapter/adapter.js"
import { AdapterManager } from "./adapter/adapter-manager.js"
import type {
  BatchableMsg,
  Channel,
  ChannelMsg,
  ChannelMsgSyncRequest,
  ChannelMsgSyncResponse,
  ConnectedChannel,
  SyncTransmission,
} from "./channel.js"
import { isEstablished as isEstablishedFn } from "./channel.js"
import type { Middleware } from "./middleware.js"
import { createPermissions, type Permissions } from "./permissions.js"
import {
  type CommandContext,
  CommandExecutor,
  type SynchronizerEvents,
} from "./synchronizer/command-executor.js"
import { commandHandlers } from "./synchronizer/command-handlers/index.js"
import { EphemeralStoreManager } from "./synchronizer/ephemeral-store-manager.js"
import { HeartbeatManager } from "./synchronizer/heartbeat-manager.js"
import { MiddlewareProcessor } from "./synchronizer/middleware-processor.js"
import { OutboundBatcher } from "./synchronizer/outbound-batcher.js"
import { getReadyStates } from "./synchronizer/state-helpers.js"
import { WorkQueue } from "./synchronizer/work-queue.js"
import {
  type Command,
  createSynchronizerUpdate,
  init as programInit,
  type SynchronizerMessage,
  type SynchronizerModel,
} from "./synchronizer-program.js"
import type {
  ChannelId,
  DocId,
  DocState,
  PeerID,
  PeerIdentityDetails,
  PeerState,
  ReadyState,
} from "./types.js"
import { equal } from "./utils/equal.js"

export type HandleUpdateFn = (patches: Patch[]) => void

// Initiate a synchronizer/heartbeat every N milliseconds; used primarily for ephemeral stores
const HEARTBEAT_INTERVAL = 10000

// SynchronizerEvents is imported from command-executor.ts to avoid circular dependency

type SynchronizerParams = {
  identity: PeerIdentityDetails
  adapters?: AnyAdapter[]
  permissions?: Permissions
  middleware?: Middleware[]
  onUpdate?: HandleUpdateFn
  logger?: Logger
}

type SynchronizerUpdate = (
  msg: SynchronizerMessage,
  model: SynchronizerModel,
) => [SynchronizerModel, Command?]

export type ObjectValue = { [key: string]: Value }

export class Synchronizer {
  readonly identity: PeerIdentityDetails
  readonly adapters: AdapterManager
  readonly logger: Logger

  readonly updateFn: SynchronizerUpdate

  // Extracted modules
  readonly #workQueue: WorkQueue
  readonly #outboundBatcher: OutboundBatcher
  readonly #ephemeralManager: EphemeralStoreManager
  readonly #heartbeatManager: HeartbeatManager
  readonly #middlewareProcessor: MiddlewareProcessor
  readonly #commandExecutor: CommandExecutor

  /**
   * Per-doc namespaced ephemeral stores (unified model).
   * Internal getter used by command execution.
   */
  get docNamespacedStores(): Map<DocId, Map<string, EphemeralStore>> {
    return this.#ephemeralManager.stores
  }

  readonly emitter = new Emittery<SynchronizerEvents>()

  readonly readyStates = new Map<DocId, ReadyState[]>()

  model: SynchronizerModel

  constructor({
    identity,
    adapters = [],
    permissions,
    middleware = [],
    onUpdate,
    logger: preferredLogger,
  }: SynchronizerParams) {
    const logger = preferredLogger ?? getLogger()
    this.logger = logger.getChild("synchronizer")

    this.identity = identity

    this.logger.debug("new Synchronizer: {identity}", {
      identity: this.identity,
    })

    this.updateFn = createSynchronizerUpdate({
      permissions: createPermissions(permissions),
      onUpdate,
      logger,
    })

    // Initialize model BEFORE creating AdapterManager, since adapters may
    // trigger channelAdded which needs the model
    const [initialModel, initialCommand] = programInit(this.identity)
    this.model = initialModel

    // Initialize extracted modules
    this.#outboundBatcher = new OutboundBatcher()

    this.#workQueue = new WorkQueue(() => {
      // Called at quiescence - flush outbound messages and emit ready state changes
      this.#outboundBatcher.flush(envelope => this.adapters.send(envelope))
      this.#emitReadyStateChanges()
    })

    this.#ephemeralManager = new EphemeralStoreManager(
      this.identity,
      (docId, namespace) => {
        // Route through dispatch for TEA compliance
        this.#dispatch({
          type: "synchronizer/ephemeral-local-change",
          docId,
          namespace,
        })
      },
      this.logger,
    )

    this.#heartbeatManager = new HeartbeatManager(HEARTBEAT_INTERVAL, () => {
      this.#dispatch({ type: "synchronizer/heartbeat" })
    })

    // Initialize middleware processor with a getter function for model access
    this.#middlewareProcessor = new MiddlewareProcessor(
      middleware,
      () => this.model,
      this.logger,
    )

    // Initialize command executor with handler registry
    this.#commandExecutor = new CommandExecutor(commandHandlers, () =>
      this.#buildCommandContext(),
    )

    // Create adapter context for dynamic adapter initialization
    const adapterContext = {
      identity: this.identity,
      logger: this.logger,
      onChannelAdded: this.channelAdded.bind(this),
      onChannelRemoved: this.channelRemoved.bind(this),
      onChannelReceive: this.channelReceive.bind(this),
      onChannelEstablish: this.channelEstablish.bind(this),
    }

    // Create AdapterManager (initializes adapters but doesn't start them yet)
    this.adapters = new AdapterManager({
      adapters,
      context: adapterContext,
      onReset: (adapter: AnyAdapter) => {
        for (const channel of adapter.channels) {
          this.channelRemoved(channel)
        }
      },
      logger,
    })

    // Execute initial command AFTER adapters is assigned (commands may access this.adapters)
    if (initialCommand) {
      this.#executeCommand(initialCommand)
    }

    // Start all adapters now that everything is initialized
    this.adapters.startAll()

    this.#heartbeatManager.start()
  }

  // =-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=
  // PUBLIC API - Heartbeat Management
  // =-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=

  startHeartbeat() {
    this.#heartbeatManager.start()
  }

  stopHeartbeat() {
    this.#heartbeatManager.stop()
  }

  /**
   * Get the number of middleware configured (for debugging).
   */
  get middlewareCount(): number {
    return this.#middlewareProcessor.count
  }

  /**
   * Handle incoming channel messages.
   *
   * Uses a unified work queue to prevent recursion when adapters deliver messages
   * synchronously (e.g., BridgeAdapter, StorageAdapter). Messages are queued
   * and processed iteratively rather than recursively.
   *
   * If middleware is configured, it runs BEFORE the synchronizer processes the message.
   * Middleware can reject messages (e.g., rate limiting, auth).
   *
   * @param channelId - The channel ID (we look up the current channel from the model
   *                    to ensure we have the latest state, since the model uses immutable updates)
   * @param message - The message received on the channel
   */
  channelReceive(channelId: ChannelId, message: ChannelMsg): void {
    this.#workQueue.enqueue(() =>
      this.#channelReceiveInternal(channelId, message),
    )
  }

  /**
   * Internal message processing after queue management.
   * This contains the actual message handling logic.
   */
  #channelReceiveInternal(channelId: ChannelId, message: ChannelMsg): void {
    this.logger.trace("onReceive: {messageType} from {channelId}", {
      channelId,
      messageType: message.type,
    })

    // Handle channel/batch messages by running middleware on each message individually
    // This ensures size-limiting middleware can reject individual messages in a batch
    if (message.type === "channel/batch") {
      this.#handleBatchMessage(channelId, message.messages)
      return
    }

    // Run middleware if configured
    if (this.#middlewareProcessor.hasMiddleware) {
      this.#runMiddlewareAndDispatch(channelId, message)
      return
    }

    // No middleware - dispatch immediately
    this.#dispatch({
      type: "synchronizer/channel-receive-message",
      envelope: {
        fromChannelId: channelId,
        message,
      },
    })
  }

  /**
   * Handle a batch message by running middleware on each message individually.
   * Messages that pass middleware are collected and dispatched together.
   */
  #handleBatchMessage(channelId: ChannelId, messages: BatchableMsg[]): void {
    if (!this.#middlewareProcessor.hasMiddleware) {
      // No middleware - dispatch the batch directly
      this.#dispatch({
        type: "synchronizer/channel-receive-message",
        envelope: {
          fromChannelId: channelId,
          message: { type: "channel/batch", messages },
        },
      })
      return
    }

    // Process batch through middleware
    void this.#middlewareProcessor
      .processBatch(channelId, messages)
      .then(result => {
        if (result.type === "rejected") {
          // All messages rejected
          return
        }

        if (result.type === "no-middleware") {
          // No middleware - dispatch the batch directly
          this.#dispatch({
            type: "synchronizer/channel-receive-message",
            envelope: {
              fromChannelId: channelId,
              message: { type: "channel/batch", messages },
            },
          })
          return
        }

        if (result.type === "allowed") {
          // Single message - dispatch directly
          this.#dispatch({
            type: "synchronizer/channel-receive-message",
            envelope: {
              fromChannelId: channelId,
              message: result.message,
            },
          })
          return
        }

        if (result.type === "allowed-batch") {
          // Multiple messages - dispatch as batch
          this.#dispatch({
            type: "synchronizer/channel-receive-message",
            envelope: {
              fromChannelId: channelId,
              message: { type: "channel/batch", messages: result.messages },
            },
          })
        }
      })
  }

  /**
   * Run middleware on a single message and dispatch if allowed.
   */
  #runMiddlewareAndDispatch(channelId: ChannelId, message: ChannelMsg): void {
    void this.#middlewareProcessor
      .processMessage(channelId, message)
      .then(result => {
        if (result.type === "allowed" || result.type === "no-middleware") {
          this.#dispatch({
            type: "synchronizer/channel-receive-message",
            envelope: {
              fromChannelId: channelId,
              message,
            },
          })
        }
        // If result.type === "rejected", message is dropped (middleware rejected it)
      })
  }

  // Helper functions for adapter callbacks
  channelAdded(channel: ConnectedChannel) {
    this.logger.debug("channelAdded: {channelId}", {
      channelId: channel.channelId,
    })
    this.#dispatch({ type: "synchronizer/channel-added", channel })
  }

  channelEstablish(channel: ConnectedChannel) {
    this.logger.debug("channelEstablish: {channelId}", {
      channelId: channel.channelId,
    })
    this.#dispatch({
      type: "synchronizer/establish-channel",
      channelId: channel.channelId,
    })
  }

  channelRemoved(channel: Channel) {
    this.logger.debug("channelRemoved: {channelId}", {
      channelId: channel.channelId,
    })
    this.#dispatch({ type: "synchronizer/channel-removed", channel })
  }

  // =-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=
  // PUBLIC API - Namespaced Ephemeral Store Management (New Unified Model)
  // =-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=

  /**
   * Get or create a namespaced ephemeral store for a document.
   * This is used for the new unified ephemeral store model.
   *
   * @param docId The document ID
   * @param namespace The store namespace (e.g., 'presence', 'cursors', 'mouse')
   * @returns The ephemeral store for this namespace
   */
  getOrCreateNamespacedStore(docId: DocId, namespace: string): EphemeralStore {
    return this.#ephemeralManager.getOrCreate(docId, namespace)
  }

  /**
   * Register an external ephemeral store for network sync.
   * Use this for libraries that bring their own EphemeralStore (like loro-prosemirror).
   *
   * @param docId The document ID
   * @param namespace The store namespace
   * @param store The external EphemeralStore to register
   */
  registerExternalStore(
    docId: DocId,
    namespace: string,
    store: EphemeralStore,
  ): void {
    this.#ephemeralManager.registerExternal(docId, namespace, store)
  }

  /**
   * Get a namespaced store by name.
   *
   * @param docId The document ID
   * @param namespace The store namespace
   * @returns The EphemeralStore or undefined if not found
   */
  getNamespacedStore(
    docId: DocId,
    namespace: string,
  ): EphemeralStore | undefined {
    return this.#ephemeralManager.get(docId, namespace)
  }

  /**
   * Broadcast a namespaced store to all peers.
   * This is called explicitly by the Handle when local changes are made.
   *
   * Routes through dispatch for TEA compliance and message aggregation.
   *
   * @param docId The document ID
   * @param namespace The store namespace
   */
  broadcastNamespacedStore(docId: DocId, namespace: string): void {
    const store = this.getNamespacedStore(docId, namespace)
    if (!store) {
      this.logger.warn(
        "Cannot broadcast: namespaced store {namespace} not found for doc {docId}",
        { namespace, docId },
      )
      return
    }

    // Route through dispatch for TEA compliance
    this.#dispatch({
      type: "synchronizer/ephemeral-local-change",
      docId,
      namespace,
    })
  }

  // =-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=
  // PUBLIC API - Adapter Management
  // =-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=

  /**
   * Add an adapter at runtime.
   * Idempotent: adding an adapter with the same adapterId is a no-op.
   */
  async addAdapter(adapter: AnyAdapter): Promise<void> {
    await this.adapters.addAdapter(adapter)
  }

  /**
   * Remove an adapter at runtime.
   * Idempotent: removing a non-existent adapter is a no-op.
   */
  async removeAdapter(adapterId: string): Promise<void> {
    await this.adapters.removeAdapter(adapterId)
  }

  /**
   * Check if an adapter exists by ID.
   */
  hasAdapter(adapterId: string): boolean {
    return this.adapters.hasAdapter(adapterId)
  }

  /**
   * Get an adapter by ID.
   */
  getAdapter(adapterId: string): AnyAdapter | undefined {
    return this.adapters.getAdapter(adapterId)
  }

  // =-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=
  // PUBLIC API - Document Management
  // =-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=

  getOrCreateDocumentState(docId: DocId): DocState {
    let docState = this.model.documents.get(docId)

    if (!docState) {
      this.#dispatch({ type: "synchronizer/doc-ensure", docId })
      docState = this.model.documents.get(docId)
    }

    if (!docState) {
      throw new Error(`unable to find or create doc: ${docId}`)
    }

    return docState
  }

  getDocumentState(docId: DocId): DocState | undefined {
    const state = this.model.documents.get(docId)
    return state
  }

  /**
   * Get docIds that a channel's peer has subscribed to
   */
  public getChannelDocIds(channelId: ChannelId): DocId[] {
    const channel = this.model.channels.get(channelId)
    if (!channel || !isEstablishedFn(channel)) {
      return []
    }

    const peerState = this.model.peers.get(channel.peerId)
    if (!peerState) {
      return []
    }

    return Array.from(peerState.subscriptions)
  }

  /**
   * Get all peers
   */
  public getPeers(): PeerState[] {
    return Array.from(this.model.peers.values())
  }

  /**
   * Get the current ready states for a document
   */
  public getReadyStates(docId: DocId): ReadyState[] {
    return getReadyStates(this.model, docId)
  }

  /**
   * Wait until a docId is "ready", with "ready" meaning any number of flexible things:
   * e.g.
   * - the document has been loaded from a storage channel
   * - the document has been loaded from the server
   * - with regard to the document, all channels (peers) have responded
   *
   * All of this flexibility is achieved by allowing you to pass a "predicate" function
   * that returns true or false depending on your needs.
   *
   * @param docId The document ID under test for the predicate
   * @param predicate A condition to wait for--the predicate is passed a ReadyState[] array
   */
  async waitUntilReady(
    docId: DocId,
    predicate: (readyStates: ReadyState[]) => boolean,
  ) {
    this.logger.debug("wait-until-ready is WAITING for {docId}", { docId })

    const docState = this.model.documents.get(docId)

    if (!docState) {
      this.logger.warn(`wait-until-ready unable to get doc-state`)
      return
    }

    const readyStates = getReadyStates(this.model, docId)

    if (predicate(readyStates)) {
      this.logger.debug("wait-until-ready is READY (immediate) for {docId}", {
        docId,
      })
      return
    }

    // Wait for ready-state-changed events using async iteration
    for await (const event of this.emitter.events("ready-state-changed")) {
      // The event contains the readyStates array directly
      if (event.docId === docId && predicate(event.readyStates)) {
        // Condition met, we're done waiting
        break
      }
    }

    this.logger.debug("wait-until-ready is READY for {docId}", { docId })
  }

  // =-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=- =-=-=-=-=-=-=-=
  // INTERNAL RUNTIME
  // =-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=

  /**
   * Dispatch a message to the synchronizer program.
   *
   * If we're already inside the work queue processing loop, execute inline.
   * Otherwise, enqueue the work and process until quiescent.
   *
   * This unified approach handles both:
   * 1. Preventing recursion from synchronous adapters
   * 2. Batching outbound messages until quiescence
   */
  #dispatch(message: SynchronizerMessage) {
    if (this.#workQueue.isProcessing) {
      // Already inside work queue - execute inline
      this.#dispatchInternal(message)
    } else {
      // Not processing - enqueue and process
      this.#workQueue.enqueue(() => this.#dispatchInternal(message))
    }
  }

  /**
   * Internal dispatch implementation.
   * Runs the update function and executes any resulting command.
   */
  #dispatchInternal(message: SynchronizerMessage) {
    if (!this.model) {
      throw new Error("synchronizer model required")
    }

    const [newModel, command] = this.updateFn(message, this.model)

    // We update the Synchronizer instance's model here, allowing us access to data
    // "inside" the TEA program. This is useful because we want the DocHandle class
    // to be able to wrap the Synchronizer as a public API.
    this.model = newModel

    if (command) {
      this.#executeCommand(command)
    }
    // Note: No flush here - flushing happens at quiescence in #processUntilQuiescent
  }

  /**
   * Check for ready-state changes and emit events.
   * Only called at the outermost dispatch level.
   */
  #emitReadyStateChanges() {
    // After all changes, compare ready-states before and after; emit ready-state-changed
    // We need to check both:
    // 1. Documents that exist in the model (may have changed)
    // 2. Documents that were cached but no longer exist (deleted)
    const docIdsToCheck = new Set([
      ...this.model.documents.keys(),
      ...this.readyStates.keys(),
    ])

    for (const docId of docIdsToCheck) {
      const oldReadyStates = this.readyStates.get(docId) ?? []

      const newReadyStates = getReadyStates(this.model, docId)

      if (!equal(oldReadyStates, newReadyStates)) {
        // console.dir({ docId, oldReadyStates, newReadyStates }, { depth: null })

        // If document was deleted, remove from cache; otherwise update cache
        if (!this.model.documents.has(docId)) {
          this.readyStates.delete(docId)
        } else {
          this.readyStates.set(docId, newReadyStates)
        }

        this.emitter.emit("ready-state-changed", {
          docId,
          readyStates: newReadyStates,
        })
      }
    }
  }

  /**
   * Execute a command using the command handler registry.
   * Delegates to the CommandExecutor which looks up the appropriate handler.
   */
  #executeCommand(command: Command) {
    this.#commandExecutor.execute(command)
  }

  /**
   * Build the command context for command handlers.
   * This provides all dependencies handlers need to execute.
   */
  #buildCommandContext(): CommandContext {
    return {
      // Model access (read-only snapshot)
      model: this.model,

      // Services
      adapters: this.adapters,
      ephemeralManager: this.#ephemeralManager,
      outboundBatcher: this.#outboundBatcher,
      emitter: this.emitter,

      // Identity
      identity: this.identity,

      // Utilities
      logger: this.logger,
      dispatch: msg => this.#dispatch(msg),
      executeCommand: cmd => this.#executeCommand(cmd),

      // Helper functions
      validateChannelForSend: channelId =>
        this.#validateChannelForSend(channelId),
      queueSend: (channelId, message) => this.#queueSend(channelId, message),
      getNamespacedStore: (docId, namespace) =>
        this.getNamespacedStore(docId, namespace),
      getOrCreateNamespacedStore: (docId, namespace) =>
        this.getOrCreateNamespacedStore(docId, namespace),
      encodeAllPeerStores: docId => this.#encodeAllPeerStores(docId),
      buildSyncResponseMessage: (
        docId,
        requesterDocVersion,
        toChannelId,
        includeEphemeral,
      ) =>
        this.#buildSyncResponseMessage(
          docId,
          requesterDocVersion,
          toChannelId,
          includeEphemeral,
        ),
      buildSyncRequestMessage: (doc, bidirectional, includeEphemeral) =>
        this.#buildSyncRequestMessage(doc, bidirectional, includeEphemeral),

      // Access to docNamespacedStores
      docNamespacedStores: this.docNamespacedStores,
    }
  }

  #validateChannelForSend(channelId: ChannelId): boolean {
    const channel = this.model.channels.get(channelId)

    if (!channel) {
      this.logger.warn("Cannot send: channel {channelId} not found", {
        channelId,
      })
      return false
    }

    if (!isEstablishedFn(channel)) {
      this.logger.warn("Cannot send: channel {channelId} not established", {
        channelId,
      })
      return false
    }

    return true
  }

  /**
   * Queue a message to be sent to a channel.
   * Messages are aggregated by channel and flushed at quiescence.
   */
  #queueSend(channelId: ChannelId, message: BatchableMsg): void {
    this.#outboundBatcher.queue(channelId, message)
  }

  /**
   * Encode all namespaced stores for a document.
   * Returns an array of { docId, peerId, data, namespace } for each store with data.
   */
  #encodeAllPeerStores(
    docId: DocId,
  ): { docId: DocId; peerId: PeerID; data: Uint8Array; namespace: string }[] {
    const encoded = this.#ephemeralManager.encodeAll(docId)
    return encoded.map(e => ({
      docId,
      peerId: e.peerId,
      data: e.data,
      namespace: e.namespace,
    }))
  }

  /**
   * Build a sync-response message for a document.
   * Returns undefined if the message cannot be built (doc not found, channel not found).
   */
  #buildSyncResponseMessage(
    docId: DocId,
    requesterDocVersion: VersionVector,
    toChannelId: ChannelId,
    includeEphemeral?: boolean,
  ): ChannelMsgSyncResponse | undefined {
    const docState = this.model.documents.get(docId)
    if (!docState) {
      this.logger.warn("can't get doc-state, doc {docId} not found", { docId })
      return undefined
    }

    // No need to check channel state - just verify channel exists
    const channel = this.model.channels.get(toChannelId)
    if (!channel) {
      this.logger.warn(
        "can't send sync-response, channel {toChannelId} doesn't exist",
        {
          toChannelId,
        },
      )
      return undefined
    }

    // Check if requester has empty version (new client)
    // An empty version vector means the requester has no state
    const ourVersion = docState.doc.version()
    const comparison = ourVersion.compare(requesterDocVersion)

    // If comparison is 1, we're ahead (send update)
    // If comparison is 0, we're equal (up-to-date)
    // If comparison is undefined, versions are concurrent (send update - Loro handles this!)
    // If requester version length is 0, they have nothing (send snapshot)
    const isEmpty = requesterDocVersion.length() === 0

    this.logger.info(
      "#buildSyncResponseMessage version check for {docId} on {channelId}",
      {
        channelId: toChannelId,
        docId,
        requesterDocVersionLength: requesterDocVersion.length(),
        ourVersionLength: ourVersion.length(),
        comparison,
        isEmpty,
        requesterVersionType: typeof requesterDocVersion,
        requesterVersionConstructor: requesterDocVersion.constructor.name,
      },
    )

    let transmission: SyncTransmission

    // If comparison is 0 (equal) or -1 (they are ahead), we have nothing new to send
    if ((comparison === 0 || comparison === -1) && !isEmpty) {
      this.logger.debug(
        "building sync-response (up-to-date) for {docId} to {channelId}",
        {
          channelId: toChannelId,
          docId,
          comparison,
        },
      )

      transmission = {
        type: "up-to-date",
        version: ourVersion,
      }
    } else {
      // Export the document data to send as sync response
      // If requester has empty version, send full snapshot
      // Otherwise send update delta from their version
      const data = docState.doc.export({
        mode: isEmpty ? "snapshot" : "update",
        from: isEmpty ? undefined : requesterDocVersion,
      })

      this.logger.debug(
        "building sync-response ({transmissionType}) for {docId} to {channelId}",
        {
          channelId: toChannelId,
          docId,
          isEmpty,
          transmissionType: isEmpty ? "snapshot" : "update",
        },
      )

      transmission = isEmpty
        ? {
            type: "snapshot" as const,
            data,
            version: ourVersion,
          }
        : {
            type: "update" as const,
            data,
            version: ourVersion,
          }
    }

    // Build the sync-response message
    const syncResponseMessage: ChannelMsgSyncResponse = {
      type: "channel/sync-response" as const,
      docId,
      transmission,
    }

    // Include ephemeral snapshot if requested
    if (includeEphemeral) {
      // Encode all namespaced stores (touch is handled inside #encodeAllPeerStores)
      const stores = this.#encodeAllPeerStores(docId)
      if (stores.length > 0) {
        syncResponseMessage.ephemeral = stores.map(s => ({
          peerId: s.peerId,
          data: s.data,
          namespace: s.namespace,
        }))
        this.logger.debug(
          "including ephemeral data in sync-response for {docId} to {channelId}",
          {
            docId,
            channelId: toChannelId,
            storeCount: stores.length,
          },
        )
      }
    }

    return syncResponseMessage
  }

  /**
   * Build a single sync-request message for a document.
   */
  #buildSyncRequestMessage(
    doc: { docId: DocId; requesterDocVersion: VersionVector },
    bidirectional: boolean,
    includeEphemeral?: boolean,
  ): ChannelMsgSyncRequest {
    const result: ChannelMsgSyncRequest = {
      type: "channel/sync-request",
      docId: doc.docId,
      requesterDocVersion: doc.requesterDocVersion,
      bidirectional,
    }

    // Include ephemeral data if requested
    // For sync-request, we encode all our namespaced stores
    if (includeEphemeral) {
      const stores = this.#encodeAllPeerStores(doc.docId)

      if (stores.length > 0) {
        result.ephemeral = stores.map(s => ({
          peerId: this.identity.peerId,
          data: s.data,
          namespace: s.namespace,
        }))
        this.logger.debug(
          "building sync-request with ephemeral data for {docId}",
          {
            docId: doc.docId,
            storeCount: stores.length,
          },
        )
      }
    }

    return result
  }

  /**
   * Remove a document from the synchronizer and send delete messages to all channels.
   *
   * The dispatch handles both:
   * 1. Removing the document from the model
   * 2. Sending delete-request messages to all subscribed peers (via deferred send)
   */
  public async removeDocument(docId: DocId): Promise<void> {
    const docState = this.model.documents.get(docId)

    if (!docState) {
      this.logger.debug("removeDocument: document {docId} not found", { docId })
      return
    }

    // Dispatch handles both model update and sending delete-request
    this.#dispatch({ type: "synchronizer/doc-delete", docId })
  }

  public async reset() {
    // TODO(duane): Should we stop/start the heartbeat? It doesn't seem to add value to do so. Maybe we should have a stop/start function on Synchronizer?

    const [initialModel] = programInit(this.model.identity)

    // Reset all adapters via AdapterManager
    this.adapters.reset()

    this.model = initialModel
  }

  /**
   * Get the current model state (for debugging purposes).
   * Returns a deep copy to prevent accidental mutations.
   */
  public getModelSnapshot(): SynchronizerModel {
    return create(this.model)[0]
  }
}
