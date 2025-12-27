/**
 * Handle doc-ensure - Create or load a document
 *
 * This is called when the application wants to ensure a document exists locally.
 * If the document doesn't exist yet, we create it and request data from all
 * available channels (storage and peers).
 *
 * ## Document Creation
 *
 * When creating a new document:
 * 1. Create empty Loro document with the specified docId
 * 2. Register it in the synchronizer model
 * 3. Send sync-request to all channels (filtered by visibility permission)
 * 4. Subscribe to local changes
 *
 * ## Permission Filtering
 *
 * We only request from channels where `visibility` permits:
 * - Storage adapters typically see all documents
 * - Network peers may be restricted by permission rules
 * - This prevents leaking document existence to unauthorized peers
 *
 * ## Pull-Based Loading
 *
 * This handler implements pull-based document loading:
 * - Application explicitly requests document
 * - We send sync-request to all channels
 * - Channels respond with data (or unavailable)
 * - First response with data wins
 *
 * ## Storage Adapter Behavior
 *
 * Storage adapters will:
 * 1. Receive sync-request for this document
 * 2. Check if they have persisted data
 * 3. Respond with snapshot (if found) or unavailable (if not)
 * 4. Subscribe to future updates (added to subscriptions)
 *
 * ## Idempotency
 *
 * If the document already exists, this is a no-op. This makes it safe to call
 * multiple times without side effects.
 *
 * ## Usage Example
 *
 * ```typescript
 * // Application wants to load/create a document
 * dispatch({
 *   type: "synchronizer/local-doc-ensure",
 *   docId: "my-document"
 * })
 *
 * // Synchronizer will:
 * // 1. Create empty doc (if needed)
 * // 2. Request from storage
 * // 3. Request from peers (if allowed)
 * // 4. Subscribe to changes
 * ```
 *
 * @see handle-local-doc-change.ts - Propagate changes after document is loaded
 * @see handle-local-doc-delete.ts - Remove document
 * @see handle-sync-response.ts - How channels respond with data
 */

import { isEstablished } from "../../channel.js"
import type { Permissions } from "../../permissions.js"
import type { Command, SynchronizerModel } from "../../synchronizer-program.js"
import { createDocState, type DocId } from "../../types.js"
import { getPermissionContext } from "../permission-context.js"
import { batchAsNeeded } from "../utils.js"

export function handleDocEnsure(
  msg: { type: "synchronizer/doc-ensure"; docId: DocId },
  model: SynchronizerModel,
  permissions: Permissions,
): Command | undefined {
  const { docId } = msg

  let docState = model.documents.get(docId)

  // If document already exists, nothing to do
  if (docState) {
    return
  }

  // Create new document state
  docState = createDocState({ docId })
  model.documents.set(docId, docState)

  const commands: Command[] = []

  // Send sync-request to all established channels where visibility permits
  for (const channel of model.channels.values()) {
    if (isEstablished(channel)) {
      const context = getPermissionContext({
        channel,
        docState,
        model,
      })

      // Check visibility permission - can we ask this channel about this document?
      if (
        !(context instanceof Error) &&
        permissions.visibility(context.doc, context.peer)
      ) {
        // Send sync-request to load document data
        // Note: When channel responds, it will add to peer's subscriptions
        commands.push({
          type: "cmd/send-message",
          envelope: {
            toChannelIds: [channel.channelId],
            message: {
              type: "channel/sync-request",
              docId,
              requesterDocVersion: docState.doc.version(),
              bidirectional: true,
            },
          },
        })
      }
    }
  }

  // Subscribe to changes on this document
  commands.push({ type: "cmd/subscribe-doc", docId })

  return batchAsNeeded(...commands)
}
