/**
 * Reactors - Server-side game logic
 *
 * Reactors respond to state transitions and trigger game logic.
 * They run on the server to ensure game rules are enforced consistently.
 */

import { type Draft, unwrap } from "@loro-extended/change"
import type { Choice, GameDoc, GameDocShape, Result } from "../shared/schema.js"

/**
 * Calculate the winner of a Rock-Paper-Scissors game.
 *
 * @param aliceChoice - Alice's choice
 * @param bobChoice - Bob's choice
 * @returns The result, or null if either choice is missing
 */
export function calculateWinner(
  aliceChoice: Choice | null,
  bobChoice: Choice | null,
): Result | null {
  if (!aliceChoice || !bobChoice) return null

  if (aliceChoice === bobChoice) return "draw"

  const wins: Record<Choice, Choice> = {
    rock: "scissors",
    paper: "rock",
    scissors: "paper",
  }

  return wins[aliceChoice] === bobChoice ? "alice" : "bob"
}

/**
 * Reactor that triggers reveal when all players are locked.
 *
 * Detects when both players have locked in their choices and
 * transitions the game to the "reveal" phase.
 */
export const allLockedReactor = (
  {
    before,
    after,
  }: {
    before: GameDoc
    after: GameDoc
  },
  change: (fn: (draft: Draft<GameDocShape>) => void) => void,
) => {
  // Only trigger if we're in choosing phase
  if (unwrap(after.game.phase) !== "choosing") return

  const wasAllLocked = before.game.players.values().every(p => unwrap(p.locked))
  const isAllLocked = after.game.players.values().every(p => unwrap(p.locked))

  if (isAllLocked && !wasAllLocked) {
    // Transition to reveal phase
    change(d => {
      d.game.phase = "reveal"
    })
  }
}

/**
 * Reactor that resolves the game when phase becomes reveal.
 *
 * Calculates the winner and transitions to the "resolved" phase.
 */
export const resolveGameReactor = (
  {
    before,
    after,
  }: {
    before: GameDoc
    after: GameDoc
  },
  change: (fn: (draft: Draft<GameDocShape>) => void) => void,
) => {
  // Detect transition to reveal phase
  if (
    unwrap(before.game.phase) === "choosing" &&
    unwrap(after.game.phase) === "reveal"
  ) {
    const aliceChoice = (unwrap(after.game.players.get("alice")?.choice) ??
      null) as Choice | null
    const bobChoice = (unwrap(after.game.players.get("bob")?.choice) ??
      null) as Choice | null

    const result = calculateWinner(aliceChoice, bobChoice)

    change(d => {
      d.game.phase = "resolved"
      d.game.result = result
    })
  }
}
