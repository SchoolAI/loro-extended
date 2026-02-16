import { sync } from "@loro-extended/repo"
import { useEffect, useRef } from "react"
import type { InputState } from "../../shared/types"
import {
  createClientPresence,
  shouldSendPresenceUpdate,
  ZERO_INPUT,
} from "../logic"

/** Throttle interval for presence updates (ms) - 20 updates per second */
const PRESENCE_UPDATE_INTERVAL = 50

type UsePresenceSenderOptions = {
  /** The document to send presence updates to */
  doc: Parameters<typeof sync>[0]
  /** Whether the player has joined the game */
  hasJoined: boolean
  /** Player's display name */
  playerName: string
  /** Player's car color */
  playerColor: string
  /** Current input state (combined from joystick/keyboard) */
  input: InputState
}

/**
 * Hook that handles throttled presence updates.
 * Encapsulates the refs and effect logic for sending presence to the server.
 *
 * - Sends immediately when player stops (force = 0) for responsive joystick release
 * - Throttles other updates to PRESENCE_UPDATE_INTERVAL
 * - Only sends when input actually changes
 */
export function usePresenceSender({
  doc,
  hasJoined,
  playerName,
  playerColor,
  input,
}: UsePresenceSenderOptions): void {
  // Track last sent input to avoid unnecessary updates
  const lastSentInputRef = useRef<InputState>(ZERO_INPUT)
  const lastUpdateTimeRef = useRef(0)

  useEffect(() => {
    if (!hasJoined) return

    const now = Date.now()

    if (
      !shouldSendPresenceUpdate(
        input,
        lastSentInputRef.current,
        lastUpdateTimeRef.current,
        now,
        PRESENCE_UPDATE_INTERVAL,
      )
    ) {
      return
    }

    // Update refs
    lastSentInputRef.current = { ...input }
    lastUpdateTimeRef.current = now

    // Send presence update
    const presence = createClientPresence(playerName, playerColor, input)
    sync(doc).presence.setSelf(presence)
  }, [hasJoined, playerName, playerColor, input, doc])
}
