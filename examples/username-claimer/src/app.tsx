import { WsClientNetworkAdapter } from "@loro-extended/adapter-websocket/client"
import { Asks } from "@loro-extended/asks"
import { RepoProvider, useDoc, useHandle } from "@loro-extended/react"
import { useMemo, useState } from "react"
import { createRoot } from "react-dom/client"
import {
  type Answer,
  type ClaimedUsername,
  ClaimedUsernamesDocSchema,
  EphemeralDeclarations,
  RpcDocSchema,
} from "./shared/schema"
import "./styles.css"

// ═══════════════════════════════════════════════════════════════════════════
// Simple Result State
// ═══════════════════════════════════════════════════════════════════════════

type Result =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; answer: Answer; username: string }
  | { status: "error"; message: string }

// ═══════════════════════════════════════════════════════════════════════════
// Main App Component
// ═══════════════════════════════════════════════════════════════════════════

function App() {
  // Two documents: RPC for questions, claimed for synced results
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

  const [username, setUsername] = useState("")
  const [result, setResult] = useState<Result>({ status: "idle" })

  // Create Asks instance for RPC
  const asks = useMemo(
    () =>
      new Asks(rpcHandle.doc.rpc, rpcHandle.presence, {
        peerId: rpcHandle.peerId,
        mode: "rpc",
      }),
    [rpcHandle],
  )

  const handleClaim = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!username.trim()) return

    const trimmed = username.trim()
    setResult({ status: "loading" })

    try {
      // ════════════════════════════════════════════════════════════════════
      // ✨ THIS IS THE ENTIRE RPC - replaces fetch('/api/claim', { body })!
      // ════════════════════════════════════════════════════════════════════
      const askId = asks.ask({ username: trimmed })
      const answer = await asks.waitFor(askId, 10_000)
      // ════════════════════════════════════════════════════════════════════

      setResult({ status: "done", answer, username: trimmed })
      if (answer.claimed) setUsername("")
    } catch (err) {
      console.log({ err })
      setResult({
        status: "error",
        message: "message" in err ? err.message : "Request failed",
      })
    }
  }

  // Get claimed usernames from CRDT (synced in real-time)
  const claimedUsernames = (claimedDoc.claimedUsernames ??
    []) as ClaimedUsername[]
  const recentClaimed = [...claimedUsernames].reverse().slice(0, 10)

  return (
    <div className="container">
      <header>
        <h1>🎯 Username Claimer</h1>
        <p className="subtitle">
          Powered by{" "}
          <a
            href="https://github.com/SchoolAI/loro-extended/tree/main/packages/asks"
            target="_blank"
            rel="noopener noreferrer"
          >
            Asks RPC
          </a>{" "}
          — no REST API needed!
        </p>
      </header>

      <form onSubmit={handleClaim}>
        <div className="input-group">
          <input
            type="text"
            value={username}
            onChange={e => setUsername(e.target.value)}
            placeholder="Enter a username to claim..."
            disabled={result.status === "loading"}
            autoComplete="off"
          />
          <button
            type="submit"
            disabled={result.status === "loading" || !username.trim()}
          >
            {result.status === "loading" ? "Claiming..." : "Claim"}
          </button>
        </div>
      </form>

      {/* Result feedback */}
      <div className="feedback-zone" aria-live="polite">
        {result.status === "idle" && (
          <p className="hint">Enter a username above to check availability</p>
        )}
        {result.status === "loading" && (
          <p className="loading">⏳ Checking...</p>
        )}
        {result.status === "error" && (
          <p className="result error">❌ {result.message}</p>
        )}
        {result.status === "done" && (
          <p
            className={`result ${result.answer.claimed ? "claimed" : "taken"}`}
          >
            {result.answer.claimed
              ? `🎉 "${result.username}" is yours!`
              : `❌ "${result.username}" is ${result.answer.reason === "invalid" ? "invalid (use 3-20 chars, letters/numbers/underscore)" : "already taken"}`}
          </p>
        )}
      </div>

      {/* Claimed usernames (CRDT-synced) */}
      <section className="claimed-section">
        <h3>🎉 Recently Claimed ({claimedUsernames.length})</h3>
        {recentClaimed.length === 0 ? (
          <p className="hint">No usernames claimed yet. Be the first!</p>
        ) : (
          <div className="claimed-list">
            {recentClaimed.map(item => (
              <span
                key={`${item.username}-${item.claimedAt}`}
                className="claimed-badge"
              >
                {item.username}
              </span>
            ))}
          </div>
        )}
      </section>

      <footer>
        <details className="how-it-works">
          <summary>How it works</summary>
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
              <h4>✅ Asks RPC</h4>
              <pre>{`const askId = asks.ask({ username })
const answer = await asks.waitFor(askId)`}</pre>
            </div>
          </div>
          <p className="benefits">
            <strong>Benefits:</strong> Type-safe • Real-time sync • No HTTP
            boilerplate • CRDT-backed
          </p>
        </details>
      </footer>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Bootstrap
// ═══════════════════════════════════════════════════════════════════════════

const wsAdapter = new WsClientNetworkAdapter({
  url: `ws://${location.host}/ws`,
})

const root = document.getElementById("root")
if (root) {
  createRoot(root).render(
    <RepoProvider config={{ adapters: [wsAdapter] }}>
      <App />
    </RepoProvider>,
  )
}
