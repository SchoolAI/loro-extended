import type { Command } from "../../synchronizer-program.js"
import { TimerlessEphemeralStore } from "../../utils/timerless-ephemeral-store.js"
import type { CommandContext } from "../command-executor.js"

type BroadcastEphemeralBatchCommand = Extract<
  Command,
  { type: "cmd/broadcast-ephemeral-batch" }
>

/**
 * Handle the cmd/broadcast-ephemeral-batch command.
 *
 * Macro command: expands into multiple cmd/broadcast-ephemeral-namespace commands.
 * Each sub-command queues messages via queueSend(); the deferred send layer
 * aggregates them into a single channel/batch message at flush time.
 */
export function handleBroadcastEphemeralBatch(
  command: BroadcastEphemeralBatchCommand,
  ctx: CommandContext,
): void {
  const subCommands: Command[] = []

  for (const docId of command.docIds) {
    const namespaceStores = ctx.docNamespacedStores.get(docId)

    if (!namespaceStores || namespaceStores.size === 0) {
      continue
    }

    // Touch all stores before encoding (for heartbeat timestamp refresh)
    for (const store of namespaceStores.values()) {
      if (store instanceof TimerlessEphemeralStore) {
        store.touch()
      }
    }

    // Create a command for each namespace
    for (const namespace of namespaceStores.keys()) {
      subCommands.push({
        type: "cmd/broadcast-ephemeral-namespace",
        docId,
        namespace,
        hopsRemaining: command.hopsRemaining,
        toChannelIds: [command.toChannelId],
      })
    }
  }

  if (subCommands.length === 0) {
    ctx.logger.debug(
      "cmd/broadcast-ephemeral-batch: skipping (no stores to broadcast)",
    )
    return
  }

  // Execute all sub-commands; each queues messages via queueSend()
  // The deferred send layer aggregates them at flush time
  for (const cmd of subCommands) {
    ctx.executeCommand(cmd)
  }

  ctx.logger.trace(
    "cmd/broadcast-ephemeral-batch: expanded into {cmdCount} namespace broadcasts for channel {channelId}",
    {
      cmdCount: subCommands.length,
      channelId: command.toChannelId,
    },
  )
}
