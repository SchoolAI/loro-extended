import { getLogger, type Logger } from "@logtape/logtape"
import Emittery from "emittery"
import type { VersionVector } from "loro-crdt"
import { create, type Patch } from "mutative"
import { v4 as uuid } from "uuid"
import type { AnyAdapter } from "./adapter/adapter.js"
import { AdapterManager } from "./adapter/adapter-manager.js"
import type { Channel } from "./channel.js"
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
  LoadingState,
  PeerIdentityDetails,
  ReadyState,
} from "./types.js"

export type HandleUpdateFn = (patches: Patch[]) => void

// The events that the Synchronizer can emit
type SynchronizerEvents = {
  "ready-state-changed": {
    docId: string
    readyStates: ReadyState[]
  }
}

type SynchronizerParams = {
  identity: Partial<PeerIdentityDetails>
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
    const logger = preferredLogger ?? getLogger(["@loro-extended", "repo"])
    this.logger = logger

    this.identity = {
      name: identity.name ?? `synchronizer-${uuid()}`,
    }

    this.logger.debug(`new Synchronizer`)

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

    // Prepare adapters to listen for events or whatever they need to do before connecting
    for (const adapter of adapters) {
      adapter._prepare({
        channelAdded: this.channelAdded.bind(this),
        channelRemoved: this.channelRemoved.bind(this),
      })
    }

    // Let adapters start listening or connect
    for (const adapter of adapters) {
      adapter.onStart()
    }
  }

  // Helper functions for adapter callbacks
  channelAdded(channel: Channel) {
    this.logger.debug(`channelAdded`, { channel })
    this.#dispatch({ type: "msg/channel-added", channel })
  }

  channelRemoved(channel: Channel) {
    this.logger.debug(`channelRemoved`, { channel })
    this.#dispatch({ type: "msg/channel-removed", channel })
  }

  // =-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=
  // PUBLIC API
  // =-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=
  getOrCreateDocumentState(docId: DocId): DocState {
    let docState = this.model.documents.get(docId)

    if (!docState) {
      this.#dispatch({ type: "msg/local-doc-ensure", docId })
      docState = this.model.documents.get(docId)
    }

    if (!docState) {
      throw new Error(`unable to find or create doc: ${docId}`)
    }

    return docState
  }

  getDocumentState(docId: DocId): DocState | undefined {
    return this.model.documents.get(docId)
  }

  getChannel(channelId: ChannelId): Channel | undefined {
    return this.model.channels.get(channelId)
  }

  /**
   * Get channels that have the given docId
   */
  public getChannelsForDoc(
    docId: DocId,
    predicate: (loading: LoadingState) => boolean,
  ): Channel[] {
    const docState = this.getDocumentState(docId)

    if (!docState) {
      throw new Error(`doc state not found for ${docId}`)
    }

    const channelIds = Array.from(docState.channelState.entries()).flatMap(
      ([channelId, state]) => (predicate(state.loading) ? [channelId] : []),
    )

    return channelIds.flatMap(id => {
      const channel = this.getChannel(id)
      return channel ? [channel] : []
    })
  }

  /**
   * Get docIds known to be available at the given channelId
   */
  public getChannelDocIds(channelId: ChannelId): DocId[] {
    return Array.from(this.model.documents.entries()).flatMap(
      ([docId, state]) => (state.channelState.has(channelId) ? [docId] : []),
    )
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
      docState.channelState,
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
      case "cmd/start-channel": {
        this.#executeStartChannel(command.channel)
        break
      }

      case "cmd/stop-channel": {
        // Time to de-initialize a channel
        command.channel.stop()
        break
      }

      case "cmd/send-message": {
        // Let the AdapterManager handle routing the envelope to the right place(s)
        this.adapters.send(command.envelope)
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

      case "cmd/subscribe-local-doc": {
        this.#executeSubscribeLocalDoc(command.docId)
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

  #executeStartChannel(channel: Channel) {
    // 0. At this point, we should be able to rely model.channels Map containing the channel
    if (!this.model.channels.has(channel.channelId)) {
      this.logger.error(`can't start missing channel`, {
        channel: channel.channelId,
      })
      return
    }

    // 1. Time to initialize a new channel!
    // - we need to do so inside an effect, because we need access to #dispatch
    channel.start(message => {
      // Whenever we receive a message from the channel, dispatch it to our synchronizer-program
      this.#dispatch({
        type: "msg/channel-receive-message",
        envelope: {
          fromChannelId: channel.channelId,
          message,
        },
      })
    })

    // 2. Initiate a request to establish a shared doc for the channel
    this.adapters.send({
      toChannelIds: [channel.channelId],
      message: {
        type: "channel/establish-request",
        identity: this.identity,
      },
    })
  }

  async #executeSendSyncResponse(
    docId: DocId,
    requesterDocVersion: VersionVector,
    toChannelId: ChannelId,
  ) {
    const docState = this.model.documents.get(docId)
    if (!docState) {
      this.logger.warn(`can't get doc-state, doc not found`, { docId })
      return
    }

    const toChannel = docState.channelState.get(toChannelId)
    if (!toChannel) {
      this.logger.warn(`can't send sync-response, channel doesn't exist`, {
        toChannelId,
      })
      return
    }

    // Export the document data to send as sync response
    const data = docState.doc.export({
      mode: "update",
      from: requesterDocVersion,
    })

    // const version = docState.doc.version()

    this.logger.debug(
      "sending sync-response due to execute-send-sync-response",
      {
        channelId: toChannelId,
        docId,
      },
    )

    this.adapters.send({
      toChannelIds: [toChannelId],
      message: {
        type: "channel/sync-response",
        docId,
        hopCount: 0,
        transmission: {
          type: "update",
          data,
        },
      },
    })
  }

  #executeSubscribeLocalDoc(docId: DocId) {
    const docState = this.model.documents.get(docId)
    if (!docState) {
      this.logger.warn(`can't get doc-state, doc not found`, { docId })
      return
    }

    docState.doc.subscribeLocalUpdates(data => {
      this.#dispatch({ type: "msg/local-doc-change", docId, data })
    })
  }

  public reset() {
    const [initialModel] = programInit(this.model.identity)

    // Disconnect all network adapters
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
