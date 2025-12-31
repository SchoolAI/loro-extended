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
  ChannelMsgEphemeral,
  ChannelMsgSyncRequest,
  ChannelMsgSyncResponse,
  ConnectedChannel,
  SyncTransmission,
} from "./channel.js"
import { isEstablished as isEstablishedFn } from "./channel.js"
import type { Middleware } from "./middleware.js"
import {
  createPermissions,
  type Permissions,
} from "./permissions.js"
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
import { getEstablishedChannelsForDoc } from "./utils/get-established-channels-for-doc.js"
import { TimerlessEphemeralStore } from "./utils/timerless-ephemeral-store.js"

export type HandleUpdateFn = (patches: Patch[]) => void

// Initiate a synchronizer/heartbeat every N milliseconds; used primarily for ephemeral stores
const HEARTBEAT_INTERVAL = 10000

// The events that the Synchronizer can emit
type SynchronizerEvents = {
  "ready-state-changed": {
    docId: string
    readyStates: ReadyState[]
  }
  "ephemeral-change": {
    docId: string
    /** Whether this change originated locally or from a remote peer */
    source: "local" | "remote"
    /** Which keys changed (for local changes) */
    keys?: string[]
    /** Which peer's data changed (for remote changes) */
    peerId?: string
  }
}

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
    this.#workQueue.enqueue(() => this.#channelReceiveInternal(channelId, message))
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
  #handleBatchMessage(
    channelId: ChannelId,
    messages: BatchableMsg[],
  ): void {
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
    void this.#middlewareProcessor.processBatch(channelId, messages).then(result => {
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
  #runMiddlewareAndDispatch(
    channelId: ChannelId,
    message: ChannelMsg,
  ): void {
    void this.#middlewareProcessor.processMessage(channelId, message).then(result => {
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

  #executeCommand(command: Command) {
    switch (command.type) {
      case "cmd/stop-channel": {
        // Time to de-initialize a channel
        command.channel.stop()
        break
      }

      case "cmd/send-establishment-message": {
        // Send establishment messages (these can be sent to non-established channels)
        this.logger.debug(
          "executing cmd/send-establishment-message: {messageType}",
          {
            messageType: command.envelope.message.type,
            toChannelIds: command.envelope.toChannelIds,
            totalAdapters: this.adapters.adapters.length,
            adapterChannelCounts: this.adapters.adapters.map(a => ({
              adapterType: a.adapterType,
              channelCount: a.channels.size,
            })),
          },
        )

        const sentCount = this.adapters.sendEstablishmentMessage(
          command.envelope,
        )

        this.logger.debug(
          "cmd/send-establishment-message result: sent {sentCount}/{expectedCount}",
          {
            sentCount,
            expectedCount: command.envelope.toChannelIds.length,
          },
        )

        if (sentCount < command.envelope.toChannelIds.length) {
          this.logger.warn(
            "cmd/send-establishment-message could not deliver {messageType} to all {expectedCount} channels",
            {
              messageType: command.envelope.message.type,
              expectedCount: command.envelope.toChannelIds.length,
              channelIds: command.envelope.toChannelIds,
            },
          )
        }

        break
      }

      case "cmd/send-message": {
        // Queue messages for deferred send (aggregated at end of dispatch)
        for (const channelId of command.envelope.toChannelIds) {
          if (!this.#validateChannelForSend(channelId)) continue

          // Flatten nested batches
          if (command.envelope.message.type === "channel/batch") {
            for (const msg of command.envelope.message.messages) {
              this.#queueSend(channelId, msg)
            }
          } else {
            this.#queueSend(channelId, command.envelope.message as BatchableMsg)
          }
        }
        break
      }

      case "cmd/send-sync-response": {
        this.#executeSendSyncResponse(
          command.docId,
          command.requesterDocVersion,
          command.toChannelId,
          command.includeEphemeral,
        )
        break
      }

      case "cmd/send-sync-request": {
        this.#executeSendSyncRequest(
          command.toChannelId,
          command.docs,
          command.bidirectional,
          command.includeEphemeral,
        )
        break
      }

      case "cmd/subscribe-doc": {
        this.#executeSubscribeDoc(command.docId)
        break
      }

      case "cmd/import-doc-data": {
        this.#executeImportDocData(
          command.docId,
          command.data,
          command.fromPeerId,
        )
        break
      }

      case "cmd/emit-ephemeral-change": {
        this.emitter.emit("ephemeral-change", {
          docId: command.docId,
          source: "local",
        })
        break
      }

      case "cmd/apply-ephemeral": {
        const docId = command.docId

        // All ephemeral messages must have a namespace
        for (const storeData of command.stores) {
          const { peerId, data, namespace } = storeData

          if (!namespace) {
            this.logger.warn(
              "cmd/apply-ephemeral: received message without namespace from {peerId} in {docId}, ignoring",
              { peerId, docId },
            )
            continue
          }

          if (data.length === 0) {
            // Empty data - could indicate deletion, but for namespaced stores
            // we don't delete the whole store, just let the data expire
            this.logger.debug(
              "cmd/apply-ephemeral: received empty data for namespace {namespace} from {peerId} in {docId}",
              { namespace, peerId, docId },
            )
          } else {
            // Get or create the namespaced store and apply the data
            const store = this.getOrCreateNamespacedStore(docId, namespace)
            store.apply(data)

            this.logger.trace(
              "cmd/apply-ephemeral: applied {dataLength} bytes to namespace {namespace} from {peerId} in {docId}",
              { namespace, peerId, docId, dataLength: data.length },
            )
          }

          void this.emitter.emit("ephemeral-change", {
            docId,
            source: "remote",
            peerId,
          })
        }
        break
      }

      case "cmd/broadcast-ephemeral-batch": {
        // Macro command: expands into multiple cmd/broadcast-ephemeral-namespace commands.
        // Each sub-command queues messages via #queueSend(); the deferred send layer
        // aggregates them into a single channel/batch message at flush time.
        const subCommands: Command[] = []

        for (const docId of command.docIds) {
          const namespaceStores = this.docNamespacedStores.get(docId)

          if (!namespaceStores || namespaceStores.size === 0) {
            continue
          }

          // Touch all stores before encoding (for heartbeat timestamp refresh)
          for (const store of namespaceStores.values()) {
            if (store instanceof TimerlessEphemeralStore) {
              store.touch()
            }
          }

          // Create a command for each namespace
          for (const namespace of namespaceStores.keys()) {
            subCommands.push({
              type: "cmd/broadcast-ephemeral-namespace",
              docId,
              namespace,
              hopsRemaining: command.hopsRemaining,
              toChannelIds: [command.toChannelId],
            })
          }
        }

        if (subCommands.length === 0) {
          this.logger.debug(
            "cmd/broadcast-ephemeral-batch: skipping (no stores to broadcast)",
          )
          break
        }

        // Execute all sub-commands; each queues messages via #queueSend()
        // The deferred send layer aggregates them at flush time
        for (const cmd of subCommands) {
          this.#executeCommand(cmd)
        }

        this.logger.trace(
          "cmd/broadcast-ephemeral-batch: expanded into {cmdCount} namespace broadcasts for channel {channelId}",
          {
            cmdCount: subCommands.length,
            channelId: command.toChannelId,
          },
        )
        break
      }

      case "cmd/broadcast-ephemeral-namespace": {
        // Broadcast a single namespace's ephemeral data for a document
        const { docId, namespace, hopsRemaining, toChannelIds } = command
        const store = this.getNamespacedStore(docId, namespace)

        if (!store) {
          this.logger.debug(
            "cmd/broadcast-ephemeral-namespace: skipping for {docId}/{namespace} (store not found)",
            () => ({ docId, namespace }),
          )
          break
        }

        const data = store.encodeAll()
        if (data.length === 0) {
          this.logger.debug(
            "cmd/broadcast-ephemeral-namespace: skipping for {docId}/{namespace} (no data)",
            () => ({ docId, namespace }),
          )
          break
        }

        if (toChannelIds.length === 0) {
          this.logger.debug(
            "cmd/broadcast-ephemeral-namespace: skipping for {docId}/{namespace} (no channels)",
            () => ({ docId, namespace }),
          )
          break
        }

        // Build the ephemeral message
        const message: ChannelMsgEphemeral = {
          type: "channel/ephemeral",
          docId,
          hopsRemaining,
          stores: [
            {
              peerId: this.identity.peerId,
              data,
              namespace,
            },
          ],
        }

        // Queue for each channel (deferred send will aggregate)
        for (const channelId of toChannelIds) {
          this.#queueSend(channelId, message)
        }

        this.logger.trace(
          "cmd/broadcast-ephemeral-namespace: queued {namespace} for {docId} to {channelCount} channels",
          { namespace, docId, channelCount: toChannelIds.length },
        )
        break
      }

      case "cmd/remove-ephemeral-peer": {
        // Remove the peer's data from all documents' namespaced stores
        for (const [docId, namespaceStores] of this.docNamespacedStores) {
          let peerDataRemoved = false
          const storesToBroadcast: { namespace: string }[] = []

          // Check ALL namespaces for this peer's data
          for (const [namespace, store] of namespaceStores) {
            const allStates = store.getAllStates()
            if (allStates[command.peerId] !== undefined) {
              // Delete the peer's key from this store
              store.delete(command.peerId)
              peerDataRemoved = true
              storesToBroadcast.push({ namespace })
            }
          }

          if (peerDataRemoved) {
            // Broadcast deletion to other peers using the utility function
            const channelIds = getEstablishedChannelsForDoc(
              this.model.channels,
              this.model.peers,
              docId,
            )

            if (channelIds.length > 0 && storesToBroadcast.length > 0) {
              // Build the ephemeral deletion message
              const ephemeralMessage: ChannelMsgEphemeral = {
                type: "channel/ephemeral",
                docId,
                hopsRemaining: 0,
                stores: storesToBroadcast.map(s => ({
                  peerId: command.peerId,
                  data: new Uint8Array(0), // Empty data signals deletion
                  namespace: s.namespace,
                })),
              }

              // Queue for each channel (deferred send will aggregate)
              for (const channelId of channelIds) {
                this.#queueSend(channelId, ephemeralMessage)
              }
            }

            // Emit change event so UI updates immediately
            // This is "remote" because we're removing a remote peer's data
            this.emitter.emit("ephemeral-change", {
              docId,
              source: "remote",
              peerId: command.peerId,
            })
          }
        }
        break
      }

      // (utility): A command that sends a dispatch back into the program message loop
      case "cmd/dispatch": {
        this.#dispatch(command.dispatch)
        break
      }

      // (utility): A command that executes a batch of commands
      case "cmd/batch": {
        for (const cmd of command.commands) {
          this.#executeCommand(cmd)
        }
        break
      }
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
      namespace: e.namespace!,
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

  #executeSendSyncResponse(
    docId: DocId,
    requesterDocVersion: VersionVector,
    toChannelId: ChannelId,
    includeEphemeral?: boolean,
  ) {
    const message = this.#buildSyncResponseMessage(
      docId,
      requesterDocVersion,
      toChannelId,
      includeEphemeral,
    )
    if (message) {
      this.#queueSend(toChannelId, message)
    }
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

  #executeSendSyncRequest(
    toChannelId: ChannelId,
    docs: { docId: DocId; requesterDocVersion: VersionVector }[],
    bidirectional: boolean,
    includeEphemeral?: boolean,
  ) {
    // Validate channel exists
    const channel = this.model.channels.get(toChannelId)
    if (!channel) {
      this.logger.warn(
        "can't send sync-request, channel {toChannelId} doesn't exist",
        { toChannelId },
      )
      return
    }

    // Queue each sync-request message individually
    // The deferred send layer will aggregate them into a batch at flush time
    for (const doc of docs) {
      const message = this.#buildSyncRequestMessage(
        doc,
        bidirectional,
        includeEphemeral,
      )
      this.#queueSend(toChannelId, message)
    }
  }

  #executeSubscribeDoc(docId: DocId) {
    const docState = this.model.documents.get(docId)
    if (!docState) {
      this.logger.warn("can't get doc-state, doc {docId} not found", { docId })
      return
    }

    /**
     * Subscribe to local changes, to be handled by local-doc-change.
     *
     * NOTE: Remote (imported) changes are handled explicitly in handle-sync-response.
     */
    docState.doc.subscribeLocalUpdates(() => {
      this.#dispatch({
        type: "synchronizer/local-doc-change",
        docId,
      })
    })
    // For "import" events, we don't dispatch local-doc-change here.
    // The import is triggered by cmd/import-doc-data, which is followed by
    // a cmd/dispatch for doc-change with proper peer awareness already set.
  }

  #executeImportDocData(docId: DocId, data: Uint8Array, fromPeerId: PeerID) {
    const docState = this.model.documents.get(docId)
    if (!docState) {
      this.logger.warn("can't import doc data, doc {docId} not found", {
        docId,
      })
      return
    }

    // Import the document data
    // Note: doc.subscribe() only fires for "local" events, so import won't trigger it
    docState.doc.import(data)

    // After import, dispatch a message to:
    // 1. Update peer awareness to our CURRENT version (prevents echo)
    // 2. Trigger doc-change for multi-hop propagation to OTHER peers
    //
    // We pass fromPeerId so the doc-change handler knows to skip this peer
    // (they just sent us this data, so they already have it)
    this.#dispatch({
      type: "synchronizer/doc-imported",
      docId,
      fromPeerId,
    })
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
