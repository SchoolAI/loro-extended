import { getLogger, type Logger } from "@logtape/logtape"
import Emittery from "emittery"
import type { VersionVector } from "loro-crdt"
import { create, type Patch } from "mutative"
import type { AnyAdapter } from "./adapter/adapter.js"
import { AdapterManager } from "./adapter/adapter-manager.js"
import type { Channel, ChannelMsg, ConnectedChannel } from "./channel.js"
import { isEstablished as isEstablishedFn } from "./channel.js"
import { createPermissions, type Rules } from "./rules.js"
import {
  type Command,
  createSynchronizerUpdate,
  getReadyStates,
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
import { generatePeerId } from "./utils/generate-peer-id.js"

export type HandleUpdateFn = (patches: Patch[]) => void

// The events that the Synchronizer can emit
type SynchronizerEvents = {
  "ready-state-changed": {
    docId: string
    readyStates: ReadyState[]
  }
}

type SynchronizerParams = {
  identity?: Partial<PeerIdentityDetails>
  adapters: AnyAdapter[]
  permissions?: Rules
  onUpdate?: HandleUpdateFn
  logger?: Logger
}

type SynchronizerUpdate = (
  msg: SynchronizerMessage,
  model: SynchronizerModel,
) => [SynchronizerModel, Command?]

export class Synchronizer {
  readonly identity: PeerIdentityDetails
  readonly adapters: AdapterManager
  readonly logger: Logger

  model: SynchronizerModel
  readonly updateFn: SynchronizerUpdate

  readonly emitter = new Emittery<SynchronizerEvents>()

  constructor({
    identity,
    adapters,
    permissions,
    onUpdate,
    logger: preferredLogger,
  }: SynchronizerParams) {
    const logger = preferredLogger ?? getLogger()
    this.logger = logger.getChild("synchronizer")

    // Ensure identity has both peerId and name
    const peerId = identity?.peerId ?? generatePeerId()
    const name = identity?.name ?? peerId
    this.identity = { peerId, name }

    this.logger.debug(`new Synchronizer`, { identity: this.identity })

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
      permissions: createPermissions(permissions),
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
        onChannelReceive: this.onChannelReceive.bind(this),
        onChannelEstablish: this.channelEstablish.bind(this),
      })
    }

    // Phase 2: Start all adapters (async, but don't wait)
    // Channels will be added as they become ready
    for (const adapter of adapters) {
      void adapter._start()
    }
  }

  onChannelReceive(channel: Channel, message: ChannelMsg) {
    this.logger.trace(`onReceive`, { channel, message })
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
    this.logger.debug(`channelAdded`, { channel })
    this.#dispatch({ type: "synchronizer/channel-added", channel })
  }

  channelEstablish(channel: ConnectedChannel) {
    this.logger.debug(`channelEstablish`, { channelId: channel.channelId })
    this.#dispatch({
      type: "synchronizer/establish-channel",
      channelId: channel.channelId,
    })
  }

  channelRemoved(channel: Channel) {
    this.logger.debug(`channelRemoved`, { channel })
    this.#dispatch({ type: "synchronizer/channel-removed", channel })
  }

  // =-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=
  // PUBLIC API
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
    this.logger.debug(`wait-until-ready is WAITING`, { docId })

    const docState = this.model.documents.get(docId)

    if (!docState) {
      this.logger.warn(`wait-until-ready unable to get doc-state`)
      return
    }

    const readyStates = getReadyStates(
      this.model.channels,
      this.model.peers,
      docId,
    )

    if (predicate(readyStates)) {
      this.logger.debug(`wait-until-ready is READY (immediate)`, {
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

    this.logger.debug(`wait-until-ready is READY`, { docId })
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
        this.logger.debug(`executing cmd/send-establishment-message`, {
          messageType: command.envelope.message.type,
          toChannelIds: command.envelope.toChannelIds,
          totalAdapters: this.adapters.adapters.length,
          adapterChannelCounts: this.adapters.adapters.map(a => ({
            adapterId: a.adapterId,
            channelCount: a.channels.size,
          })),
        })

        const sentCount = this.adapters.sendEstablishmentMessage(
          command.envelope,
        )

        this.logger.debug(`cmd/send-establishment-message result`, {
          sentCount,
          expectedCount: command.envelope.toChannelIds.length,
        })

        if (sentCount < command.envelope.toChannelIds.length) {
          this.logger.warn(
            `cmd/send-establishment-message could not deliver ${command.envelope.message.type} to all ${command.envelope.toChannelIds.length} channels`,
            { channelIds: command.envelope.toChannelIds },
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
            `cmd/send-message could not deliver ${command.envelope.message.type} to all ${command.envelope.toChannelIds.length} channels`,
            { channelIds: command.envelope.toChannelIds },
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

      // (utility): A command that logs a message
      case "cmd/log": {
        this.logger.info(command.message)
      }
    }
  }

  #validateChannelForSend(channelId: ChannelId): boolean {
    const channel = this.model.channels.get(channelId)

    if (!channel) {
      this.logger.warn(`Cannot send: channel ${channelId} not found`)
      return false
    }

    if (!isEstablishedFn(channel)) {
      this.logger.warn(`Cannot send: channel ${channelId} not established`)
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
      this.logger.warn(`can't get doc-state, doc not found`, { docId })
      return
    }

    // No need to check channel state - just verify channel exists
    const channel = this.model.channels.get(toChannelId)
    if (!channel) {
      this.logger.warn(`can't send sync-response, channel doesn't exist`, {
        toChannelId,
      })
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

    this.logger.info("#executeSendSyncResponse version check", {
      channelId: toChannelId,
      docId,
      requesterDocVersionLength: requesterDocVersion.length(),
      ourVersionLength: ourVersion.length(),
      comparison,
      isEmpty,
      requesterVersionType: typeof requesterDocVersion,
      requesterVersionConstructor: requesterDocVersion.constructor.name,
    })

    // Export the document data to send as sync response
    // If requester has empty version, send full snapshot
    // Otherwise send update delta from their version
    const data = docState.doc.export({
      mode: isEmpty ? "snapshot" : "update",
      from: isEmpty ? undefined : requesterDocVersion,
    })

    const version = docState.doc.version()

    this.logger.debug(
      "sending sync-response due to execute-send-sync-response",
      {
        channelId: toChannelId,
        docId,
        isEmpty,
        transmissionType: isEmpty ? "snapshot" : "update",
      },
    )

    const transmission = isEmpty
      ? {
          type: "snapshot" as const,
          data,
          version,
        }
      : {
          type: "update" as const,
          data,
          version,
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
      this.logger.warn(`can't send sync-response to channel`, {
        toChannelId,
      })
    }
  }

  #executeSubscribeDoc(docId: DocId) {
    const docState = this.model.documents.get(docId)
    if (!docState) {
      this.logger.warn(`can't get doc-state, doc not found`, { docId })
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
      this.logger.debug(`removeDocument: document not found`, { docId })
      return
    }

    // Get all channels whose peers have subscribed to this document
    const channelIds: ChannelId[] = []
    for (const [peerId, peerState] of this.model.peers.entries()) {
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
