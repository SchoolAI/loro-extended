import type { Command } from "../../synchronizer-program.js"
import type { CommandContext } from "../command-executor.js"

type SendEstablishmentMessageCommand = Extract<
  Command,
  { type: "cmd/send-establishment-message" }
>

/**
 * Handle the cmd/send-establishment-message command.
 *
 * Sends establishment messages (establish-request or establish-response)
 * to channels that are not yet established.
 */
export function handleSendEstablishmentMessage(
  command: SendEstablishmentMessageCommand,
  ctx: CommandContext,
): void {
  ctx.logger.debug("executing cmd/send-establishment-message: {messageType}", {
    messageType: command.envelope.message.type,
    toChannelIds: command.envelope.toChannelIds,
    totalAdapters: ctx.adapters.adapters.length,
    adapterChannelCounts: ctx.adapters.adapters.map(a => ({
      adapterType: a.adapterType,
      channelCount: a.channels.size,
    })),
  })

  const sentCount = ctx.adapters.sendEstablishmentMessage(command.envelope)

  ctx.logger.debug(
    "cmd/send-establishment-message result: sent {sentCount}/{expectedCount}",
    {
      sentCount,
      expectedCount: command.envelope.toChannelIds.length,
    },
  )

  if (sentCount < command.envelope.toChannelIds.length) {
    ctx.logger.warn(
      "cmd/send-establishment-message could not deliver {messageType} to all {expectedCount} channels",
      {
        messageType: command.envelope.message.type,
        expectedCount: command.envelope.toChannelIds.length,
        channelIds: command.envelope.toChannelIds,
      },
    )
  }
}
