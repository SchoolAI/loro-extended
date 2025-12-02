import { getLogger, type Logger } from "@logtape/logtape"
import Emittery from "emittery"
import { EphemeralStore, type Value, type VersionVector } from "loro-crdt"
import { create, type Patch } from "mutative"
import type { AnyAdapter } from "./adapter/adapter.js"
import { AdapterManager } from "./adapter/adapter-manager.js"
import type {
  Channel,
  ChannelMsg,
  ChannelMsgSyncResponse,
  ConnectedChannel,
  EphemeralPeerData,
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
  }
}

type SynchronizerParams = {
  identity: PeerIdentityDetails
  adapters: AnyAdapter[]
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
   * Per-doc-peer ephemeral stores.
   *
   * Structure: Map<DocId, Map<PeerID, EphemeralStore>>
   *
   * Each document has a map of peer stores:
   * - "My" store uses TimerlessEphemeralStore (never expires)
   * - Others' stores use regular EphemeralStore with timeout
   *
   * Each store contains multiple keys (cursor, name, mouseX, etc.)
   * representing that peer's presence data in that document.
   */
  readonly docPeerStores = new Map<DocId, Map<PeerID, EphemeralStore>>()

  readonly emitter = new Emittery<SynchronizerEvents>()

  readonly readyStates = new Map<DocId, ReadyState[]>()

  model: SynchronizerModel

  heartbeat: ReturnType<typeof setInterval> | undefined

  constructor({
    identity,
    adapters,
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

    this.adapters = new AdapterManager({
      adapters,
      onReset: (adapter: AnyAdapter) => {
        for (const channel of adapter.channels) {
          this.channelRemoved(channel)
        }
      },
      logger,
    })

    this.updateFn = createSynchronizerUpdate({
      rules: createRules(rules),
      onUpdate,
      logger,
    })

    const [initialModel, initialCommand] = programInit(this.identity)
    this.model = initialModel
    if (initialCommand) {
      this.#executeCommand(initialCommand)
    }

    // Phase 1: Initialize all adapters
    for (const adapter of adapters) {
      adapter._initialize({
        identity: this.identity,
        logger: this.logger,
        onChannelAdded: this.channelAdded.bind(this),
        onChannelRemoved: this.channelRemoved.bind(this),
        onChannelReceive: this.channelReceive.bind(this),
        onChannelEstablish: this.channelEstablish.bind(this),
      })
    }

    // Phase 2: Start all adapters (async, but don't wait)
    // Channels will be added as they become ready
    for (const adapter of adapters) {
      void adapter._start()
    }

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
  // PUBLIC API - Ephemeral Store Management
  // =-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=

  /**
   * Get or create the Map of peer stores for a document.
   */
  getOrCreateDocStores(docId: DocId): Map<PeerID, EphemeralStore> {
    let peerStores = this.docPeerStores.get(docId)
    if (!peerStores) {
      peerStores = new Map()
      this.docPeerStores.set(docId, peerStores)
    }
    return peerStores
  }

  /**
   * Get or create a peer's ephemeral store for a document.
   *
   * - "My" store uses TimerlessEphemeralStore (never expires)
   * - Others' stores use regular EphemeralStore with timeout
   *
   * @param docId The document ID
   * @param peerId The peer ID
   * @returns The peer's ephemeral store for this document
   */
  getOrCreatePeerEphemeralStore(docId: DocId, peerId: PeerID): EphemeralStore {
    const peerStores = this.getOrCreateDocStores(docId)
    let store = peerStores.get(peerId)

    if (!store) {
      const isMyStore = peerId === this.identity.peerId
      store = isMyStore
        ? new TimerlessEphemeralStore()
        : new EphemeralStore(HEARTBEAT_INTERVAL * 2)
      peerStores.set(peerId, store)
    }

    return store
  }

  /**
   * Get my ephemeral store for a document (convenience method).
   */
  getMyEphemeralStore(docId: DocId): EphemeralStore {
    return this.getOrCreatePeerEphemeralStore(docId, this.identity.peerId)
  }

  /**
   * Sets values on my presence for a document.
   * Each key-value pair is set individually in my store.
   */
  setEphemeralValues(docId: DocId, values: ObjectValue) {
    const store = this.getMyEphemeralStore(docId)

    for (const [key, value] of Object.entries(values)) {
      store.set(key, value)
    }

    this.#dispatch({ type: "synchronizer/ephemeral-local-change", docId })
  }

  /**
   * Gets all values for a peer's presence in a document.
   */
  getEphemeralValues(docId: DocId, peerId: PeerID): ObjectValue {
    const store = this.getOrCreatePeerEphemeralStore(docId, peerId)
    return store.getAllStates() as ObjectValue
  }

  /**
   * Get all peers' presence data for a document (aggregated on-demand).
   */
  getAllEphemeralStates(docId: DocId): Record<PeerID, ObjectValue> {
    const peerStores = this.docPeerStores.get(docId)
    if (!peerStores) return {}

    const result: Record<PeerID, ObjectValue> = {}
    for (const [peerId, store] of peerStores) {
      const states = store.getAllStates()
      // Only include peers with non-empty state
      if (Object.keys(states).length > 0) {
        result[peerId] = states as ObjectValue
      }
    }
    return result
  }

  /**
   * Encode all peer stores for a document.
   * Returns an array of { docId, peerId, data } for each peer with data.
   */
  #encodeAllPeerStores(
    docId: DocId,
  ): { docId: DocId; peerId: PeerID; data: Uint8Array }[] {
    const peerStores = this.docPeerStores.get(docId)
    if (!peerStores) return []

    const result: { docId: DocId; peerId: PeerID; data: Uint8Array }[] = []
    for (const [peerId, store] of peerStores) {
      const data = store.encodeAll()
      if (data.length > 0) {
        result.push({ docId, peerId, data })
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
        this.emitter.emit("ephemeral-change", { docId: command.docId })
        break
      }

      case "cmd/apply-ephemeral": {
        const docId = command.docId

        // New format: array of per-peer stores
        for (const { peerId, data } of command.stores) {
          if (data.length === 0) {
            // Empty data indicates we must delete
            const peerStores = this.docPeerStores.get(docId)
            if (peerStores) {
              peerStores.delete(peerId)
            }
            this.logger.debug(
              "cmd/apply-ephemeral: deleted store for {peerId} in {docId}",
              { peerId, docId },
            )
          } else {
            const store = this.getOrCreatePeerEphemeralStore(docId, peerId)

            store.apply(data)

            this.logger.trace(
              "cmd/apply-ephemeral: applied {dataLength} bytes for {peerId} in {docId}",
              { peerId, docId, dataLength: data.length },
            )
          }
          this.emitter.emit("ephemeral-change", { docId })
        }
        break
      }

      case "cmd/broadcast-ephemeral": {
        const myStore = this.getMyEphemeralStore(command.docId)
        const myStates = myStore.getAllStates()

        // If we are only sending our own data, and we don't have any, skip broadcast
        if (!command.allPeerData && Object.keys(myStates).length === 0) {
          this.logger.debug(
            "cmd/broadcast-ephemeral: skipping for {docId}",
            () => ({ docId: command.docId }),
          )
          break
        }

        // Touch my store to update timestamps before encoding.
        // This is essential for heartbeat: EphemeralStore encodes data with
        // original timestamps, and receiving stores expire data based on those
        // timestamps. Without touching, heartbeat data would have stale timestamps.
        if (myStore instanceof TimerlessEphemeralStore) {
          myStore.touch()
        }

        // Encode stores to send
        const stores = command.allPeerData
          ? this.#encodeAllPeerStores(command.docId)
          : (() => {
              const myData = myStore.encodeAll()
              return myData.length > 0
                ? [
                    {
                      docId: command.docId,
                      peerId: this.identity.peerId,
                      data: myData,
                    },
                  ]
                : []
            })()

        if (stores.length > 0) {
          const sent = this.adapters.send({
            toChannelIds: command.toChannelIds,
            message: {
              type: "channel/ephemeral",
              docId: command.docId,
              hopsRemaining: command.hopsRemaining,
              stores,
            },
          })
          this.logger.trace(
            "cmd/broadcast-ephemeral: sent {docId} presence to {sent} peers",
            { docId: command.docId, sent },
          )
        } else {
          this.logger.debug(
            "cmd/broadcast-ephemeral: skipping for {docId} (no data)",
            () => ({ docId: command.docId }),
          )
        }
        break
      }

      case "cmd/remove-ephemeral-peer": {
        // Remove the peer's store from all documents
        for (const [docId, peerStores] of this.docPeerStores) {
          if (peerStores.has(command.peerId)) {
            peerStores.delete(command.peerId)

            // Broadcast deletion to other peers
            const channelIds = this.#getChannelsForDoc(docId)

            if (channelIds.length > 0) {
              this.adapters.send({
                toChannelIds: channelIds,
                message: {
                  type: "channel/ephemeral",
                  docId,
                  hopsRemaining: 0,
                  stores: [
                    {
                      peerId: command.peerId,
                      data: new Uint8Array(0), // Empty data signals deletion
                    },
                  ],
                },
              })
            }

            // Emit local change event so UI updates immediately
            this.emitter.emit("ephemeral-change", { docId })
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
      // Note: #encodeAllPeerStores includes "my" store.
      // We should touch "my" store before encoding.
      const myStore = this.getMyEphemeralStore(docId)
      if (myStore instanceof TimerlessEphemeralStore) {
        myStore.touch()
      }

      const stores = this.#encodeAllPeerStores(docId)
      if (stores.length > 0) {
        syncResponseMessage.ephemeral = stores.map(s => ({
          peerId: s.peerId,
          data: s.data,
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
        ephemeral?: EphemeralPeerData
      } = {
        docId: doc.docId,
        requesterDocVersion: doc.requesterDocVersion,
      }

      // Include ephemeral data if requested
      if (includeEphemeral) {
        const myStore = this.getMyEphemeralStore(doc.docId)

        // Touch my store to update timestamps before encoding
        if (myStore instanceof TimerlessEphemeralStore) {
          myStore.touch()
        } else {
          this.logger.error("myStore must be TimerlessEphemeralStore")
        }

        const myData = myStore.encodeAll()

        if (myData.length > 0) {
          result.ephemeral = {
            peerId: this.identity.peerId,
            data: myData,
          }
          this.logger.debug(
            "including ephemeral data in sync-request for {docId} to {channelId}",
            {
              docId: doc.docId,
              channelId: toChannelId,
              ephemeralSize: myData.length,
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

    // Stop all adapters
    await Promise.all(
      Array.from(this.adapters.adapters.values()).map(a => a._stop()),
    )

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
