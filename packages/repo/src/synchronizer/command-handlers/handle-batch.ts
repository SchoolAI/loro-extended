import type { Command } from "../../synchronizer-program.js"
import type { CommandContext } from "../command-executor.js"

type BatchCommand = Extract<Command, { type: "cmd/batch" }>

/**
 * Handle the cmd/batch command.
 *
 * A utility command that executes a batch of commands sequentially.
 */
export function handleBatch(command: BatchCommand, ctx: CommandContext): void {
  for (const cmd of command.commands) {
    ctx.executeCommand(cmd)
  }
}
