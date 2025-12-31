import type { ChannelMsgEphemeral } from "../../channel.js"
import type { Command } from "../../synchronizer-program.js"
import type { CommandContext } from "../command-executor.js"

type BroadcastEphemeralNamespaceCommand = Extract<
  Command,
  { type: "cmd/broadcast-ephemeral-namespace" }
>

/**
 * Handle the cmd/broadcast-ephemeral-namespace command.
 *
 * Broadcasts a single namespace's ephemeral data for a document to specified channels.
 */
export function handleBroadcastEphemeralNamespace(
  command: BroadcastEphemeralNamespaceCommand,
  ctx: CommandContext,
): void {
  const { docId, namespace, hopsRemaining, toChannelIds } = command
  const store = ctx.getNamespacedStore(docId, namespace)

  if (!store) {
    ctx.logger.debug(
      "cmd/broadcast-ephemeral-namespace: skipping for {docId}/{namespace} (store not found)",
      () => ({ docId, namespace }),
    )
    return
  }

  const data = store.encodeAll()
  if (data.length === 0) {
    ctx.logger.debug(
      "cmd/broadcast-ephemeral-namespace: skipping for {docId}/{namespace} (no data)",
      () => ({ docId, namespace }),
    )
    return
  }

  if (toChannelIds.length === 0) {
    ctx.logger.debug(
      "cmd/broadcast-ephemeral-namespace: skipping for {docId}/{namespace} (no channels)",
      () => ({ docId, namespace }),
    )
    return
  }

  // Build the ephemeral message
  const message: ChannelMsgEphemeral = {
    type: "channel/ephemeral",
    docId,
    hopsRemaining,
    stores: [
      {
        peerId: ctx.identity.peerId,
        data,
        namespace,
      },
    ],
  }

  // Queue for each channel (deferred send will aggregate)
  for (const channelId of toChannelIds) {
    ctx.queueSend(channelId, message)
  }

  ctx.logger.trace(
    "cmd/broadcast-ephemeral-namespace: queued {namespace} for {docId} to {channelCount} channels",
    { namespace, docId, channelCount: toChannelIds.length },
  )
}
