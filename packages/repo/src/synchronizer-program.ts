import type { VersionVector } from "loro-crdt"
import { current, type Patch } from "mutative"
import type {
  AddressedEnvelope,
  Channel,
  ChannelMsg,
  ReturnEnvelope,
} from "./channel.js"
import type { PermissionManager } from "./permission-manager.js"
import {
  type AwarenessState,
  type ChannelId,
  createDocChannelState,
  createDocState,
  type DocChannelState,
  type DocId,
  type DocState,
  type IdentityDetails,
  type LoadingState,
  type ReadyState,
} from "./types.js"
import { makeImmutableUpdate } from "./utils/make-immutable-update.js"

// STATE

export type SynchronizerModel = {
  identity: IdentityDetails
  documents: Map<DocId, DocState>
  channels: Map<ChannelId, Channel>
}

// MESSAGES (inputs to the update function)

export type SynchronizerMessage =
  // (from channel via repo): a channel (storage, network peer) was added
  | { type: "msg/channel-added"; channel: Channel }

  // (from channel via repo): a channel (storage, network peer) was removed
  | { type: "msg/channel-removed"; channel: Channel }

  // (from repo): ask channels (storage, network peers) for data
  | { type: "msg/broadcast-sync-request"; docId: DocId }

  // (?): create a doc locally
  | { type: "msg/local-doc-ensure"; docId: DocId }

  // (?): notify all concerned channels that a local edit was made to the doc
  | { type: "msg/local-doc-change"; docId: DocId; data: Uint8Array }

  // (from channel): a channel has received a message
  | { type: "msg/channel-receive-message"; envelope: ReturnEnvelope }

// COMMANDS (outputs of the update function)

export type Command =
  | { type: "cmd/start-channel"; channel: Channel }
  | { type: "cmd/stop-channel"; channel: Channel }
  | { type: "cmd/establish-channel-doc"; channel: Channel }
  | { type: "cmd/send-message"; envelope: AddressedEnvelope }
  | {
      type: "cmd/send-sync-response"
      docId: DocId
      requesterDocVersion: VersionVector
      toChannelId: ChannelId
    }

  // Events
  | {
      type: "cmd/emit-ready-state-changed"
      docId: DocId
      readyStates: ReadyState[]
    }
  // Timers
  // | { type: "cmd/set-timeout"; docId: DocId; duration: number }
  // | { type: "cmd/clear-timeout"; docId: DocId }

  // Utilities
  | { type: "cmd/dispatch"; dispatch: SynchronizerMessage }
  | { type: "cmd/batch"; commands: Command[] }
  | { type: "cmd/log"; message: string }

// PROGRAM DEFINITION

export type Program = {
  update(
    message: SynchronizerMessage,
    model: SynchronizerModel,
  ): [SynchronizerModel, Command?]
}

export function init(identity: IdentityDetails): [SynchronizerModel, Command?] {
  return [
    {
      identity,
      documents: new Map(),
      channels: new Map(),
    },
  ]
}

/**
 * Creates a mutative update function that captures permissions in closure.
 * This is used internally by the transformer to provide cleaner update logic.
 */
function createSynchronizerLogic(permissions: PermissionManager) {
  // A mutating update function is easier to read and write, because we need only concern ourselves
  // with what needs to change, using standard assignment and JS operations. But the machinery
  // around this function turns it back into an immutable `update` function like raj/TEA expects.
  return function mutatingUpdate(
    msg: SynchronizerMessage,
    model: SynchronizerModel,
  ): Command | undefined {
    switch (msg.type) {
      case "msg/channel-added": {
        // 1. Add the channel to our model
        model.channels.set(msg.channel.channelId, msg.channel)

        // 2. It's our responsibility to initialize the new channel
        const initChannelCmd: Command = {
          type: "cmd/start-channel",
          channel: msg.channel,
        }

        return initChannelCmd
      }

      case "msg/channel-removed": {
        // 1. It's our responsibility to de-initialize the channel
        const channel = model.channels.get(msg.channel.channelId)

        const deinitChannelCmd: Command = channel
          ? {
              type: "cmd/stop-channel",
              channel: current(channel),
            }
          : {
              type: "cmd/log",
              message: `channel didn't exist when removing: ${msg.channel.channelId}`,
            }

        // 2. Remove the channel from our model
        model.channels.delete(msg.channel.channelId)

        // 3. Remove the channel from all document states
        for (const docState of model.documents.values()) {
          docState.channelState.delete(msg.channel.channelId)
        }

        return deinitChannelCmd
      }

      // Send a message to all channels (storage, network peers, etc.) that may have a particular document
      case "msg/broadcast-sync-request": {
        const { docId } = msg

        const docState = model.documents.get(docId)

        const commands: (Command | undefined)[] = []
        const toChannelIds: ChannelId[] = []

        if (docState) {
          const requesterDocVersion = docState.doc.version()

          for (const [channelId, status] of docState.channelState.entries()) {
            const channel = model.channels.get(channelId)

            if (!channel) {
              commands.push({
                type: "cmd/log",
                message: `broadcast regarding doc ${docId} skipped for channel ${channelId}`,
              })
              continue
            }

            // Indicate we are requesting the doc from each channel
            commands.push(
              setLoading(model, docId, channelId, { state: "requesting" }),
            )

            if (
              status.awareness === "unknown" ||
              status.awareness === "has-doc"
              // TODO(duane): also check permissions here
            ) {
              toChannelIds.push(channelId)
            }
          }

          // We'll send a sync request message through each channel, telling what version we have
          commands.push({
            type: "cmd/send-message",
            envelope: {
              toChannelIds,
              message: {
                type: "channel/sync-request",
                docId,
                requesterDocVersion,
              },
            },
          })

          return batchAsNeeded(...commands)
        }

        return {
          type: "cmd/log",
          message: `unable to broadcast, document ${docId} not present`,
        }
      }

      case "msg/local-doc-ensure": {
        const { docId } = msg

        let docState = model.documents.get(docId)

        if (!docState) {
          docState = createDocState({ docId })
          model.documents.set(docId, docState)
        }

        return
      }

      case "msg/local-doc-change": {
        return
      }

      // Handle a ChannelMsg that has been received via a Channel
      case "msg/channel-receive-message": {
        const fromChannelId = msg.envelope.fromChannelId

        const channelMessage = msg.envelope.message

        return mutatingChannelUpdate(
          channelMessage,
          model,
          fromChannelId,
          permissions,
        )
      }
    }
    return
  }
}

function mutatingChannelUpdate(
  channelMessage: ChannelMsg,
  model: SynchronizerModel,
  fromChannelId: ChannelId,
  permissions: PermissionManager,
): Command | undefined {
  const channel = model.channels.get(fromChannelId)

  if (!channel) {
    return {
      type: "cmd/log",
      message: `channel not found corresponding to from-channel-id: ${fromChannelId}`,
    }
  }

  /**
   * Main channel message switch--act on each type of channel message
   *
   * We play both sides here: requests and responses--but in this context we are always
   * "receiving" the request or response.
   */
  switch (channelMessage.type) {
    case "channel/establish-request": {
      // 1. Learn what docId to consume from the requester
      channel.shared = {
        state: "established",
        consumeDocId: channelMessage.requesterPublishDocId,
      }

      // 2. Now that we the requester's publishDocId, start using it to keep metadata about the channel up-to-date
      const establishChannelDocCmd: Command = {
        type: "cmd/establish-channel-doc",
        channel: current(channel),
      }

      // 3. Share our publishDocId back to the rquester
      const sendMessageCmd: Command = {
        type: "cmd/send-message",
        envelope: {
          toChannelIds: [fromChannelId],
          message: {
            type: "channel/establish-response",
            responderPublishDocId: channel.publishDocId,
          },
        },
      }

      return batchAsNeeded(establishChannelDocCmd, sendMessageCmd)
    }

    case "channel/establish-response": {
      // 1. Learn what docId to consume from the responder
      channel.shared = {
        state: "established",
        consumeDocId: channelMessage.responderPublishDocId,
      }

      // 2. Now that we the responder's publishDocId, start using it to keep metadata about the channel up-to-date
      const establishChannelDocCmd: Command = {
        type: "cmd/establish-channel-doc",
        channel: current(channel),
      }

      return establishChannelDocCmd
    }

    case "channel/sync-request": {
      const { docId, requesterDocVersion } = channelMessage

      const docState = model.documents.get(docId)

      if (docState) {
        // Respond with document data if we have it
        const syncResponseCmd: Command = {
          type: "cmd/send-sync-response",
          docId: docId,
          requesterDocVersion,
          toChannelId: fromChannelId,
        }

        return batchAsNeeded(
          setAwareness(docState, fromChannelId, "has-doc"),
          syncResponseCmd,
        )
      }
      return
    }
    case "channel/sync-response": {
      const docState = model.documents.get(channelMessage.docId)

      if (docState) {
        const docChannelState = docState.channelState.get(fromChannelId)

        if (!docChannelState) {
          return {
            type: "cmd/log",
            message: `can't accept sync-response: state not found for document ${channelMessage.docId}`,
          }
        }

        switch (channelMessage.transmission.type) {
          case "up-to-date": {
            // nothing to do for doc data

            return batchAsNeeded(
              // but track that this channel has the doc
              setAwareness(docState, fromChannelId, "has-doc"),
              setLoading(model, channelMessage.docId, fromChannelId, {
                state: "found",
                version: channelMessage.transmission.version,
              }),
            )
          }

          case "snapshot":
          case "update": {
            // apply the sync message to the document
            docState.doc.import(channelMessage.transmission.data)

            return batchAsNeeded(
              // track that this channel has the doc
              setAwareness(docState, fromChannelId, "has-doc"),
              setLoading(model, channelMessage.docId, fromChannelId, {
                state: "found",
                version: channelMessage.transmission.version,
              }),
            )
          }

          case "unavailable": {
            return batchAsNeeded(
              // track that this channel denied having the doc
              setAwareness(docState, fromChannelId, "no-doc"),
              setLoading(model, channelMessage.docId, fromChannelId, {
                state: "not-found",
              }),
            )
          }
        }
      }
      break
    }

    case "channel/directory-request": {
      // Filter documents based on permissions
      const allowedDocIds = Array.from(model.documents.keys()).filter(docId =>
        permissions.canList(fromChannelId, docId),
      )

      return {
        type: "cmd/send-message",
        envelope: {
          toChannelIds: [fromChannelId],
          message: {
            type: "channel/directory-response",
            docIds: allowedDocIds,
          },
        },
      }
    }

    case "channel/directory-response": {
      const commands: (Command | undefined)[] = []

      for (const docId of channelMessage.docIds) {
        let docState = model.documents.get(docId)

        if (!docState) {
          docState = createDocState({ docId })
          model.documents.set(docId, docState)
        }

        setAwareness(docState, fromChannelId, "has-doc")
      }

      return batchAsNeeded(...commands)
    }
  }
  return
}

function batchAsNeeded(
  ...commandSequence: (Command | undefined)[]
): Command | undefined {
  const definedCommands: Command[] = commandSequence.flatMap(c =>
    c ? [c] : [],
  )

  if (definedCommands.length === 0) {
    return
  }

  if (definedCommands.length === 1) {
    return definedCommands[0]
  }

  return { type: "cmd/batch", commands: definedCommands }
}

/**
 * Creates a standard raj-compatible update function with permissions captured in closure.
 * Uses the transformer to provide immutability while keeping the logic clean.
 *
 * onPatch: optional debug callback that receives a list of changes at each update cycle
 */
export function createSynchronizerUpdate(
  permissions: PermissionManager,
  onPatch?: (patches: Patch[]) => void,
) {
  return makeImmutableUpdate(createSynchronizerLogic(permissions), onPatch)
}

function getReadyStates(
  channels: Map<ChannelId, Channel>,
  channelState: Map<ChannelId, DocChannelState>,
): ReadyState[] {
  const readyStates: ReadyState[] = []

  for (const [channelId, state] of channelState.entries()) {
    const channel = channels.get(channelId)
    if (channel) {
      readyStates.push({
        channelMeta: {
          kind: channel.kind,
          adapterId: channel.adapterId,
        },
        loading: state.loading,
      })
    }
  }

  return readyStates
}

function setAwareness(
  docState: DocState,
  channelId: ChannelId,
  awareness: AwarenessState,
): undefined {
  const status = docState.channelState.get(channelId)

  if (status) {
    status.awareness = awareness
  } else {
    docState.channelState.set(channelId, createDocChannelState({ awareness }))
  }
}

function setLoading(
  model: SynchronizerModel,
  docId: DocId,
  channelId: ChannelId,
  loading: LoadingState,
): Command | undefined {
  const docState = model.documents.get(docId)

  if (!docState) {
    return {
      type: "cmd/log",
      message: `set-loading unable to get doc-state for docId ${docId}`,
    }
  }

  const status = docState.channelState.get(channelId)

  let didSetLoading = false

  if (status) {
    if (status.loading.state !== loading.state) {
      status.loading = loading
      didSetLoading = true
    }
  } else {
    docState.channelState.set(channelId, createDocChannelState({ loading }))
    didSetLoading = true
  }

  if (didSetLoading) {
    return {
      type: "cmd/emit-ready-state-changed",
      docId: docState.docId,
      readyStates: getReadyStates(model.channels, docState.channelState),
    }
  }
}
