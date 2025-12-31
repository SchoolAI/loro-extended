import type { Command } from "../../synchronizer-program.js"
import type { CommandContext } from "../command-executor.js"

type EmitEphemeralChangeCommand = Extract<
  Command,
  { type: "cmd/emit-ephemeral-change" }
>

/**
 * Handle the cmd/emit-ephemeral-change command.
 *
 * Emits an ephemeral-change event for local changes.
 */
export function handleEmitEphemeralChange(
  command: EmitEphemeralChangeCommand,
  ctx: CommandContext,
): void {
  ctx.emitter.emit("ephemeral-change", {
    docId: command.docId,
    source: "local",
  })
}
