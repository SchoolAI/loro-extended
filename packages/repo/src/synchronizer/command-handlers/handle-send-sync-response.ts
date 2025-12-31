import type { Command } from "../../synchronizer-program.js"
import type { CommandContext } from "../command-executor.js"

type SendSyncResponseCommand = Extract<
  Command,
  { type: "cmd/send-sync-response" }
>

/**
 * Handle the cmd/send-sync-response command.
 *
 * Builds and queues a sync-response message for a document.
 * Optionally includes ephemeral data in the response.
 */
export function handleSendSyncResponse(
  command: SendSyncResponseCommand,
  ctx: CommandContext,
): void {
  const { docId, requesterDocVersion, toChannelId, includeEphemeral } = command

  const message = ctx.buildSyncResponseMessage(
    docId,
    requesterDocVersion,
    toChannelId,
    includeEphemeral,
  )

  if (message) {
    ctx.queueSend(toChannelId, message)
  }
}
