/**
 * useRpsGame Hook - Client-side game state management
 *
 * This hook manages the client's connection to the game and provides
 * methods for making choices and locking in.
 */

import { loro, type Mutable } from "@loro-extended/change"
import { useHandle, useLens } from "@loro-extended/react"
import { useEffect } from "react"
import { createIdentityMessage } from "../shared/identity.js"
import { type Choice, type GameDocShape, GameSchema } from "../shared/schema.js"
import { createClientLensFilter } from "./filters.js"

/**
 * Hook for managing RPS game state.
 *
 * @param playerId - The current player's ID ("alice" or "bob")
 * @returns Game state and actions
 */
export function useRpsGame(playerId: string) {
  // Get the document handle from Repo
  const handle = useHandle("rps-game", GameSchema)

  const { lens, doc: worldview } = useLens(handle.doc, {
    filter: createClientLensFilter(playerId),
  })

  useEffect(() => {
    loro(lens.worldview).subscribe(e => {
      console.log("client doc subscribe event", e)
    })
  }, [lens])

  // Get current player state (players is a plain object in JSON, not a Map)
  const myPlayer = worldview.game.players[playerId]
  const myChoice = myPlayer?.choice ?? null
  const myLocked = myPlayer?.locked ?? false

  // Get opponent state
  const opponentId = playerId === "alice" ? "bob" : "alice"
  const opponent = worldview.game.players[opponentId]
  const opponentLocked = opponent?.locked ?? false

  // Game phase and result
  const phase = worldview.game.phase
  const result = worldview.game.result

  /**
   * Make a choice (rock, paper, or scissors).
   * Uses commitMessage option for identity-based server filtering.
   */
  const makeChoice = (choice: Choice) => {
    if (myLocked || phase !== "choosing") return

    lens.change(
      (d: Mutable<GameDocShape>): void => {
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

    lens.change(
      (d: Mutable<GameDocShape>): void => {
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
    opponentChoice: phase === "resolved" ? (opponent?.choice ?? null) : null,
    isReady: !!handle && !!lens,

    // Actions
    makeChoice,
    lockIn,
  }
}
