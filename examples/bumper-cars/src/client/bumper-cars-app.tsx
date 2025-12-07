import { useDocument, usePresence, useRepo } from "@loro-extended/react"
import type { PeerID } from "@loro-extended/repo"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  ARENA_DOC_ID,
  ArenaSchema,
  CAR_COLORS,
  type CarColor,
  type ClientPresence,
  EmptyClientPresence,
  GamePresenceSchema,
  type PlayerScore,
  type ServerPresence,
} from "../shared/types"
import { ArenaCanvas } from "./components/arena-canvas"
import { JoinScreen } from "./components/join-screen"
import { PlayerList } from "./components/player-list"
import { Scoreboard } from "./components/scoreboard"
import { useJoystick } from "./hooks/use-joystick"
import { useKeyboardInput } from "./hooks/use-keyboard-input"

// Throttle interval for presence updates (ms)
const PRESENCE_UPDATE_INTERVAL = 50 // 20 updates per second

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

  // Use arena document for persistent scores
  const [doc, _changeDoc, handle] = useDocument(ARENA_DOC_ID, ArenaSchema)

  // Use typed presence with discriminated union schema
  // This provides type-safe access to both client and server presence
  const { all: allPresence, setSelf: setPresence } = usePresence(
    ARENA_DOC_ID,
    GamePresenceSchema,
    EmptyClientPresence, // Default to client presence for self
  )

  // Get server presence (game state) - type-safe filtering
  const serverPresence = useMemo(() => {
    for (const presence of Object.values(allPresence)) {
      if (presence.type === "server") {
        return presence as ServerPresence
      }
    }
    return null
  }, [allPresence])

  // Get client presences (other players) - type-safe filtering
  const clientPresences = useMemo(() => {
    const clients: Record<PeerID, ClientPresence> = {}
    for (const [peerId, presence] of Object.entries(allPresence)) {
      if (presence.type === "client") {
        clients[peerId as PeerID] = presence as ClientPresence
      }
    }
    return clients
  }, [allPresence])

  // Input from joystick
  const { input: joystickInput, zoneRef } = useJoystick()

  // Input from keyboard (WASD/arrows)
  const keyboardInput = useKeyboardInput()

  // Track last sent input to avoid unnecessary updates
  const lastSentInputRef = useRef({ force: 0, angle: 0 })
  const lastUpdateTimeRef = useRef(0)

  // Combine inputs (joystick takes priority if active)
  const currentInput = useMemo(() => {
    if (joystickInput.force > 0) {
      return joystickInput
    }
    return keyboardInput
  }, [joystickInput, keyboardInput])

  // Update presence with current input (throttled, but always send zero-force immediately)
  useEffect(() => {
    if (!hasJoined) return

    const now = Date.now()
    const lastInput = lastSentInputRef.current

    // Check if input actually changed
    const inputChanged =
      lastInput.force !== currentInput.force ||
      lastInput.angle !== currentInput.angle

    if (!inputChanged) {
      return
    }

    // Always send zero-force updates immediately (joystick released)
    // Otherwise throttle updates
    const isStopInput = currentInput.force === 0
    const timeSinceLastUpdate = now - lastUpdateTimeRef.current
    if (!isStopInput && timeSinceLastUpdate < PRESENCE_UPDATE_INTERVAL) {
      return
    }

    // Update refs
    lastSentInputRef.current = { ...currentInput }
    lastUpdateTimeRef.current = now

    const presence: ClientPresence = {
      type: "client",
      name: playerName,
      color: playerColor,
      input: currentInput,
    }

    setPresence(presence)
  }, [hasJoined, playerName, playerColor, currentInput, setPresence])

  // Handle join
  const handleJoin = useCallback(
    (name: string, color: CarColor) => {
      setPlayerName(name)
      setPlayerColor(color)

      // Save to localStorage
      localStorage.setItem("loro-bumper-cars-name", name)
      localStorage.setItem("loro-bumper-cars-color", color)

      // Set initial presence
      const presence: ClientPresence = {
        type: "client",
        name,
        color,
        input: { force: 0, angle: 0 },
      }
      setPresence(presence)

      setHasJoined(true)
    },
    [setPresence],
  )

  // Handle leaving the game (Escape key)
  const handleLeave = useCallback(() => {
    // Clear presence by setting empty input
    const presence: ClientPresence = {
      type: "client",
      name: "",
      color: playerColor,
      input: { force: 0, angle: 0 },
    }
    setPresence(presence)
    setHasJoined(false)
  }, [playerColor, setPresence])

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

  // Get scores sorted by bumps
  const sortedScores = useMemo(() => {
    // Type assertion needed because record of maps doesn't infer nested types well
    const scores = doc.scores as Record<string, PlayerScore>
    return Object.entries(scores)
      .map(([peerId, score]) => ({
        peerId: peerId as PeerID,
        name: score.name,
        color: score.color,
        bumps: score.bumps,
      }))
      .sort((a, b) => b.bumps - a.bumps)
      .slice(0, 5)
  }, [doc.scores])

  // Get active players from client presences
  const activePlayers = useMemo(() => {
    return Object.entries(clientPresences).map(([peerId, presence]) => ({
      peerId: peerId as PeerID,
      name: presence.name,
      color: presence.color,
    }))
  }, [clientPresences])

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
            canJoin={!!handle}
          />
        )}
      </div>
    </div>
  )
}
