/**
 * RPS Demo Client App
 *
 * This is the main React component for the Rock-Paper-Scissors demo.
 * It demonstrates LEA lens + reactor architecture from the client side.
 */

import { createWsClient } from "@loro-extended/adapter-websocket/client"
import { RepoProvider } from "@loro-extended/react"
import { StrictMode, useState } from "react"
import { createRoot } from "react-dom/client"
import type { Choice, Result } from "../shared/schema.js"
import "./styles.css"
import { useRpsGame } from "./use-rps-game.js"

// ═══════════════════════════════════════════════════════════════════════════
// Helper Functions
// ═══════════════════════════════════════════════════════════════════════════

/** Get player ID from URL query parameter */
function getPlayerIdFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search)
  return params.get("player")
}

/** Get emoji for a choice */
function getChoiceEmoji(choice: Choice | null): string {
  switch (choice) {
    case "rock":
      return "🪨"
    case "paper":
      return "📄"
    case "scissors":
      return "✂️"
    default:
      return "❓"
  }
}

/** Get result message */
function getResultMessage(
  result: Result | null,
  playerId: string,
): { text: string; className: string } {
  if (!result) return { text: "", className: "" }

  if (result === "draw") {
    return { text: "It's a draw!", className: "draw" }
  }

  if (result === playerId) {
    return { text: "You win! 🎉", className: "" }
  }

  return { text: "You lose 😢", className: "lost" }
}

// ═══════════════════════════════════════════════════════════════════════════
// Components
// ═══════════════════════════════════════════════════════════════════════════

/** Choice button component */
function ChoiceButton({
  choice,
  selected,
  disabled,
  onClick,
}: {
  choice: Choice
  selected: boolean
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={`choice-btn ${selected ? "selected" : ""}`}
      disabled={disabled}
      onClick={onClick}
      title={choice}
    >
      {getChoiceEmoji(choice)}
    </button>
  )
}

/** Player card component */
function PlayerCard({
  name,
  choice,
  locked,
  isCurrent,
  showChoice,
}: {
  name: string
  choice: Choice | null
  locked: boolean
  isCurrent: boolean
  showChoice: boolean
}) {
  return (
    <div className={`player-card ${isCurrent ? "current" : ""}`}>
      <h3>{name}</h3>
      <div className={`player-status ${locked ? "locked" : ""}`}>
        {locked ? "Locked in ✓" : "Choosing..."}
      </div>
      <div className="player-choice">
        {showChoice ? getChoiceEmoji(choice) : locked ? "🔒" : "🤔"}
      </div>
    </div>
  )
}

/** Main game component */
function Game({ playerId }: { playerId: string }) {
  const {
    phase,
    result,
    myChoice,
    myLocked,
    opponentLocked,
    opponentChoice,
    isReady,
    makeChoice,
    lockIn,
  } = useRpsGame(playerId)

  if (!isReady) {
    return (
      <div className="loading">
        <div className="loading-spinner" />
        <p>Connecting to game...</p>
      </div>
    )
  }

  const resultInfo = getResultMessage(result, playerId)
  const canMakeChoice = phase === "choosing" && !myLocked
  const canLockIn = phase === "choosing" && myChoice && !myLocked
  const showOpponentChoice = phase === "resolved"

  return (
    <>
      {/* Game Status */}
      <div className="game-status">
        <div className="phase">
          Phase: <span className="phase-value">{phase}</span>
        </div>
        {result && (
          <div className={`result ${resultInfo.className}`}>
            {resultInfo.text}
          </div>
        )}
      </div>

      {/* Players Status */}
      <div className="players-status">
        <PlayerCard
          name={playerId === "alice" ? "You (Alice)" : "Alice"}
          choice={playerId === "alice" ? myChoice : opponentChoice}
          locked={playerId === "alice" ? myLocked : opponentLocked}
          isCurrent={playerId === "alice"}
          showChoice={playerId === "alice" || showOpponentChoice}
        />
        <PlayerCard
          name={playerId === "bob" ? "You (Bob)" : "Bob"}
          choice={playerId === "bob" ? myChoice : opponentChoice}
          locked={playerId === "bob" ? myLocked : opponentLocked}
          isCurrent={playerId === "bob"}
          showChoice={playerId === "bob" || showOpponentChoice}
        />
      </div>

      {/* Choice Buttons */}
      {phase === "choosing" && (
        <>
          <div className="choices">
            {(["rock", "paper", "scissors"] as const).map(choice => (
              <ChoiceButton
                key={choice}
                choice={choice}
                selected={myChoice === choice}
                disabled={!canMakeChoice}
                onClick={() => makeChoice(choice)}
              />
            ))}
          </div>

          <button
            type="button"
            className="lock-btn"
            disabled={!canLockIn}
            onClick={lockIn}
          >
            {myLocked ? "Locked In ✓" : "Lock In"}
          </button>
        </>
      )}

      {/* Reset Button */}
    </>
  )
}

/** Player selection component */
function PlayerSelection({
  onSelect,
}: {
  onSelect: (playerId: string) => void
}) {
  return (
    <>
      <h2>Choose Your Player</h2>
      <div className="choices" style={{ marginTop: "30px" }}>
        <button
          type="button"
          className="choice-btn"
          onClick={() => onSelect("alice")}
          style={{ fontSize: "1.5rem", padding: "30px" }}
        >
          👩 Alice
        </button>
        <button
          type="button"
          className="choice-btn"
          onClick={() => onSelect("bob")}
          style={{ fontSize: "1.5rem", padding: "30px" }}
        >
          👨 Bob
        </button>
      </div>
    </>
  )
}

// Create WebSocket adapter config outside component to avoid recreation
const wsAdapter = createWsClient({
  url: `ws://${window.location.host}/ws`,
})

const repoConfig = {
  adapters: [wsAdapter],
}

/** Main App component */
function App() {
  // Get player ID from URL or state
  const [selectedPlayer, setSelectedPlayer] = useState<string | null>(
    getPlayerIdFromUrl,
  )

  const handleSelectPlayer = (playerId: string) => {
    // Update URL with player parameter
    const url = new URL(window.location.href)
    url.searchParams.set("player", playerId)
    window.history.pushState({}, "", url.toString())
    setSelectedPlayer(playerId)
  }

  return (
    <div className="container">
      <h1>🪨 📄 ✂️</h1>
      <h1>Rock Paper Scissors</h1>

      {selectedPlayer ? (
        <>
          <p className="player-info">
            Playing as: <span className="player-name">{selectedPlayer}</span>
          </p>
          <Game playerId={selectedPlayer} />
        </>
      ) : (
        <PlayerSelection onSelect={handleSelectPlayer} />
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Mount App
// ═══════════════════════════════════════════════════════════════════════════

const root = document.getElementById("root")
if (root) {
  createRoot(root).render(
    <RepoProvider config={repoConfig}>
      <StrictMode>
        <App />
      </StrictMode>
    </RepoProvider>,
  )
}
