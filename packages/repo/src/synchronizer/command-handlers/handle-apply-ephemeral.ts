import type { Command } from "../../synchronizer-program.js"
import type { CommandContext } from "../command-executor.js"

type ApplyEphemeralCommand = Extract<Command, { type: "cmd/apply-ephemeral" }>

/**
 * Handle the cmd/apply-ephemeral command.
 *
 * Applies ephemeral data from remote peers to the appropriate namespaced stores.
 * Emits ephemeral-change events for each store that receives data.
 */
export function handleApplyEphemeral(
  command: ApplyEphemeralCommand,
  ctx: CommandContext,
): void {
  const { docId, stores } = command

  // All ephemeral messages must have a namespace
  for (const storeData of stores) {
    const { peerId, data, namespace } = storeData

    if (!namespace) {
      ctx.logger.warn(
        "cmd/apply-ephemeral: received message without namespace from {peerId} in {docId}, ignoring",
        { peerId, docId },
      )
      continue
    }

    if (data.length === 0) {
      // Empty data - could indicate deletion, but for namespaced stores
      // we don't delete the whole store, just let the data expire
      ctx.logger.debug(
        "cmd/apply-ephemeral: received empty data for namespace {namespace} from {peerId} in {docId}",
        { namespace, peerId, docId },
      )
    } else {
      // Get or create the namespaced store and apply the data
      const store = ctx.getOrCreateNamespacedStore(docId, namespace)
      store.apply(data)

      ctx.logger.trace(
        "cmd/apply-ephemeral: applied {dataLength} bytes to namespace {namespace} from {peerId} in {docId}",
        { namespace, peerId, docId, dataLength: data.length },
      )
    }

    void ctx.emitter.emit("ephemeral-change", {
      docId,
      source: "remote",
      peerId,
    })
  }
}
