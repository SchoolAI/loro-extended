import {
  useDocument,
  useEphemeral,
  useRepo,
  useValue,
} from "@loro-extended/react"
import { sync } from "@loro-extended/repo"
import { useCallback, useEffect, useMemo, useState } from "react"
import {
  ARENA_DOC_ID,
  ArenaSchema,
  CAR_COLORS,
  type CarColor,
  GameEphemeralDeclarations,
} from "../shared/types"
import { ArenaCanvas } from "./components/arena-canvas"
import { JoinScreen } from "./components/join-screen"
import { PlayerList } from "./components/player-list"
import { Scoreboard } from "./components/scoreboard"
import { useJoystick } from "./hooks/use-joystick"
import { useKeyboardInput } from "./hooks/use-keyboard-input"
import { usePresenceSender } from "./hooks/use-presence-sender"
import {
  combineInputs,
  createClientPresence,
  getActivePlayers,
  partitionPresences,
  sortScores,
  ZERO_INPUT,
} from "./logic"

type BumperCarsAppProps = {
  initialName: string
  initialColor: string | null
}

export default function BumperCarsApp({
  initialName,
  initialColor,
}: BumperCarsAppProps) {
  const repo = useRepo()
  const myPeerId = repo.identity.peerId

  // Player state
  const [hasJoined, setHasJoined] = useState(false)
  const [playerName, setPlayerName] = useState(initialName)
  const [playerColor, setPlayerColor] = useState<CarColor>(
    (initialColor as CarColor) ||
      CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)],
  )

  // Get document with both doc and ephemeral schemas
  const doc = useDocument(ARENA_DOC_ID, ArenaSchema, GameEphemeralDeclarations)

  // Get `scores` as a snapshot read-only value
  const scores = useValue(doc.scores)

  // Get presence data
  const { self, peers } = useEphemeral(sync(doc).presence)

  // Partition presences into server and client (pure function)
  const { serverPresence, clientPresences } = useMemo(
    () => partitionPresences(self, peers, myPeerId),
    [self, peers, myPeerId],
  )

  // Input from joystick and keyboard
  const { input: joystickInput, zoneRef } = useJoystick()
  const keyboardInput = useKeyboardInput()

  // Combine inputs (joystick takes priority if active)
  const currentInput = useMemo(
    () => combineInputs(joystickInput, keyboardInput),
    [joystickInput, keyboardInput],
  )

  // Send throttled presence updates
  usePresenceSender({
    doc,
    hasJoined,
    playerName,
    playerColor,
    input: currentInput,
  })

  // Handle join
  const handleJoin = useCallback(
    (name: string, color: CarColor) => {
      setPlayerName(name)
      setPlayerColor(color)

      // Save to localStorage
      localStorage.setItem("loro-bumper-cars-name", name)
      localStorage.setItem("loro-bumper-cars-color", color)

      // Set initial presence
      sync(doc).presence.setSelf(createClientPresence(name, color, ZERO_INPUT))
      setHasJoined(true)
    },
    [doc],
  )

  // Handle leaving the game (Escape key)
  const handleLeave = useCallback(() => {
    // Clear presence by setting empty name
    sync(doc).presence.setSelf(
      createClientPresence("", playerColor, ZERO_INPUT),
    )
    setHasJoined(false)
  }, [playerColor, doc])

  // Listen for Escape key to leave the game
  useEffect(() => {
    if (!hasJoined) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleLeave()
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [hasJoined, handleLeave])

  // Get scores sorted by bumps (pure function)
  const sortedScores = useMemo(() => sortScores(scores, 5), [scores])

  // Get active players from client presences (pure function)
  const activePlayers = useMemo(
    () => getActivePlayers(clientPresences),
    [clientPresences],
  )

  return (
    <div className="arena-container">
      {/* Scoreboard */}
      <Scoreboard scores={sortedScores} />

      {/* Canvas wrapper */}
      <div className="canvas-wrapper">
        {/* Arena canvas */}
        <ArenaCanvas serverPresence={serverPresence} myPeerId={myPeerId} />

        {/* Player list */}
        <PlayerList players={activePlayers} myPeerId={myPeerId} />

        {/* Joystick zone (only when joined) */}
        {hasJoined && <div ref={zoneRef} className="joystick-zone" />}

        {/* Controls hint */}
        {hasJoined && (
          <div className="controls-hint">
            Drag to move • WASD/Arrows • ESC to leave
          </div>
        )}

        {/* Join screen overlay */}
        {!hasJoined && (
          <JoinScreen
            initialName={playerName}
            initialColor={playerColor}
            onJoin={handleJoin}
            canJoin={true}
          />
        )}
      </div>
    </div>
  )
}
