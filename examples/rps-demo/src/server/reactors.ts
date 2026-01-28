/**
 * Reactors - Server-side game logic
 *
 * Reactors respond to state transitions and trigger game logic.
 * They run on the server to ensure game rules are enforced consistently.
 */

import type { Choice, GameChangeFn, GameDoc, Result } from "../shared/schema.js"

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
  change: (fn: GameChangeFn) => void,
) => {
  // Only trigger if we're in choosing phase
  if (after.game.phase !== "choosing") return

  const wasAllLocked = before.game.players.values().every(p => p.locked)
  const isAllLocked = after.game.players.values().every(p => p.locked)

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
  change: (fn: GameChangeFn) => void,
) => {
  console.log("resolveGameReactor", {
    beforePhase: before.game.phase,
    afterPhase: after.game.phase,
    beforeIsChoosing: before.game.phase === "choosing",
    afterIsReveal: after.game.phase === "reveal",
  })
  // Detect transition to reveal phase
  if (before.game.phase === "choosing" && after.game.phase === "reveal") {
    const aliceChoice = after.game.players.get("alice")?.choice ?? null
    const bobChoice = after.game.players.get("bob")?.choice ?? null

    const result = calculateWinner(aliceChoice, bobChoice)

    change(d => {
      d.game.phase = "resolved"
      d.game.result = result
    })
  }
}
