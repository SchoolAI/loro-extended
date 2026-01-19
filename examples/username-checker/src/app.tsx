import { WsClientNetworkAdapter } from "@loro-extended/adapter-websocket/client"
import { Askforce } from "@loro-extended/askforce"
import { RepoProvider, useHandle } from "@loro-extended/react"
import { useMemo, useState } from "react"
import { createRoot } from "react-dom/client"
import { type Answer, DocSchema, EphemeralDeclarations } from "./shared/schema"
import "./styles.css"

// ═══════════════════════════════════════════════════════════════════════════
// Main App Component
// ═══════════════════════════════════════════════════════════════════════════

function App() {
  const handle = useHandle("username-rpc", DocSchema, EphemeralDeclarations)

  const [username, setUsername] = useState("")
  const [checking, setChecking] = useState(false)
  const [result, setResult] = useState<Answer | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Create Askforce instance (memoized to avoid recreating on each render)
  const askforce = useMemo(
    () =>
      new Askforce(handle.doc.rpc, handle.presence, {
        peerId: handle.peerId,
        mode: "rpc",
      }),
    [handle],
  )

  // ─────────────────────────────────────────────────────────────────────────
  // This is the RPC call - replaces fetch()!
  // ─────────────────────────────────────────────────────────────────────────
  const checkUsername = async () => {
    if (!username.trim()) return

    setChecking(true)
    setError(null)
    setResult(null)

    let currentAskId: string | null = null

    try {
      // Wait for network sync before asking (ensures server is connected)
      console.log("[Client] Waiting for sync...")
      await handle.waitForSync({ timeout: 5000 })
      console.log("[Client] Sync complete, asking question...")

      // Debug: Subscribe to document changes
      const unsub = handle.subscribe(() => {
        console.log("[Client] Document changed! Keys:", handle.doc.rpc.keys())
        if (currentAskId) {
          const entry = handle.doc.rpc.get(currentAskId)
          if (entry) {
            console.log("[Client] Entry answers:", entry.answers.toJSON())
          }
        }
      })

      // Instead of: fetch('/api/check-username', { body: { username } })
      // We use Askforce RPC:
      currentAskId = askforce.ask({ username: username.trim() })
      console.log("[Client] Asked:", currentAskId)

      const answer = await askforce.waitFor(currentAskId, 10000)
      console.log("[Client] Got answer:", answer)
      unsub()
      setResult(answer)
    } catch (err) {
      console.error("[Client] Error:", err)
      setError(err instanceof Error ? err.message : "Check failed")
    } finally {
      setChecking(false)
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    checkUsername()
  }

  const selectSuggestion = (suggestion: string) => {
    setUsername(suggestion)
    setResult(null)
  }

  return (
    <div className="container">
      <header>
        <h1>🔍 Username Checker</h1>
        <p className="subtitle">
          Powered by <strong>Askforce RPC</strong> — no REST API!
        </p>
      </header>

      <form onSubmit={handleSubmit}>
        <div className="input-group">
          <input
            type="text"
            value={username}
            onChange={e => setUsername(e.target.value)}
            placeholder="Enter a username..."
            disabled={checking}
          />
          <button type="submit" disabled={checking || !username.trim()}>
            {checking ? "Checking..." : "Check"}
          </button>
        </div>
      </form>

      {error && <div className="result error">❌ {error}</div>}

      {result && (
        <div className={`result ${result.available ? "available" : "taken"}`}>
          {result.available ? (
            <>
              <span className="icon">✅</span>
              <span>
                <strong>"{username}"</strong> is available!
              </span>
            </>
          ) : (
            <>
              <span className="icon">❌</span>
              <div className="taken-content">
                <span>
                  <strong>"{username}"</strong> is{" "}
                  {result.reason === "invalid"
                    ? "invalid (use 3-20 chars, letters/numbers/underscore)"
                    : "already taken"}
                </span>
                {result.suggestions && result.suggestions.length > 0 && (
                  <div className="suggestions">
                    <p>Try one of these:</p>
                    <div className="suggestion-buttons">
                      {result.suggestions.map(s => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => selectSuggestion(s)}
                          className="suggestion"
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      <footer>
        <h3>How it works</h3>
        <div className="comparison">
          <div className="code-block">
            <h4>❌ Traditional REST</h4>
            <pre>{`const res = await fetch('/api/check', {
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

const root = document.getElementById("root")
if (root) {
  createRoot(root).render(
    <RepoProvider config={{ adapters: [wsAdapter] }}>
      <App />
    </RepoProvider>,
  )
}
