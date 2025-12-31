import type { Command } from "../../synchronizer-program.js"
import type { CommandContext } from "../command-executor.js"

type StopChannelCommand = Extract<Command, { type: "cmd/stop-channel" }>

/**
 * Handle the cmd/stop-channel command.
 *
 * De-initializes a channel by calling its stop() method.
 */
export function handleStopChannel(
  command: StopChannelCommand,
  _ctx: CommandContext,
): void {
  command.channel.stop()
}
