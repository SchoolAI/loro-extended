import type { Command } from "../synchronizer-program.js"

/**
 * Batch multiple commands into a single command if needed
 */
export function batchAsNeeded(
  ...commandSequence: (Command | undefined)[]
): Command | undefined {
  const definedCommands: Command[] = commandSequence.flatMap(c =>
    c ? [c] : [],
  )

  if (definedCommands.length === 0) {
    return
  }

  if (definedCommands.length === 1) {
    return definedCommands[0]
  }

  return { type: "cmd/batch", commands: definedCommands }
}
