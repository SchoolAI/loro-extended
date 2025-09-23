import Emittery from "emittery"
import type { VersionVector } from "loro-crdt"
import { create, type Patch } from "mutative"
import { v4 as uuid } from "uuid"
import type { AnyAdapter } from "./adapter/adapter.js"
import type { AddressedEnvelope, Channel } from "./channel.js"
import {
  createPermissions,
  type PermissionManager,
} from "./permission-manager.js"
import {
  createSynchronizerUpdate,
  init as programInit,
  type Command,
  type SynchronizerMessage,
  type SynchronizerModel,
} from "./synchronizer-program.js"
import type {
  ChannelId,
  DocId,
  DocState,
  IdentityDetails,
  LoadingState,
  ReadyState,
} from "./types.js"

export type SynchronizerParams = {
  identity: Partial<IdentityDetails>
  adapters: AnyAdapter[]
  permissions?: PermissionManager
  onPatch?: (patches: Patch[]) => void
}

// The events that the Synchronizer can emit
type SynchronizerEvents = {
  "ready-state-changed": {
    docId: string
    readyStates: ReadyState[]
  }
}

type SynchronizerUpdate = (
  msg: SynchronizerMessage,
  model: SynchronizerModel,
) => [SynchronizerModel, Command?]

class AdapterManager {
  constructor(
    readonly adapters: AnyAdapter[],
    readonly onReset: (adapter: AnyAdapter) => void,
  ) {}

  send(envelope: AddressedEnvelope) {
    for (const adapter of this.adapters) {
      adapter.send(envelope)
    }
  }

  reset() {
    for (const adapter of this.adapters) {
      // Let the adapter clean up its part
      adapter.stop()

      // Clean up our per-adapter part
      this.onReset(adapter)
    }

    this.adapters.length = 0
  }
}

export class Synchronizer {
  identity: IdentityDetails
  adapters: AdapterManager

  model: SynchronizerModel
  updateFn: SynchronizerUpdate

  emitter = new Emittery<SynchronizerEvents>()

  constructor({
    identity,
    adapters,
    permissions,
    onPatch,
  }: SynchronizerParams) {
    this.identity = {
      name: identity.name ?? `synchronizer-${uuid()}`,
    }
    this.adapters = new AdapterManager(adapters, (adapter: AnyAdapter) => {
      for (const channel of adapter.channels) {
        this.channelRemoved(channel)
      }
    })

    this.updateFn = createSynchronizerUpdate(
      createPermissions(permissions),
      onPatch,
    )

    // Prepare adapters to listen for events or whatever they need to do before connecting
    for (const adapter of adapters) {
      adapter.prepare({
        channelAdded: this.channelAdded.bind(this),
        channelRemoved: this.channelRemoved.bind(this),
      })
    }

    const [initialModel, initialCommand] = programInit(this.identity)
    this.model = initialModel
    if (initialCommand) {
      this.#executeCommand(initialCommand)
    }

    // Let adapters start listening or connect
    for (const adapter of adapters) {
      adapter.start()
    }
  }

  // Helper functions for adapter callbacks
  channelAdded(channel: Channel) {
    this.#dispatch({ type: "msg/channel-added", channel })
  }

  channelRemoved(channel: Channel) {
    this.#dispatch({ type: "msg/channel-removed", channel })
  }

  // =-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=
  // PUBLIC API
  // =-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=
  getOrCreateDocumentState(docId: DocId): DocState {
    this.#dispatch({ type: "msg/local-doc-ensure", docId })
    const docState = this.model.documents.get(docId)

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
    // Wait for ready-state-changed events using async iteration
    for await (const event of this.emitter.events("ready-state-changed")) {
      // The event contains the readyStates array directly
      if (event.docId === docId && predicate(event.readyStates)) {
        // Condition met, we're done waiting
        break
      }
    }
  }

  public sync(documentId: DocId): void {
    this.#dispatch({ type: "msg/broadcast-sync-request", docId: documentId })
  }

  // =-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=- =-=-=-=-=-=-=-=
  // INTERNAL RUNTIME
  // =-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=

  #dispatch(message: SynchronizerMessage) {
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

      case "cmd/emit-ready-state-changed": {
        this.emitter.emit("ready-state-changed", {
          docId: command.docId,
          readyStates: command.readyStates,
        })
        break
      }

      case "cmd/establish-channel-doc": {
        this.#executeEstablishChannelDoc(command.channel)
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
        console.log(command.message)
      }
    }
  }

  #executeStartChannel(channel: Channel) {
    // 0. At this point, we can rely on the fact that the model.channels Map contains the channel
    if (!this.model.channels.has(channel.channelId)) {
      console.warn(
        `can't start channel, channelId ${channel.channelId} not found in channels`,
      )
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
        requesterPublishDocId: channel.publishDocId,
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
      console.warn(`can't get doc-state, doc not found: ${docId}`)
      return
    }

    const toChannel = docState.channelState.get(toChannelId)
    if (!toChannel) {
      console.warn(
        `can't send sync-response, channel doesn't exist: ${toChannelId}`,
      )
      return
    }

    // Export the document data to send as sync response
    const data = docState.doc.export({
      mode: "update",
      from: requesterDocVersion,
    })

    const version = docState.doc.version()

    this.adapters.send({
      toChannelIds: [toChannelId],
      message: {
        type: "channel/sync-response",
        docId,
        hopCount: 0,
        transmission: {
          type: "update",
          version,
          data,
        },
      },
    })
  }

  /**
   * Create a special document to be shared between this repo and the channel
   *
   * The publishDoc contains information that the *channel* wants to share with
   * this repo about the doc. In other words, from this repo's perspective the
   * publishDoc is read-only (but this is not enforced right now).
   */
  #executeEstablishChannelDoc(channel: Channel) {
    if (channel.shared.state !== "established") {
      console.warn(
        `can't establish channel doc for channel ${channel.channelId}, not in established state`,
      )
      return
    }

    const docId = channel.shared.consumeDocId

    const docState = this.getOrCreateDocumentState(docId)

    const metadata = docState.doc.getMap("metadata")

    metadata.subscribe(event => {
      for (const e of event.events) {
        // TODO(duane): convert these events into updates to docState
        console.log("shared-doc event", e.path, e.diff, docId)
      }
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
