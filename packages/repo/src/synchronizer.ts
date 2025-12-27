import { getLogger, type Logger } from "@logtape/logtape"
import Emittery from "emittery"
import type { EphemeralStore, Value, VersionVector } from "loro-crdt"
import { create, type Patch } from "mutative"
import type { AnyAdapter } from "./adapter/adapter.js"
import { AdapterManager } from "./adapter/adapter-manager.js"
import type {
  Channel,
  ChannelMsg,
  ChannelMsgSyncResponse,
  ConnectedChannel,
  EphemeralStoreData,
  SyncTransmission,
} from "./channel.js"
import { isEstablished as isEstablishedFn } from "./channel.js"
import { createRules, type Rules } from "./rules.js"
import { getReadyStates } from "./synchronizer/state-helpers.js"
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
  rules?: Rules
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

  /**
   * Per-doc namespaced ephemeral stores (unified model).
   *
   * Structure: Map<DocId, Map<Namespace, EphemeralStore>>
   *
   * Each document can have multiple named ephemeral stores.
   * This supports both internal stores (declared via ephemeralShapes)
   * and external stores (registered via addEphemeral).
   */
  readonly docNamespacedStores = new Map<DocId, Map<string, EphemeralStore>>()

  /**
   * External store subscriptions for cleanup.
   * Maps store to its unsubscribe function.
   */
  readonly #externalStoreSubscriptions = new Map<EphemeralStore, () => void>()

  readonly emitter = new Emittery<SynchronizerEvents>()

  readonly readyStates = new Map<DocId, ReadyState[]>()

  model: SynchronizerModel

  heartbeat: ReturnType<typeof setInterval> | undefined

  constructor({
    identity,
    adapters = [],
    rules,
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
      rules: createRules(rules),
      onUpdate,
      logger,
    })

    // Initialize model BEFORE creating AdapterManager, since adapters may
    // trigger channelAdded which needs the model
    const [initialModel, initialCommand] = programInit(this.identity)
    this.model = initialModel

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

    this.startHeartbeat()
  }

  startHeartbeat() {
    this.heartbeat = setInterval(() => {
      this.#dispatch({ type: "synchronizer/heartbeat" })
    }, HEARTBEAT_INTERVAL)
  }

  stopHeartbeat() {
    clearInterval(this.heartbeat)
    this.heartbeat = undefined
  }

  channelReceive(channel: Channel, message: ChannelMsg) {
    this.logger.trace("onReceive: {messageType} from {channelId}", {
      channelId: channel.channelId,
      messageType: message.type,
    })
    this.#dispatch({
      type: "synchronizer/channel-receive-message",
      envelope: {
        fromChannelId: channel.channelId,
        message,
      },
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
    let namespaceStores = this.docNamespacedStores.get(docId)
    if (!namespaceStores) {
      namespaceStores = new Map()
      this.docNamespacedStores.set(docId, namespaceStores)
    }

    let store = namespaceStores.get(namespace)
    if (!store) {
      // Create a new TimerlessEphemeralStore for internal stores
      store = new TimerlessEphemeralStore()
      namespaceStores.set(namespace, store)

      // Subscribe to changes and broadcast
      this.#subscribeToNamespacedStore(docId, namespace, store)

      this.logger.debug(
        "Created namespaced store {namespace} for doc {docId}",
        { namespace, docId },
      )
    }

    return store
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
    let namespaceStores = this.docNamespacedStores.get(docId)
    if (!namespaceStores) {
      namespaceStores = new Map()
      this.docNamespacedStores.set(docId, namespaceStores)
    }

    if (namespaceStores.has(namespace)) {
      throw new Error(
        `Ephemeral store "${namespace}" already exists for doc "${docId}"`,
      )
    }

    namespaceStores.set(namespace, store)

    // Subscribe to changes and broadcast
    this.#subscribeToNamespacedStore(docId, namespace, store)

    this.logger.debug("Registered external store {namespace} for doc {docId}", {
      namespace,
      docId,
    })
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
    return this.docNamespacedStores.get(docId)?.get(namespace)
  }

  /**
   * Broadcast a namespaced store to all peers.
   * This is called explicitly by the Handle when local changes are made.
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

    this.#broadcastNamespacedStore(docId, namespace, store)

    // Emit change event for UI updates
    void this.emitter.emit("ephemeral-change", {
      docId,
      source: "local",
    })
  }

  /**
   * Subscribe to a namespaced store and set up broadcasting.
   *
   * Uses the EphemeralStore.subscribe() callback's `by` field to filter:
   * - `by: 'local'` → broadcast (change was made via `set()`)
   * - `by: 'import'` → don't broadcast (change came from network via `apply()`)
   *
   * This works for both internal TypedEphemeral stores AND external stores
   * (like loro-prosemirror) because they all use the same EphemeralStore API.
   */
  #subscribeToNamespacedStore(
    docId: DocId,
    namespace: string,
    store: EphemeralStore,
  ): void {
    const unsub = store.subscribe(event => {
      // Only broadcast local changes (not imported data from network)
      if (event.by === "local") {
        this.#broadcastNamespacedStore(docId, namespace, store)

        // Emit change event for UI updates
        void this.emitter.emit("ephemeral-change", {
          docId,
          source: "local",
        })
      }
    })

    // Store the unsubscribe function for cleanup
    this.#externalStoreSubscriptions.set(store, unsub)
  }

  /**
   * Broadcast a namespaced store to all peers subscribed to the document.
   *
   * Note: We intentionally do NOT call store.touch() here. The touch() method
   * calls set() on each key, which triggers the subscription callback with
   * by='local'. This would cause an infinite loop when broadcasting from
   * within a subscription callback.
   *
   * For heartbeat broadcasts (which need fresh timestamps), use the
   * cmd/broadcast-ephemeral command which handles touch() appropriately.
   */
  #broadcastNamespacedStore(
    docId: DocId,
    namespace: string,
    store: EphemeralStore,
  ): void {
    const data = store.encodeAll()
    if (data.length === 0) {
      return
    }

    const channelIds = this.#getChannelsForDoc(docId)
    if (channelIds.length === 0) {
      return
    }

    this.adapters.send({
      toChannelIds: channelIds,
      message: {
        type: "channel/ephemeral",
        docId,
        hopsRemaining: 1, // Allow hub/server to relay to other clients
        stores: [
          {
            peerId: this.identity.peerId,
            data,
            namespace, // Include namespace in the message
          },
        ],
      },
    })

    this.logger.trace(
      "Broadcast namespaced store {namespace} for doc {docId} to {channelCount} channels",
      { namespace, docId, channelCount: channelIds.length },
    )
  }

  /**
   * Encode all namespaced stores for a document.
   * Returns an array of { docId, peerId, data, namespace } for each store with data.
   *
   * All stores are namespaced.
   */
  #encodeAllPeerStores(
    docId: DocId,
  ): { docId: DocId; peerId: PeerID; data: Uint8Array; namespace: string }[] {
    const result: {
      docId: DocId
      peerId: PeerID
      data: Uint8Array
      namespace: string
    }[] = []

    // Encode all namespaced stores
    const namespaceStores = this.docNamespacedStores.get(docId)
    if (namespaceStores) {
      for (const [namespace, store] of namespaceStores) {
        // Touch the store to update timestamps before encoding
        if (store instanceof TimerlessEphemeralStore) {
          store.touch()
        }
        const data = store.encodeAll()
        if (data.length > 0) {
          // For namespaced stores, we use our own peerId since we're the source
          result.push({ docId, peerId: this.identity.peerId, data, namespace })
        }
      }
    }

    return result
  }

  /**
   * Get channel IDs for all peers subscribed to a document.
   */
  #getChannelsForDoc(docId: DocId): ChannelId[] {
    const channelIds: ChannelId[] = []
    for (const [channelId, channel] of this.model.channels) {
      if (isEstablishedFn(channel)) {
        const peerState = this.model.peers.get(channel.peerId)
        if (peerState?.subscriptions.has(docId)) {
          channelIds.push(channelId)
        }
      }
    }
    return channelIds
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

  getChannel(channelId: ChannelId): Channel | undefined {
    return this.model.channels.get(channelId)
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
   * Get peer state by peerId
   */
  public getPeerState(peerId: PeerID): PeerState | undefined {
    return this.model.peers.get(peerId)
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

  #dispatch(message: SynchronizerMessage) {
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
        // Validate channels before sending
        for (const channelId of command.envelope.toChannelIds) {
          this.#validateChannelForSend(channelId)
        }

        // Let the AdapterManager handle routing the envelope to the right place(s)
        const sentCount = this.adapters.send(command.envelope)

        if (sentCount < command.envelope.toChannelIds.length) {
          this.logger.warn(
            "cmd/send-message could not deliver {messageType} to all {expectedCount} channels",
            {
              messageType: command.envelope.message.type,
              expectedCount: command.envelope.toChannelIds.length,
              channelIds: command.envelope.toChannelIds,
            },
          )
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

      case "cmd/broadcast-ephemeral": {
        const docId = command.docId
        const myPeerId = this.identity.peerId
        const namespaceStores = this.docNamespacedStores.get(docId)

        if (!namespaceStores || namespaceStores.size === 0) {
          this.logger.debug(
            "cmd/broadcast-ephemeral: skipping for {docId} (no stores)",
            () => ({ docId }),
          )
          break
        }

        // Collect stores to broadcast
        // For heartbeat: only send keys matching self.peerId from each store
        // For allPeerData (sync-response): send all data
        const storesToSend: {
          peerId: PeerID
          data: Uint8Array
          namespace: string
        }[] = []

        for (const [namespace, store] of namespaceStores) {
          // Touch the store to update timestamps before encoding
          if (store instanceof TimerlessEphemeralStore) {
            store.touch()
          }

          if (command.allPeerData) {
            // Send all data (for sync-response to late joiners)
            const data = store.encodeAll()
            if (data.length > 0) {
              storesToSend.push({ peerId: myPeerId, data, namespace })
            }
          } else {
            // Heartbeat: only send if this store has a key matching my peerId
            const allStates = store.getAllStates()
            if (allStates[myPeerId] !== undefined) {
              const data = store.encodeAll()
              if (data.length > 0) {
                storesToSend.push({ peerId: myPeerId, data, namespace })
              }
            }
          }
        }

        if (storesToSend.length > 0) {
          const sent = this.adapters.send({
            toChannelIds: command.toChannelIds,
            message: {
              type: "channel/ephemeral",
              docId,
              hopsRemaining: command.hopsRemaining,
              stores: storesToSend,
            },
          })
          this.logger.trace(
            "cmd/broadcast-ephemeral: sent {docId} ephemeral to {sent} peers ({storeCount} stores)",
            { docId, sent, storeCount: storesToSend.length },
          )
        } else {
          this.logger.debug(
            "cmd/broadcast-ephemeral: skipping for {docId} (no data to send)",
            () => ({ docId }),
          )
        }
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
            // Broadcast deletion to other peers
            const channelIds = this.#getChannelsForDoc(docId)

            if (channelIds.length > 0 && storesToBroadcast.length > 0) {
              this.adapters.send({
                toChannelIds: channelIds,
                message: {
                  type: "channel/ephemeral",
                  docId,
                  hopsRemaining: 0,
                  stores: storesToBroadcast.map(s => ({
                    peerId: command.peerId,
                    data: new Uint8Array(0), // Empty data signals deletion
                    namespace: s.namespace,
                  })),
                },
              })
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

  #executeSendSyncResponse(
    docId: DocId,
    requesterDocVersion: VersionVector,
    toChannelId: ChannelId,
    includeEphemeral?: boolean,
  ) {
    const docState = this.model.documents.get(docId)
    if (!docState) {
      this.logger.warn("can't get doc-state, doc {docId} not found", { docId })
      return
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
      return
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
      "#executeSendSyncResponse version check for {docId} on {channelId}",
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
        "sending sync-response (up-to-date) for {docId} to {channelId}",
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
        "sending sync-response ({transmissionType}) for {docId} to {channelId}",
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

    const messageToSend = {
      toChannelIds: [toChannelId],
      message: syncResponseMessage,
    }

    const sentCount = this.adapters.send(messageToSend)

    if (sentCount === 0) {
      this.logger.warn("can't send sync-response to channel {toChannelId}", {
        toChannelId,
      })
    }
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

    // Build docs array with optional ephemeral data
    const docsWithEphemeral = docs.map(doc => {
      const result: {
        docId: DocId
        requesterDocVersion: VersionVector
        ephemeral?: EphemeralStoreData[]
      } = {
        docId: doc.docId,
        requesterDocVersion: doc.requesterDocVersion,
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
            "including ephemeral data in sync-request for {docId} to {channelId}",
            {
              docId: doc.docId,
              channelId: toChannelId,
              storeCount: stores.length,
            },
          )
        }
      }

      return result
    })

    const messageToSend = {
      toChannelIds: [toChannelId],
      message: {
        type: "channel/sync-request" as const,
        docs: docsWithEphemeral,
        bidirectional,
      },
    }

    const sentCount = this.adapters.send(messageToSend)

    if (sentCount === 0) {
      this.logger.warn("can't send sync-request to channel {toChannelId}", {
        toChannelId,
      })
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
   */
  public async removeDocument(docId: DocId): Promise<void> {
    const docState = this.model.documents.get(docId)

    if (!docState) {
      this.logger.debug("removeDocument: document {docId} not found", { docId })
      return
    }

    // Get all channels whose peers have subscribed to this document
    const channelIds: ChannelId[] = []
    for (const peerState of this.model.peers.values()) {
      if (peerState.subscriptions.has(docId)) {
        channelIds.push(...peerState.channels)
      }
    }

    // Send delete-request to all channels
    if (channelIds.length > 0) {
      this.adapters.send({
        toChannelIds: channelIds,
        message: {
          type: "channel/delete-request",
          docId,
        },
      })
    }

    // Remove the document from the model
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
