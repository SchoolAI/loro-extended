/**
 * Handle local-doc-change - Propagate LOCAL document changes to peers
 *
 * This is triggered whenever a document is modified LOCALLY (user edits via
 * doc.subscribe with event.by === "local"). It implements the **pull-based
 * discovery model** where we announce changes but let peers decide whether
 * to request the data.
 *
 * ## When This Fires
 *
 * This handler is triggered by doc.subscribeLocalUpdates()
 *
 * This means:
 * - User edits via DocHandle.change()
 * - Direct mutations to doc via handle.doc
 * - Any local operation that modifies the document
 *
 * It does NOT fire for:
 * - Imported changes from peers (handled by handle-doc-imported.ts)
 * - Checkout operations (ignored for now)
 *
 * ## Protocol Flows
 *
 * ### Flow 1: New Document Created
 * ```
 * User creates doc → local-doc-change
 *   → Send directory-response (announcement) to all channels
 *   → Storage adapter sends sync-request (eager)
 *   → Network peer may send sync-request (if interested)
 * ```
 *
 * ### Flow 2: Existing Document Modified
 * ```
 * User edits doc → local-doc-change
 *   → Send sync-response to peers who requested (real-time update)
 *   → Send directory-response to peers who don't know about it
 * ```
 *
 * @see docs/discovery-and-sync-architecture.md - Pattern 2: Local Document Changes
 * @see handle-doc-imported.ts - Similar logic for imported changes
 * @see propagate-to-peers.ts - Shared propagation logic
 */

import type { Logger } from "@logtape/logtape"
import type { Rules } from "../../rules.js"
import type { Command, SynchronizerModel } from "../../synchronizer-program.js"
import type { DocId } from "../../types.js"
import { batchAsNeeded } from "../utils.js"
import { propagateToPeers } from "./propagate-to-peers.js"

export function handleLocalDocChange(
  msg: {
    type: "synchronizer/local-doc-change"
    docId: DocId
  },
  model: SynchronizerModel,
  rules: Rules,
  logger: Logger,
): Command | undefined {
  const { docId } = msg

  const docState = model.documents.get(docId)

  if (!docState) {
    logger.warn("local-doc-change: unable to find doc-state {docId}", { docId })
    return
  }

  logger.debug(
    "local-doc-change processing for {docId} with {channelCount} channels",
    {
      docId,
      channelCount: model.channels.size,
    },
  )

  const ourVersion = docState.doc.version()

  const commands = propagateToPeers({
    docId,
    docState,
    ourVersion,
    model,
    rules,
    logger,
    logPrefix: "local-doc-change",
  })

  return batchAsNeeded(...commands)
}
