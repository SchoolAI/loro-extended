import { getLogger, type Logger } from "@logtape/logtape"
import Emittery from "emittery"
import { EphemeralStore, type Value, type VersionVector } from "loro-crdt"
import { create, type Patch } from "mutative"
import type { AnyAdapter } from "./adapter/adapter.js"
import { AdapterManager } from "./adapter/adapter-manager.js"
import type {
  Channel,
  ChannelMsg,
  ConnectedChannel,
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

  readonly ephemeralStores = new Map<DocId, EphemeralStore>()

  readonly emitter = new Emittery<SynchronizerEvents>()

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
    this.logger.trace("onReceive: {message.type} from {channel.channelId}", {
      channel,
      message,
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
    this.logger.debug("channelAdded: {channel.channelId}", { channel })
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
    this.logger.debug("channelRemoved: {channel.channelId}", { channel })
    this.#dispatch({ type: "synchronizer/channel-removed", channel })
  }

  // =-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=
  // PUBLIC API
  // =-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=
  getOrCreateEphemeralStore(docId: DocId): EphemeralStore {
    let store = this.ephemeralStores.get(docId)

    if (!store) {
      // Set the timeout to 2x heartbeat, so there is a buffer of time before
      // ephemeral data is considered outdated and removed
      store = new EphemeralStore(HEARTBEAT_INTERVAL * 2)

      this.ephemeralStores.set(docId, store)
    }

    return store
  }

  /**
   * Sets a bundle of values on our peerId within the EphemeralStore representing this DocId
   */
  setEphemeralValues(docId: DocId, values: ObjectValue) {
    const store = this.getOrCreateEphemeralStore(docId)

    const currentValues = this.getEphemeralValues(docId, this.identity.peerId)

    const newValues = { ...currentValues, ...values }

    store.set(this.identity.peerId, newValues)

    this.#dispatch({ type: "synchronizer/ephemeral-local-change", docId })
  }

  /**
   * Gets the bundle of values for a peerId within the EphemeralStore related to this DocId
   */
  getEphemeralValues(docId: DocId, peerId: PeerID): ObjectValue {
    const store = this.getOrCreateEphemeralStore(docId)

    return (store.get(peerId) as ObjectValue) ?? {}
  }

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
    this.model = newModel

    if (command) {
      this.#executeCommand(command)
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
              adapterId: a.adapterId,
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
        )
        break
      }

      case "cmd/subscribe-doc": {
        this.#executeSubscribeDoc(command.docId)
        break
      }

      case "cmd/emit-ready-state-changed": {
        this.emitter.emit("ready-state-changed", {
          docId: command.docId,
          readyStates: command.readyStates,
        })
        break
      }

      case "cmd/emit-ephemeral-change": {
        this.emitter.emit("ephemeral-change", { docId: command.docId })
        break
      }

      case "cmd/apply-ephemeral": {
        const store = this.getOrCreateEphemeralStore(command.docId)

        store.apply(command.data)

        this.emitter.emit("ephemeral-change", { docId: command.docId })

        break
      }

      case "cmd/broadcast-ephemeral": {
        const store = this.getOrCreateEphemeralStore(command.docId)

        // Reset EphemeralStore timeout for this peer's values
        store.set(this.identity.peerId, store.get(this.identity.peerId))

        const data = command.allPeerData
          ? store.encodeAll()
          : store.encode(this.identity.peerId)

        if (data.length > 0) {
          this.adapters.send({
            toChannelIds: command.toChannelIds,
            message: {
              type: "channel/ephemeral",
              docId: command.docId,
              hopsRemaining: command.hopsRemaining,
              data,
            },
          })
        }
        break
      }

      case "cmd/remove-ephemeral-peer": {
        // Iterate over all ephemeral stores and remove the peer's data
        for (const [docId, store] of this.ephemeralStores) {
          // Delete the peer's data from the local store
          store.delete(command.peerId)

          // Generate a deletion update to broadcast to other peers
          const deletionUpdate = store.encode(command.peerId)

          if (deletionUpdate.length > 0) {
            // Find all channels subscribed to this document
            const channelIds: ChannelId[] = []
            for (const [channelId, channel] of this.model.channels) {
              if (isEstablishedFn(channel)) {
                const peerState = this.model.peers.get(channel.peerId)
                if (peerState?.subscriptions.has(docId)) {
                  channelIds.push(channelId)
                }
              }
            }

            if (channelIds.length > 0) {
              this.adapters.send({
                toChannelIds: channelIds,
                message: {
                  type: "channel/ephemeral",
                  docId,
                  hopsRemaining: 0,
                  data: deletionUpdate,
                },
              })
            }
          }

          // Emit local change event so UI updates immediately
          this.emitter.emit("ephemeral-change", { docId })
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

    const messageToSend = {
      toChannelIds: [toChannelId],
      message: {
        type: "channel/sync-response" as const,
        docId,
        transmission,
      },
    }

    const sentCount = this.adapters.send(messageToSend)

    if (sentCount === 0) {
      this.logger.warn("can't send sync-response to channel {toChannelId}", {
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

    // Subscribe to ALL changes (local + imported) to enable multi-hop propagation
    // The handler will export the right update for each peer based on their version
    docState.doc.subscribe(() => {
      this.#dispatch({
        type: "synchronizer/doc-change",
        docId,
      })
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
