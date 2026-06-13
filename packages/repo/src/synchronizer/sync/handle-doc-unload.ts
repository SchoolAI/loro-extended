/**
 * Handle doc-unload - Evict a document from memory while retaining storage.
 *
 * Unlike {@link handleDocDelete}, this is a *pure memory eviction*: it removes
 * the document from the synchronizer's model so it stops being tracked and
 * synchronized, but it sends NO `channel/delete-request` to any peer and does
 * NOT touch storage. Persisted chunks survive; a later `repo.get(docId)` runs a
 * fresh doc-ensure → sync-request cycle and storage-first sync rehydrates the
 * doc from disk.
 *
 * ## Why unload exists separately from delete
 *
 * `delete` is a *user intent* ("get rid of this document"): it fans a
 * delete-request out to subscribed peers. `unload` is a *resource-management
 * action* ("I don't need this in memory right now"): LRU caches and idle sweeps
 * want to free wasm memory without telling anyone the doc is gone, because it
 * isn't — it's still on disk and on other replicas.
 *
 * ## What gets evicted (by the handler)
 *
 * - The document state (LoroDoc instance) from `model.documents`.
 *
 * ## What the runtime additionally clears (in Synchronizer.unloadDocument)
 *
 * - The doc's `readyStates` entry.
 * - The doc's `EphemeralStoreManager` namespaced stores.
 *
 * ## What is intentionally left intact
 *
 * - Persisted data in storage adapters (the whole point — retained for re-get).
 * - Peer `subscriptions` entries. These are stale-but-harmless: a re-`get()`
 *   triggers doc-ensure → sync-request, and storage-first sync rehydrates. We
 *   do not prune them so unload stays a cheap, local-only operation.
 *
 * ## Caveat: in-flight storage/network requests
 *
 * Unloading a doc that has in-flight `pendingStorageChannels` /
 * `pendingNetworkRequests` orphans those queued requests. A late storage
 * sync-response then finds no docState and the snapshot path re-creates it
 * (see handle-sync-response.ts). Callers should unload only *quiescent* docs;
 * the doc still recovers correctly on the next `get()`.
 *
 * @see handle-doc-delete.ts - Distributed deletion (fans out delete-request)
 * @see handle-doc-ensure.ts - Create/load document
 */

import type { Logger } from "@logtape/logtape"
import type { Command, SynchronizerModel } from "../../synchronizer-program.js"
import type { DocId } from "../../types.js"

export function handleDocUnload(
  msg: { type: "synchronizer/doc-unload"; docId: DocId },
  model: SynchronizerModel,
  logger: Logger,
): Command | undefined {
  const { docId } = msg

  const docState = model.documents.get(docId)

  // If document doesn't exist, log warning but don't fail (idempotent)
  if (!docState) {
    logger.warn("doc-unload: unable to find doc-state {docId}", { docId })
    return
  }

  // Remove the in-memory document from the model. No delete-request is sent to
  // any peer and storage is untouched: this is an eviction, not a deletion.
  model.documents.delete(docId)

  return undefined
}
