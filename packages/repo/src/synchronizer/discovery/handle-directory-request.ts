import type { ChannelMsgDirectoryRequest } from "../../channel.js"
import { isEstablished } from "../../channel.js"
import type { Command } from "../../synchronizer-program.js"
import { getRuleContext } from "../rule-context.js"
import type { ChannelHandlerContext } from "../types.js"
import { batchAsNeeded } from "../utils.js"

export function handleDirectoryRequest(
  _message: ChannelMsgDirectoryRequest,
  { channel, model, fromChannelId, permissions, logger }: ChannelHandlerContext,
): Command | undefined {
  // Require established channel for directory operations
  if (!isEstablished(channel)) {
    logger.warn(
      `directory-request from unestablished channel ${channel.channelId}`,
    )
    return
  }

  // Filter documents based on canReveal permission
  // We use a Result type to track both successes and errors
  type Result =
    | { success: true; docId: string }
    | { success: false; error: Error }

  const docResults: Result[] = Array.from(
    model.documents.keys(),
  ).flatMap<Result>(docId => {
    // Get rule context for permission checking
    const context = getRuleContext({
      channel,
      docState: model.documents.get(docId),
      model,
    })

    // If we can't get context (e.g., missing peer state), log error
    if (context instanceof Error) {
      logger.warn(`directory-request error: ${context.message}`)
      return []
    }

    // Check canReveal permission - can we tell this peer about this document?
    if (permissions.canReveal(context)) {
      return [{ success: true, docId }]
    } else {
      // Permission denied - don't reveal this document
      return []
    }
  })

  // Separate successful docIds from errors
  const allowedDocIds = docResults.flatMap(result =>
    result.success ? [result.docId] : [],
  )

  // Send directory-response with filtered list
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

  return batchAsNeeded(sendMessageCmd)
}
