/**
 * Handle doc-delete - Remove a document from the synchronizer
 *
 * This is called when the application wants to delete a document locally.
 * We remove it from the synchronizer's model, which stops tracking and
 * synchronizing it.
 *
 * ## What Gets Deleted
 *
 * - Document state (Loro document instance)
 * - Channel-specific state (loading states, subscriptions)
 * - All synchronization metadata
 *
 * ## What Doesn't Get Deleted
 *
 * - Peer awareness (peers still know we had this document)
 * - Persisted data in storage adapters (separate operation)
 * - Copies on remote peers (they keep their copies)
 *
 * ## Storage Adapter Behavior
 *
 * This handler does NOT automatically delete from storage. If you want to
 * delete persisted data, you must:
 * 1. Call this handler to stop synchronization
 * 2. Separately call storage adapter's delete method
 *
 * ## Peer Synchronization
 *
 * After deletion:
 * - We stop sending updates for this document
 * - We stop responding to sync-requests for it
 * - Peers keep their copies (no deletion propagation)
 * - If peer sends updates, we ignore them (no doc state)
 *
 * ## Idempotency
 *
 * If the document doesn't exist, we log a warning but don't fail.
 * This makes it safe to call multiple times.
 *
 * ## Usage Example
 *
 * ```typescript
 * // Delete from synchronizer
 * dispatch({
 *   type: "synchronizer/doc-delete",
 *   docId: "my-document"
 * })
 *
 * // Optionally delete from storage (separate operation)
 * await storageAdapter.delete("my-document")
 * ```
 *
 * ## Future Considerations
 *
 * This is a local-only deletion. For distributed deletion (tombstones,
 * deletion propagation), additional protocol messages would be needed.
 *
 * @see handle-doc-ensure.ts - Create/load document
 * @see handle-doc-change.ts - Update document
 */

import type { Logger } from "@logtape/logtape"
import type { Command, SynchronizerModel } from "../synchronizer-program.js"
import type { DocId } from "../types.js"

export function handleDocDelete(
  msg: { type: "synchronizer/doc-delete"; docId: DocId },
  model: SynchronizerModel,
  logger: Logger,
): Command | undefined {
  const { docId } = msg

  const docState = model.documents.get(docId)

  // If document doesn't exist, log warning but don't fail
  if (!docState) {
    logger.warn("doc-delete: unable to find doc-state {docId}", { docId })
    return
  }

  // Remove the document from the model
  // This removes:
  // - The Loro document instance
  // - All synchronization metadata
  model.documents.delete(docId)

  return
}
