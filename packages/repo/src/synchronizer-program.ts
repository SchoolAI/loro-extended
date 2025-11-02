import { getLogger, type Logger } from "@logtape/logtape"
import { omit } from "lodash-es"
import type { VersionVector } from "loro-crdt"
import { current, type Patch } from "mutative"
import type {
  AddressedEnvelope,
  Channel,
  ChannelMsg,
  ChannelMsgSyncRequest,
  ReturnEnvelope,
} from "./channel.js"
import type { RuleContext, Rules } from "./rules.js"
import {
  type AwarenessState,
  type ChannelId,
  createDocChannelState,
  createDocState,
  type DocChannelState,
  type DocId,
  type DocState,
  type LoadingState,
  type PeerIdentityDetails,
  type ReadyState,
} from "./types.js"
import { makeImmutableUpdate } from "./utils/make-immutable-update.js"

// STATE

export type SynchronizerModel = {
  identity: PeerIdentityDetails
  documents: Map<DocId, DocState>
  channels: Map<ChannelId, Channel>
}

// MESSAGES (inputs to the update function)

export type SynchronizerMessage =
  // (from channel via repo): a channel (storage, network peer) was added
  | { type: "msg/channel-added"; channel: Channel }

  // (from channel via repo): a channel (storage, network peer) was removed
  | { type: "msg/channel-removed"; channel: Channel }

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
  | { type: "cmd/send-message"; envelope: AddressedEnvelope }
  | {
      type: "cmd/send-sync-response"
      docId: DocId
      requesterDocVersion: VersionVector
      toChannelId: ChannelId
    }
  | { type: "cmd/subscribe-local-doc"; docId: DocId }

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

export function init(
  identity: PeerIdentityDetails,
): [SynchronizerModel, Command?] {
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
function createSynchronizerLogic(
  permissions: Rules,
  synchronizerLogger: Logger,
) {
  const logger = synchronizerLogger.getChild("synchronizer-program")

  // A mutating update function is easier to read and write, because we need only concern ourselves
  // with what needs to change, using standard assignment and JS operations. But the machinery
  // around this function turns it back into an immutable `update` function like raj/TEA expects.
  return function mutatingUpdate(
    msg: SynchronizerMessage,
    model: SynchronizerModel,
  ): Command | undefined {
    if (msg.type !== "msg/channel-receive-message") {
      const detail = "data" in msg ? { ...msg, data: "[omitted]" } : msg
      logger.trace(msg.type, detail)
    }

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

      case "msg/local-doc-ensure": {
        const { docId } = msg

        let docState = model.documents.get(docId)

        if (!docState) {
          docState = createDocState({ docId })
          model.documents.set(docId, docState)

          // Set awareness for all established channels where canReveal permits
          // This ensures storage and permitted network channels receive updates for this new document
          for (const channel of model.channels.values()) {
            if (channel.peer.state === "established") {
              // Start with unknown awareness so getRuleContext can access the channel state
              setAwarenessState(docState, channel.channelId, "unknown")

              const context = getRuleContext({
                channel,
                docState,
              })

              if (
                !(context instanceof Error) &&
                permissions.canReveal(context)
              ) {
                setAwarenessState(docState, channel.channelId, "has-doc")
              }
            }
          }

          return { type: "cmd/subscribe-local-doc", docId }
        }

        return
      }

      case "msg/local-doc-change": {
        const { docId, data } = msg

        const docState = model.documents.get(docId)

        if (!docState) {
          return {
            type: "cmd/log",
            message: `local-doc-change: unable to find doc-state ${docId}`,
          }
        }

        const commands: Command[] = []

        for (const [channelId, state] of docState.channelState.entries()) {
          if (state.awareness === "has-doc") {
            logger.debug("sending sync-response due to local-doc-change", {
              channelId,
              docId,
            })
            commands.push({
              type: "cmd/send-message",
              envelope: {
                toChannelIds: [channelId],
                message: {
                  type: "channel/sync-response",
                  docId,
                  hopCount: 0,
                  transmission: { type: "update", data },
                },
              },
            })
          } else {
            commands.push({
              type: "cmd/log",
              message: `not sending change to ${channelId}; awareness is ${state.awareness}`,
            })
          }
        }

        return batchAsNeeded(...commands)
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
          logger,
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
  permissions: Rules,
  logger: Logger,
): Command | undefined {
  const channel = model.channels.get(fromChannelId)

  if (!channel) {
    return {
      type: "cmd/log",
      message: `channel not found corresponding to from-channel-id: ${fromChannelId}`,
    }
  }

  const fromChannel = model.channels.get(fromChannelId)
  const from =
    fromChannel?.peer.state === "established"
      ? fromChannel?.peer.identity.name
      : channelMessage.type === "channel/establish-request"
        ? channelMessage.identity.name
        : channelMessage.type === "channel/establish-response"
          ? channelMessage.identity.name
          : "unknown"

  logger.trace(channelMessage.type, {
    from,
    to: model.identity.name,
    via: fromChannelId,
    dir: "recv",
    channelMessage: omit(channelMessage, "type"),
  })

  /**
   * Main channel message switch--act on each type of channel message
   *
   * We play both sides here: requests and responses--but in this context we are always
   * "receiving" the request or response.
   */
  switch (channelMessage.type) {
    case "channel/establish-request": {
      // 1. Establish the peer connection
      channel.peer = {
        state: "established",
        identity: channelMessage.identity,
      }

      // 2. Send establish response back to the requester
      const sendMessageCmd: Command = {
        type: "cmd/send-message",
        envelope: {
          toChannelIds: [fromChannelId],
          message: {
            type: "channel/establish-response",
            identity: current(model.identity),
          },
        },
      }

      // 3. Kick off sync for documents that our rules allow
      const docs: ChannelMsgSyncRequest["docs"] = Array.from(
        model.documents.values(),
      ).map(({ doc, docId }) => {
        const requesterDocVersion = doc.version()
        return { docId, requesterDocVersion }
      })

      const sendSyncRequestCmd: Command = {
        type: "cmd/send-message",
        envelope: {
          toChannelIds: [fromChannelId],
          message: {
            type: "channel/sync-request",
            docs,
          },
        },
      }

      return batchAsNeeded(sendMessageCmd, sendSyncRequestCmd)
    }

    case "channel/establish-response": {
      // 1. Establish the peer connection
      channel.peer = {
        state: "established",
        identity: channelMessage.identity,
      }

      // 2. Set awareness for all existing documents where canReveal permits
      for (const docState of model.documents.values()) {
        const context = getRuleContext({
          channel,
          docState,
        })

        if (!(context instanceof Error) && permissions.canReveal(context)) {
          setAwarenessState(docState, channel.channelId, "has-doc")
        }
      }

      // 3. Kick off sync for documents that our rules allow
      const docs: ChannelMsgSyncRequest["docs"] = Array.from(
        model.documents.values(),
      ).map(({ doc, docId }) => {
        const requesterDocVersion = doc.version()
        return { docId, requesterDocVersion }
      })

      const sendSyncRequestCmd: Command = {
        type: "cmd/send-message",
        envelope: {
          toChannelIds: [channel.channelId],
          message: {
            type: "channel/sync-request",
            docs,
          },
        },
      }

      return batchAsNeeded(sendSyncRequestCmd)
    }

    case "channel/sync-request": {
      const { docs } = channelMessage

      const commands: (Command | undefined)[] = []

      for (const { docId, requesterDocVersion } of docs) {
        const docState = model.documents.get(docId)

        if (docState) {
          logger.debug("sending sync-response due to channel/sync-request", {
            docId,
          })

          // Respond with document data if we have it
          commands.push({
            type: "cmd/send-sync-response",
            toChannelId: fromChannelId,
            docId,
            requesterDocVersion,
          })

          commands.push(setAwarenessState(docState, fromChannelId, "has-doc"))
        }
      }

      return batchAsNeeded(...commands)
    }
    case "channel/sync-response": {
      const docState = model.documents.get(channelMessage.docId)

      if (!docState) {
        // Document doesn't exist, nothing to do
        return
      }

      const channelState = docState.channelState.get(fromChannelId)
      if (!channelState) {
        return {
          type: "cmd/log",
          message: `can't accept sync-response for docId ${channelMessage.docId} from channel ${fromChannelId}: channel state not found`,
        }
      }

      switch (channelMessage.transmission.type) {
        case "up-to-date": {
          // nothing to do for doc data

          // but track that this channel has the doc
          setAwarenessState(docState, fromChannelId, "has-doc")

          // track that this channel has the doc
          return setLoadingStateWithCommand(
            model,
            channelMessage.docId,
            fromChannelId,
            {
              state: "found",
              version: channelMessage.transmission.version,
            },
          )
        }

        case "snapshot":
        case "update": {
          // apply the sync message to the document
          docState.doc.import(channelMessage.transmission.data)

          setAwarenessState(docState, fromChannelId, "has-doc")

          // track that this channel has the doc
          return setLoadingStateWithCommand(
            model,
            channelMessage.docId,
            fromChannelId,
            {
              state: "found",
              version: docState.doc.version(),
            },
          )
        }

        case "unavailable": {
          setAwarenessState(docState, fromChannelId, "no-doc")

          // track that this channel denied having the doc
          return setLoadingStateWithCommand(
            model,
            channelMessage.docId,
            fromChannelId,
            {
              state: "not-found",
            },
          )
        }
      }

      break
    }

    case "channel/directory-request": {
      // Filter documents based on permissions
      type Result =
        | { success: true; docId: string }
        | { success: false; error: Error }

      const docResults: Result[] = Array.from(
        model.documents.keys(),
      ).flatMap<Result>(docId => {
        const context = getRuleContext({
          channel: model.channels.get(fromChannelId),
          docState: model.documents.get(docId),
        })

        if (context instanceof Error) {
          return [{ success: false, error: context }]
        }

        if (permissions.canReveal(context)) {
          return [{ success: true, docId }]
        } else {
          return []
        }
      })

      const allowedDocIds = docResults.flatMap(result =>
        result.success ? [result.docId] : [],
      )

      const logCmds: Command[] = docResults.flatMap(result =>
        result.success
          ? []
          : [{ type: "cmd/log", message: result.error.message }],
      )

      const sendMessageCmd: Command = {
        type: "cmd/send-message",
        envelope: {
          toChannelIds: [fromChannelId],
          message: {
            type: "channel/directory-response",
            docIds: allowedDocIds,
          },
        },
      }

      return batchAsNeeded(...logCmds, sendMessageCmd)
    }

    case "channel/directory-response": {
      const commands: (Command | undefined)[] = []

      for (const docId of channelMessage.docIds) {
        let docState = model.documents.get(docId)

        if (!docState) {
          docState = createDocState({ docId })
          model.documents.set(docId, docState)
          commands.push({ type: "cmd/subscribe-local-doc", docId })
        }

        setAwarenessState(docState, fromChannelId, "has-doc")
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

type CreateSynchronizerUpdateParams = {
  permissions: Rules
  logger?: Logger
  onUpdate?: (patches: Patch[]) => void
}

/**
 * Creates a standard raj-compatible update function with permissions captured in closure.
 * Uses the transformer to provide immutability while keeping the logic clean.
 *
 * onPatch: optional debug callback that receives a list of changes at each update cycle
 */
export function createSynchronizerUpdate({
  permissions,
  logger,
  onUpdate,
}: CreateSynchronizerUpdateParams) {
  return makeImmutableUpdate(
    createSynchronizerLogic(
      permissions,
      logger ?? getLogger(["@loro-extended", "repo"]),
    ),
    onUpdate,
  )
}

export function getReadyStates(
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
        loading: Object.assign({}, state.loading),
      })
    }
  }

  return readyStates
}

function getRuleContext({
  channel,
  docState,
}: {
  channel: Channel | undefined
  docState: DocState | undefined
}): RuleContext | Error {
  if (!channel || channel.peer.state !== "established") {
    return new Error(`can't get rules context for undefined channel`)
  }

  if (!docState) {
    return new Error(`can't get rules context for undefined docState`)
  }

  const docChannelState = docState.channelState.get(channel.channelId)

  if (!docChannelState) {
    return new Error(`can't get rules context for undefined docChannelState`)
  }

  return {
    peerName: channel.peer.identity.name,
    channelId: channel.channelId,
    doc: docState.doc,
    docId: docState.docId,
    docChannelState,
  }
}

function setAwarenessState(
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

function setLoadingStateWithCommand(
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
    // Handle new loading state case
    if (status.loading.state !== loading.state) {
      status.loading = loading
      didSetLoading = true
    }

    // Handle updated version case
    if (
      status.loading.state === "found" &&
      loading.state === "found" &&
      status.loading.version.compare(loading.version) !== undefined
    ) {
      status.loading.version = loading.version
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
