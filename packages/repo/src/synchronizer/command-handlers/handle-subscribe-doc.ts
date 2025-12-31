import type { Command } from "../../synchronizer-program.js"
import type { CommandContext } from "../command-executor.js"

type SubscribeDocCommand = Extract<Command, { type: "cmd/subscribe-doc" }>

/**
 * Handle the cmd/subscribe-doc command.
 *
 * Subscribes to local changes on a document, routing them through
 * the dispatch system for proper TEA compliance.
 *
 * NOTE: Remote (imported) changes are handled explicitly in handle-sync-response.
 */
export function handleSubscribeDoc(
  command: SubscribeDocCommand,
  ctx: CommandContext,
): void {
  const { docId } = command

  const docState = ctx.model.documents.get(docId)
  if (!docState) {
    ctx.logger.warn("can't get doc-state, doc {docId} not found", { docId })
    return
  }

  /**
   * Subscribe to local changes, to be handled by local-doc-change.
   *
   * NOTE: Remote (imported) changes are handled explicitly in handle-sync-response.
   */
  docState.doc.subscribeLocalUpdates(() => {
    ctx.dispatch({
      type: "synchronizer/local-doc-change",
      docId,
    })
  })
  // For "import" events, we don't dispatch local-doc-change here.
  // The import is triggered by cmd/import-doc-data, which is followed by
  // a cmd/dispatch for doc-change with proper peer awareness already set.
}
