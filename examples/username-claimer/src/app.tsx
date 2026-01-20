import { WsClientNetworkAdapter } from "@loro-extended/adapter-websocket/client"
import { Askforce } from "@loro-extended/askforce"
import { RepoProvider, useDoc, useHandle } from "@loro-extended/react"
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { createRoot } from "react-dom/client"
import { LIMITS, TIMEOUTS } from "./config"
import {
  type Answer,
  type ClaimedUsername,
  ClaimedUsernamesDocSchema,
  EphemeralDeclarations,
  isValidUsername,
  RpcDocSchema,
} from "./shared/schema"
import {
  type ConnectionState,
  type ConnectionStateResult,
  useConnectionStateWithToggle,
} from "./use-connection-state"
import "./styles.css"

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Discriminated union for claim state - single source of truth
 */
type ClaimState =
  | { status: "idle" }
  | { status: "claiming"; username: string }
  | { status: "success"; username: string; answer: Answer }
  | { status: "error"; username: string; error: string }
  | { status: "invalid"; username: string; message: string }

interface PendingClaim {
  id: string
  username: string
  status: "queued" | "processing" | "completed" | "failed"
  result?: Answer
  error?: string
}

// ═══════════════════════════════════════════════════════════════════════════
// Connection Context (to share state between components)
// ═══════════════════════════════════════════════════════════════════════════

const ConnectionContext = createContext<ConnectionStateResult | null>(null)

function useConnection(): ConnectionStateResult {
  const ctx = useContext(ConnectionContext)
  if (!ctx)
    throw new Error("useConnection must be used within ConnectionProvider")
  return ctx
}

// ═══════════════════════════════════════════════════════════════════════════
// Connection Status Indicator with Toggle
// ═══════════════════════════════════════════════════════════════════════════

function ConnectionIndicator() {
  const {
    effectiveState,
    isSimulatedOffline,
    toggleSimulatedOffline,
    state: realState,
  } = useConnection()

  const config = {
    connected: { icon: "🟢", label: "Connected", className: "connected" },
    connecting: { icon: "🟡", label: "Connecting...", className: "connecting" },
    reconnecting: {
      icon: "🟡",
      label: "Reconnecting...",
      className: "reconnecting",
    },
    disconnected: { icon: "🔴", label: "Offline", className: "disconnected" },
  }[effectiveState]

  return (
    <div className={`connection-indicator ${config.className}`}>
      <span className="connection-icon">{config.icon}</span>
      <span className="connection-label">
        {isSimulatedOffline ? "Simulated Offline" : config.label}
      </span>
      <button
        type="button"
        className={`offline-toggle ${isSimulatedOffline ? "active" : ""}`}
        onClick={toggleSimulatedOffline}
        title={isSimulatedOffline ? "Go back online" : "Simulate offline mode"}
      >
        {isSimulatedOffline ? "🔌 Reconnect" : "✂️ Disconnect"}
      </button>
      {isSimulatedOffline && realState === "connected" && (
        <span className="real-state-hint">(actually connected)</span>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Pending Queue Component (shown when offline)
// ═══════════════════════════════════════════════════════════════════════════

function PendingQueue({
  pendingClaims,
  connectionState,
}: {
  pendingClaims: PendingClaim[]
  connectionState: ConnectionState
}) {
  const queuedClaims = pendingClaims.filter(
    c => c.status === "queued" || c.status === "processing",
  )

  if (queuedClaims.length === 0) {
    return null
  }

  return (
    <div className="pending-queue">
      <h4>📋 Pending Claims</h4>
      <p className="pending-subtitle">
        {connectionState === "connected"
          ? "Processing queued claims..."
          : "Will be processed when back online"}
      </p>
      <div className="pending-list">
        {queuedClaims.map(claim => (
          <div key={claim.id} className={`pending-item ${claim.status}`}>
            <span className="pending-username">{claim.username}</span>
            <span className="pending-status">
              {claim.status === "processing" ? "⏳" : "📋"}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Recently Claimed Usernames List
// ═══════════════════════════════════════════════════════════════════════════

function RecentlyClaimed({
  claimedUsernames,
}: {
  claimedUsernames: ClaimedUsername[]
}) {
  if (claimedUsernames.length === 0) {
    return null
  }

  // Show most recent first, limit to configured amount
  const recent = [...claimedUsernames]
    .reverse()
    .slice(0, LIMITS.RECENT_USERNAMES_DISPLAY)

  return (
    <div className="recently-claimed">
      <h4>🎉 Recently Claimed</h4>
      <p className="claimed-subtitle">
        These usernames sync in real-time via CRDT
      </p>
      <div className="claimed-list">
        {recent.map(item => (
          <span
            key={`${item.username}-${item.claimedAt}`}
            className="claimed-badge"
          >
            {item.username}
          </span>
        ))}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Result Display Component
// ═══════════════════════════════════════════════════════════════════════════

function ResultDisplay({
  claimState,
  onSelectSuggestion,
}: {
  claimState: ClaimState
  onSelectSuggestion: (suggestion: string) => void
}) {
  // Only show results for success, error, or invalid states
  if (claimState.status === "idle") {
    return null
  }

  if (claimState.status === "claiming") {
    return null // Loading state is shown via overlay
  }

  if (claimState.status === "invalid") {
    return (
      <div className="result taken">
        <span className="icon">❌</span>
        <div className="taken-content">
          <span>
            <strong>"{claimState.username}"</strong> {claimState.message}
          </span>
        </div>
      </div>
    )
  }

  if (claimState.status === "error") {
    return <div className="result error">❌ {claimState.error}</div>
  }

  // status === "success"
  const { answer, username } = claimState

  if (answer.claimed) {
    return (
      <div className="result claimed">
        <span className="icon">🎉</span>
        <span>
          <strong>"{username}"</strong> is yours! Successfully claimed.
        </span>
      </div>
    )
  }

  // Not claimed - show reason and suggestions
  return (
    <div className="result taken">
      <span className="icon">❌</span>
      <div className="taken-content">
        <span>
          <strong>"{username}"</strong> is{" "}
          {answer.reason === "invalid"
            ? "invalid (use 3-20 chars, letters/numbers/underscore)"
            : "already taken"}
        </span>
        {answer.suggestions && answer.suggestions.length > 0 && (
          <div className="suggestions">
            <p>Try one of these:</p>
            <div className="suggestion-buttons">
              {answer.suggestions.map(s => (
                <button
                  key={s}
                  type="button"
                  onClick={() => onSelectSuggestion(s)}
                  className="suggestion"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Main App Component
// ═══════════════════════════════════════════════════════════════════════════

// Helper to delay execution
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

function App() {
  // Two separate documents for different purposes:
  // - RPC doc: client-writable (for asking questions)
  // - Claimed doc: server-only (read-only for clients via permissions)
  const rpcHandle = useHandle(
    "username-rpc",
    RpcDocSchema,
    EphemeralDeclarations,
  )
  const claimedHandle = useHandle(
    "claimed-usernames",
    ClaimedUsernamesDocSchema,
  )
  const claimedDoc = useDoc(claimedHandle)
  const { effectiveState: connectionState } = useConnection()

  // Single source of truth for claim state
  const [claimState, setClaimState] = useState<ClaimState>({ status: "idle" })
  const [username, setUsername] = useState("")
  const [pendingClaims, setPendingClaims] = useState<PendingClaim[]>([])

  // Ref for the input element to maintain focus
  const inputRef = useRef<HTMLInputElement>(null)

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Create Askforce instance (memoized to avoid recreating on each render)
  const askforce = useMemo(
    () =>
      new Askforce(rpcHandle.doc.rpc, rpcHandle.presence, {
        peerId: rpcHandle.peerId,
        mode: "rpc",
      }),
    [rpcHandle],
  )

  // Get claimed usernames from the server-only CRDT document with runtime validation
  const claimedUsernames = useMemo(() => {
    const raw = claimedDoc.claimedUsernames
    if (!Array.isArray(raw)) return []
    return raw as ClaimedUsername[]
  }, [claimedDoc.claimedUsernames])

  // ─────────────────────────────────────────────────────────────────────────
  // Process a single claim (used for both immediate and queued claims)
  // ─────────────────────────────────────────────────────────────────────────
  const processClaim = useCallback(
    async (
      _claimId: string,
      usernameToProcess: string,
    ): Promise<{ answer?: Answer; error?: string }> => {
      try {
        // Wait for network sync before asking (ensures server is connected)
        await rpcHandle.waitForSync({ timeout: TIMEOUTS.SYNC })

        // Instead of: fetch('/api/claim-username', { body: { username } })
        // We use Askforce RPC:
        const askId = askforce.ask({ username: usernameToProcess })
        const answer = await askforce.waitFor(askId, TIMEOUTS.RPC_RESPONSE)

        return { answer }
      } catch (err) {
        return { error: err instanceof Error ? err.message : "Claim failed" }
      }
    },
    [rpcHandle, askforce],
  )

  // ─────────────────────────────────────────────────────────────────────────
  // Process queued claims when connection is restored (with delay between each)
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (connectionState !== "connected") return

    let cancelled = false

    const processQueue = async () => {
      // Use functional update pattern to get current state and extract queued claims
      let queuedClaims: PendingClaim[] = []

      setPendingClaims(prev => {
        queuedClaims = prev.filter(c => c.status === "queued")
        return prev // Don't modify state, just read it
      })

      if (queuedClaims.length === 0) return

      for (let i = 0; i < queuedClaims.length; i++) {
        if (cancelled) return

        const claim = queuedClaims[i]

        // Mark as processing
        setPendingClaims(prev =>
          prev.map(c =>
            c.id === claim.id ? { ...c, status: "processing" as const } : c,
          ),
        )

        const { answer, error } = await processClaim(claim.id, claim.username)

        if (cancelled) return

        // Update with result
        setPendingClaims(prev =>
          prev.map(c =>
            c.id === claim.id
              ? {
                  ...c,
                  status: answer ? ("completed" as const) : ("failed" as const),
                  result: answer,
                  error,
                }
              : c,
          ),
        )

        // Show the result for this claim
        if (answer) {
          setClaimState({
            status: "success",
            username: claim.username,
            answer,
          })
        } else if (error) {
          setClaimState({
            status: "error",
            username: claim.username,
            error,
          })
        }

        // Add delay AFTER showing each result so user can see it
        // before the next claim starts processing
        if (i < queuedClaims.length - 1) {
          await delay(TIMEOUTS.QUEUE_RESULT_DISPLAY)
        }
      }

      // Clean up completed/failed claims after a delay
      setTimeout(() => {
        setPendingClaims(prev =>
          prev.filter(c => c.status === "queued" || c.status === "processing"),
        )
      }, TIMEOUTS.CLEANUP_DELAY)
    }

    processQueue()

    return () => {
      cancelled = true
    }
  }, [connectionState, processClaim])

  // ─────────────────────────────────────────────────────────────────────────
  // This is the RPC call - replaces fetch()!
  // ─────────────────────────────────────────────────────────────────────────
  const claimUsername = async () => {
    if (!username.trim()) return

    const trimmedUsername = username.trim()
    const claimId = `claim-${Date.now()}-${Math.random().toString(36).slice(2)}`

    // Client-side validation for immediate feedback (no network round-trip)
    if (!isValidUsername(trimmedUsername)) {
      setClaimState({
        status: "invalid",
        username: trimmedUsername,
        message: "is invalid (use 3-20 chars, letters/numbers/underscore)",
      })
      // Refocus input after validation error
      inputRef.current?.focus()
      return
    }

    // If offline, queue the claim
    if (connectionState !== "connected") {
      setPendingClaims(prev => [
        ...prev,
        {
          id: claimId,
          username: trimmedUsername,
          status: "queued",
        },
      ])
      setUsername("")
      setClaimState({ status: "idle" })
      // Refocus input after queuing
      inputRef.current?.focus()
      return
    }

    setClaimState({ status: "claiming", username: trimmedUsername })

    const { answer, error: claimError } = await processClaim(
      claimId,
      trimmedUsername,
    )

    if (answer) {
      setClaimState({
        status: "success",
        username: trimmedUsername,
        answer,
      })

      // Clear input on successful claim
      if (answer.claimed) {
        setUsername("")
      }
    } else if (claimError) {
      setClaimState({
        status: "error",
        username: trimmedUsername,
        error: claimError,
      })
    }

    // Refocus the input after claiming - use setTimeout to ensure
    // React has re-rendered and the input is no longer disabled
    setTimeout(() => {
      inputRef.current?.focus()
    }, 0)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    claimUsername()
  }

  const selectSuggestion = (suggestion: string) => {
    setUsername(suggestion)
    setClaimState({ status: "idle" })
    // Refocus input after selecting suggestion
    inputRef.current?.focus()
  }

  const isClaiming = claimState.status === "claiming"

  return (
    <div className="container">
      <ConnectionIndicator />
      <header>
        <h1>🎯 Username Claimer</h1>
        <p className="subtitle">
          Powered by{" "}
          <a
            href="https://github.com/SchoolAI/loro-extended/tree/main/examples/username-claimer"
            target="_blank"
            rel="noopener noreferrer"
            className="askforce-link"
          >
            Askforce RPC
          </a>{" "}
          — no REST API!
        </p>
      </header>

      <form onSubmit={handleSubmit}>
        <div className="input-group">
          <input
            ref={inputRef}
            type="text"
            value={username}
            onChange={e => setUsername(e.target.value)}
            placeholder="Enter a username to claim..."
            disabled={isClaiming}
          />
          <button type="submit" disabled={isClaiming || !username.trim()}>
            {isClaiming ? "Claiming..." : "Claim"}
          </button>
        </div>
      </form>

      <ResultDisplay
        claimState={claimState}
        onSelectSuggestion={selectSuggestion}
      />

      <PendingQueue
        pendingClaims={pendingClaims}
        connectionState={connectionState}
      />
      <RecentlyClaimed claimedUsernames={claimedUsernames} />

      <footer>
        <h3>How it works</h3>
        <div className="comparison">
          <div className="code-block">
            <h4>❌ Traditional REST</h4>
            <pre>{`const res = await fetch('/api/claim', {
  method: 'POST',
  body: JSON.stringify({ username })
})
const data = await res.json()`}</pre>
          </div>
          <div className="code-block">
            <h4>✅ Askforce RPC</h4>
            <pre>{`const askId = askforce.ask({ username })
const answer = await askforce.waitFor(askId)`}</pre>
          </div>
        </div>
        <p className="benefits">
          <strong>Benefits:</strong> Type-safe • Offline-capable • No HTTP
          boilerplate • CRDT-synced
        </p>
      </footer>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Bootstrap - Connect to WebSocket and render
// ═══════════════════════════════════════════════════════════════════════════

const wsAdapter = new WsClientNetworkAdapter({
  url: `ws://${location.host}/ws`,
})

function AppWithConnection() {
  const connectionResult = useConnectionStateWithToggle()

  return (
    <ConnectionContext.Provider value={connectionResult}>
      <App />
    </ConnectionContext.Provider>
  )
}

const root = document.getElementById("root")
if (root) {
  createRoot(root).render(
    <RepoProvider config={{ adapters: [wsAdapter] }}>
      <AppWithConnection />
    </RepoProvider>,
  )
}
