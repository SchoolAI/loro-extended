/**
 * Handle delete-request - Process a deletion request from a remote peer
 *
 * This is called when a remote peer sends a `channel/delete-request` message,
 * indicating they want us to delete a document.
 *
 * ## Permission Check
 *
 * Before deleting, we check the `deletion` permission. If the permission
 * returns `false`, we ignore the request and the document remains.
 *
 * ## What Gets Deleted
 *
 * If permitted, we delete:
 * - Document state (Loro document instance)
 * - All synchronization metadata
 *
 * ## Response
 *
 * We send a `channel/delete-response` back to the peer indicating:
 * - `deleted` - The document was deleted
 * - `ignored` - The request was denied (permission check failed)
 *
 * @see handle-doc-delete.ts - Local deletion (app-initiated)
 * @see permissions.ts - Deletion permission
 */

import type { ChannelMsgDeleteRequest } from "../../channel.js"
import type { Command } from "../../synchronizer-program.js"
import { getPermissionContext } from "../permission-context.js"
import type { EstablishedHandlerContext } from "../types.js"

export function handleDeleteRequest(
  message: ChannelMsgDeleteRequest,
  { channel, model, permissions, logger }: EstablishedHandlerContext,
): Command | undefined {
  const { docId } = message

  const docState = model.documents.get(docId)

  // If document doesn't exist, nothing to delete
  if (!docState) {
    logger.debug("delete-request: document {docId} not found, ignoring", {
      docId,
    })
    return {
      type: "cmd/send-message",
      envelope: {
        toChannelIds: [channel.channelId],
        message: {
          type: "channel/delete-response",
          docId,
          status: "ignored",
        },
      },
    }
  }

  // Check deletion permission
  const context = getPermissionContext({ channel, docState, model })

  if (context instanceof Error) {
    logger.warn("delete-request: unable to get permission context: {error}", {
      error: context.message,
    })
    return {
      type: "cmd/send-message",
      envelope: {
        toChannelIds: [channel.channelId],
        message: {
          type: "channel/delete-response",
          docId,
          status: "ignored",
        },
      },
    }
  }

  if (!permissions.deletion(context.doc, context.peer)) {
    logger.info(
      "delete-request: deletion denied for {docId} from peer {peerName}",
      {
        docId,
        peerName: context.peer.peerName,
      },
    )
    return {
      type: "cmd/send-message",
      envelope: {
        toChannelIds: [channel.channelId],
        message: {
          type: "channel/delete-response",
          docId,
          status: "ignored",
        },
      },
    }
  }

  // Permission granted - delete the document
  logger.info("delete-request: deleting {docId} as requested by {peerName}", {
    docId,
    peerName: context.peer.peerName,
  })

  model.documents.delete(docId)

  return {
    type: "cmd/send-message",
    envelope: {
      toChannelIds: [channel.channelId],
      message: {
        type: "channel/delete-response",
        docId,
        status: "deleted",
      },
    },
  }
}
