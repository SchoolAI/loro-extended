/**
 * useRpsGame Hook - Client-side game state management
 *
 * This hook manages the client's connection to the game and provides
 * methods for making choices and locking in.
 */

import {
  change,
  type Draft,
  loro,
  type TypedDoc,
  unwrap,
} from "@loro-extended/change"
import { useDocument, useLens } from "@loro-extended/react"
import { useEffect } from "react"
import { createIdentityMessage } from "../shared/identity.js"
import {
  type Choice,
  type GameDocShape,
  GameSchema,
  type Phase,
  type Result,
} from "../shared/schema.js"
import { createClientLensFilter } from "./filters.js"

/**
 * Hook for managing RPS game state.
 *
 * @param playerId - The current player's ID ("alice" or "bob")
 * @returns Game state and actions
 */
export function useRpsGame(playerId: string) {
  // Get the document from Repo
  const doc = useDocument("rps-game", GameSchema)

  // Cast to TypedDoc to help TypeScript infer the schema type correctly
  // (Doc<D> extends TypedDoc<D> but inference doesn't always propagate)
  const { lens, doc: worldview } = useLens(doc as TypedDoc<GameDocShape>, {
    filter: createClientLensFilter(playerId),
  })

  useEffect(() => {
    loro(lens.worldview).subscribe(e => {
      console.log("client doc subscribe event", e)
    })
  }, [lens])

  // Get current player state — unwrap PlainValueRef for clean consumer types
  const myPlayer = worldview.game.players[playerId]
  const myChoice = (unwrap(myPlayer?.choice) ?? null) as Choice | null
  const myLocked = unwrap(myPlayer?.locked) ?? false

  // Get opponent state
  const opponentId = playerId === "alice" ? "bob" : "alice"
  const opponent = worldview.game.players[opponentId]
  const opponentLocked = unwrap(opponent?.locked) ?? false

  // Game phase and result
  const phase = unwrap(worldview.game.phase) as Phase
  const result = (unwrap(worldview.game.result) ?? null) as Result | null

  /**
   * Make a choice (rock, paper, or scissors).
   * Uses commitMessage option for identity-based server filtering.
   */
  const makeChoice = (choice: Choice) => {
    if (myLocked || phase !== "choosing") return

    change(
      lens,
      (d: Draft<GameDocShape>) => {
        const player = d.game.players.get(playerId)
        if (player) {
          player.choice = choice
        } else {
          d.game.players.set(playerId, { choice, locked: false })
        }
      },
      { commitMessage: createIdentityMessage(playerId) },
    )
  }

  /**
   * Lock in the current choice.
   * Once locked, the choice cannot be changed.
   */
  const lockIn = () => {
    if (!myChoice || myLocked || phase !== "choosing") return

    change(
      lens,
      (d: Draft<GameDocShape>) => {
        const player = d.game.players.get(playerId)
        if (player) {
          player.locked = true
        }
      },
      { commitMessage: createIdentityMessage(playerId) },
    )
  }

  return {
    // State
    phase,
    result,
    myChoice,
    myLocked,
    opponentId,
    opponentLocked,
    opponentChoice:
      phase === "resolved"
        ? ((unwrap(opponent?.choice) ?? null) as Choice | null)
        : null,
    isReady: !!doc && !!lens,

    // Actions
    makeChoice,
    lockIn,
  }
}
