import type { Command } from "../../synchronizer-program.js"
import type { CommandContext } from "../command-executor.js"

type ImportDocDataCommand = Extract<Command, { type: "cmd/import-doc-data" }>

/**
 * Handle the cmd/import-doc-data command.
 *
 * Imports document data from a remote peer and dispatches a follow-up
 * message to update peer awareness and trigger multi-hop propagation.
 */
export function handleImportDocData(
  command: ImportDocDataCommand,
  ctx: CommandContext,
): void {
  const { docId, data, fromPeerId } = command

  const docState = ctx.model.documents.get(docId)
  if (!docState) {
    ctx.logger.warn("can't import doc data, doc {docId} not found", {
      docId,
    })
    return
  }

  // Import the document data
  // Note: doc.subscribe() only fires for "local" events, so import won't trigger it
  docState.doc.import(data)

  // After import, dispatch a message to:
  // 1. Update peer awareness to our CURRENT version (prevents echo)
  // 2. Trigger doc-change for multi-hop propagation to OTHER peers
  //
  // We pass fromPeerId so the doc-change handler knows to skip this peer
  // (they just sent us this data, so they already have it)
  ctx.dispatch({
    type: "synchronizer/doc-imported",
    docId,
    fromPeerId,
  })
}
