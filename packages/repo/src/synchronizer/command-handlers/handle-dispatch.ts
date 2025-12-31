import type { Command } from "../../synchronizer-program.js"
import type { CommandContext } from "../command-executor.js"

type DispatchCommand = Extract<Command, { type: "cmd/dispatch" }>

/**
 * Handle the cmd/dispatch command.
 *
 * A utility command that sends a dispatch back into the program message loop.
 */
export function handleDispatch(
  command: DispatchCommand,
  ctx: CommandContext,
): void {
  ctx.dispatch(command.dispatch)
}
