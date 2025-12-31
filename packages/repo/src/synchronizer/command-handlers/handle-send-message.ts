import type { BatchableMsg } from "../../channel.js"
import type { Command } from "../../synchronizer-program.js"
import type { CommandContext } from "../command-executor.js"

type SendMessageCommand = Extract<Command, { type: "cmd/send-message" }>

/**
 * Handle the cmd/send-message command.
 *
 * Queues messages for deferred send (aggregated at end of dispatch).
 * Validates channels before sending and flattens nested batches.
 */
export function handleSendMessage(
  command: SendMessageCommand,
  ctx: CommandContext,
): void {
  for (const channelId of command.envelope.toChannelIds) {
    if (!ctx.validateChannelForSend(channelId)) continue

    // Flatten nested batches
    if (command.envelope.message.type === "channel/batch") {
      for (const msg of command.envelope.message.messages) {
        ctx.queueSend(channelId, msg)
      }
    } else {
      ctx.queueSend(channelId, command.envelope.message as BatchableMsg)
    }
  }
}
