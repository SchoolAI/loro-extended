/**
 * RPS Game Schema - Shared between server and client
 *
 * This schema defines the structure of the Rock-Paper-Scissors game document.
 */

import type { Mutable, TypedDoc } from "@loro-extended/change"
import { Shape } from "@loro-extended/change"

/** Game phases */
export type Phase = "choosing" | "reveal" | "resolved"

/** Game result */
export type Result = "alice" | "bob" | "draw"

/** Player choice */
export type Choice = "rock" | "paper" | "scissors"

/** Player state */
export type PlayerState = {
  choice: Choice | null
  locked: boolean
}

/**
 * RPS Game Schema
 *
 * Structure:
 * - game.phase: Current game phase
 * - game.result: Game result (null until resolved)
 * - game.players: Map of player ID to player state
 */
export const GameSchema = Shape.doc({
  game: Shape.struct({
    phase: Shape.plain.string<Phase>().placeholder("choosing"),
    result: Shape.plain.string<Result>().nullable(),
    players: Shape.record(
      Shape.struct({
        choice: Shape.plain.string<Choice>().nullable(),
        locked: Shape.plain.boolean().placeholder(false),
      }),
    ),
  }),
})

export type GameDocShape = typeof GameSchema

export type GameDoc = TypedDoc<GameDocShape>

export type GameChangeFn = (draft: Mutable<GameDocShape>) => void
