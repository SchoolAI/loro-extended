import type { Command } from "../../synchronizer-program.js"
import type { CommandContext } from "../command-executor.js"

type SendSyncRequestCommand = Extract<
  Command,
  { type: "cmd/send-sync-request" }
>

/**
 * Handle the cmd/send-sync-request command.
 *
 * Builds and queues sync-request messages for multiple documents.
 * The deferred send layer will aggregate them into a batch at flush time.
 */
export function handleSendSyncRequest(
  command: SendSyncRequestCommand,
  ctx: CommandContext,
): void {
  const { toChannelId, docs, bidirectional, includeEphemeral } = command

  // Validate channel exists
  const channel = ctx.model.channels.get(toChannelId)
  if (!channel) {
    ctx.logger.warn(
      "can't send sync-request, channel {toChannelId} doesn't exist",
      { toChannelId },
    )
    return
  }

  // Queue each sync-request message individually
  // The deferred send layer will aggregate them into a batch at flush time
  for (const doc of docs) {
    const message = ctx.buildSyncRequestMessage(
      doc,
      bidirectional,
      includeEphemeral,
    )
    ctx.queueSend(toChannelId, message)
  }
}
