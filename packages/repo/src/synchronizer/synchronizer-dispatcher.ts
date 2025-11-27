import type { Logger } from "@logtape/logtape"
import type { Rules } from "../rules.js"
import type {
  Command,
  SynchronizerMessage,
  SynchronizerModel,
} from "../synchronizer-program.js"
import { getEstablishedChannelsForDoc } from "../utils/get-established-channels-for-doc.js"
import { channelDispatcher } from "./channel-dispatcher.js"
import { handleChannelAdded } from "./connection/handle-channel-added.js"
import { handleChannelRemoved } from "./connection/handle-channel-removed.js"
import { handleEstablishChannel } from "./connection/handle-establish-channel.js"
import { handleDocDelete } from "./sync/handle-doc-delete.js"
import { handleDocEnsure } from "./sync/handle-doc-ensure.js"
import { handleDocImported } from "./sync/handle-doc-imported.js"
import { handleLocalDocChange } from "./sync/handle-local-doc-change.js"

export function synchronizerDispatcher(
  msg: SynchronizerMessage,
  model: SynchronizerModel,
  rules: Rules,
  logger: Logger,
): Command | undefined {
  switch (msg.type) {
    case "synchronizer/heartbeat": {
      // Broadcast all ephemeral state for all documents to all peers
      const commands: Command[] = []

      for (const docId of model.documents.keys()) {
        const channelIds = getEstablishedChannelsForDoc(
          model.channels,
          model.peers,
          docId,
        )

        if (channelIds.length > 0) {
          commands.push({
            type: "cmd/broadcast-ephemeral",
            docId,
            allPeerData: true,
            hopsRemaining: 0,
            toChannelIds: channelIds,
          })
        }
      }

      return commands.length > 0 ? { type: "cmd/batch", commands } : undefined
    }

    case "synchronizer/ephemeral-local-change": {
      const channelIds = getEstablishedChannelsForDoc(
        model.channels,
        model.peers,
        msg.docId,
      )

      return {
        type: "cmd/batch",
        commands: [
          {
            type: "cmd/emit-ephemeral-change",
            docId: msg.docId,
          },
          {
            type: "cmd/broadcast-ephemeral",
            docId: msg.docId,
            allPeerData: false,
            // Allow a hub-and-spoke server to propagate one more hop
            hopsRemaining: 1,
            toChannelIds: channelIds,
          },
        ],
      }
    }

    case "synchronizer/channel-added":
      return handleChannelAdded(msg, model)

    case "synchronizer/establish-channel":
      return handleEstablishChannel(msg, model, logger)

    case "synchronizer/channel-removed":
      return handleChannelRemoved(msg, model, logger)

    case "synchronizer/doc-ensure":
      return handleDocEnsure(msg, model, rules)

    case "synchronizer/local-doc-change":
      return handleLocalDocChange(msg, model, rules, logger)

    case "synchronizer/doc-imported":
      return handleDocImported(msg, model, rules, logger)

    case "synchronizer/doc-delete":
      return handleDocDelete(msg, model, logger)

    case "synchronizer/channel-receive-message":
      // Channel messages are routed through the channel dispatcher
      return channelDispatcher(
        msg.envelope.message,
        model,
        msg.envelope.fromChannelId,
        rules,
        logger,
      )
  }
}
