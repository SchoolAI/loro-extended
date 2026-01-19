import {
  type BunWsData,
  createBunWebSocketHandlers,
} from "@loro-extended/adapter-websocket/bun"
import { WsServerNetworkAdapter } from "@loro-extended/adapter-websocket/server"
import { Askforce } from "@loro-extended/askforce"
import { Repo } from "@loro-extended/repo"
import { type Answer, DocSchema, EphemeralDeclarations } from "./shared/schema"

// ═══════════════════════════════════════════════════════════════════════════
// Mock Database - Simulated "taken" usernames
// ═══════════════════════════════════════════════════════════════════════════

const takenUsernames = new Set([
  "admin",
  "root",
  "user",
  "test",
  "alice",
  "bob",
  "charlie",
  "support",
  "help",
  "info",
  "contact",
  "sales",
  "marketing",
  "hello",
  "world",
])

// ═══════════════════════════════════════════════════════════════════════════
// Username Validation Logic
// ═══════════════════════════════════════════════════════════════════════════

function isValidUsername(username: string): boolean {
  // 3-20 characters, alphanumeric and underscore only
  return /^[a-zA-Z0-9_]{3,20}$/.test(username)
}

function isUsernameTaken(username: string): boolean {
  return takenUsernames.has(username.toLowerCase())
}

function generateSuggestions(base: string): string[] {
  // Clean the base to be valid
  const clean = base.replace(/[^a-zA-Z0-9_]/g, "").slice(0, 16) || "user"

  const suggestions: string[] = []
  const candidates = [
    `${clean}${Math.floor(Math.random() * 1000)}`,
    `${clean}_${Math.floor(Math.random() * 100)}`,
    `the_${clean}`,
    `${clean}x`,
    `${clean}123`,
  ]

  for (const candidate of candidates) {
    if (!isUsernameTaken(candidate) && isValidUsername(candidate)) {
      suggestions.push(candidate)
      if (suggestions.length >= 3) break
    }
  }

  return suggestions
}

// ═══════════════════════════════════════════════════════════════════════════
// Loro Repo Setup
// ═══════════════════════════════════════════════════════════════════════════

const wsAdapter = new WsServerNetworkAdapter()
const repo = new Repo({
  identity: { name: "username-checker-server", type: "service" },
  adapters: [wsAdapter],
})

console.log(`[Server] Repo peerId: ${repo.synchronizer.identity.peerId}`)

// Get handle to the RPC document
const handle = repo.get("username-rpc", DocSchema, EphemeralDeclarations)

// Debug: Subscribe to document changes
handle.subscribe(() => {
  console.log(
    "[Server] Document changed, current state:",
    handle.doc.rpc.keys(),
  )
})

// Debug: Subscribe to LOCAL updates specifically (this is what triggers sync)
handle.loroDoc.subscribeLocalUpdates(() => {
  console.log(
    "[Server] LOCAL update detected - this should trigger sync to peers",
  )
  // Log the current peer subscriptions and sync state
  const model = (repo.synchronizer as any).model
  if (model) {
    console.log("[Server] Current peers:", [...model.peers.keys()])
    for (const [peerId, peerState] of model.peers) {
      const docSyncState = peerState.docSyncStates.get("username-rpc")
      console.log(`[Server] Peer ${peerId}:`, {
        subscriptions: [...peerState.subscriptions],
        channels: [...peerState.channels],
        docSyncState: docSyncState
          ? {
              status: docSyncState.status,
              lastKnownVersion: docSyncState.lastKnownVersion?.toJSON(),
            }
          : undefined,
      })
    }
    // Log our version
    const docState = model.documents.get("username-rpc")
    if (docState) {
      console.log("[Server] Our version:", docState.doc.version().toJSON())
    }
  }
})

// ═══════════════════════════════════════════════════════════════════════════
// Askforce RPC Handler - This replaces your REST endpoint!
// ═══════════════════════════════════════════════════════════════════════════

const askforce = new Askforce(handle.doc.rpc, handle.presence, {
  peerId: handle.peerId, // Use the Repo's peerId for consistency
  mode: "rpc", // Single server answers each request
})

console.log(`[Server] Askforce peerId: ${handle.peerId}`)

// This is the equivalent of an Express route handler:
//   app.post('/api/check-username', (req, res) => { ... })
//
// But instead of HTTP, it uses CRDT sync!
askforce.onAsk(async (askId, question): Promise<Answer> => {
  const { username } = question

  console.log(`📝 [Server] Received ask ${askId}: "${username}"`)

  // Validate format
  if (!isValidUsername(username)) {
    console.log(`   ❌ Invalid format`)
    return {
      available: false,
      reason: "invalid",
      suggestions: generateSuggestions(username),
    }
  }

  // Check if taken
  if (isUsernameTaken(username)) {
    console.log(`   ❌ [Server] Already taken, returning answer...`)
    const answer = {
      available: false,
      reason: "taken",
      suggestions: generateSuggestions(username),
    }
    console.log(`   📤 [Server] Answer:`, answer)
    return answer
  }

  console.log(`   ✅ [Server] Available! Returning answer...`)
  const answer = { available: true, reason: null, suggestions: null }
  console.log(`   📤 [Server] Answer:`, answer)
  return answer
})

// ═══════════════════════════════════════════════════════════════════════════
// Bun Server - Build client and serve
// ═══════════════════════════════════════════════════════════════════════════

// Build the client app using Bun's bundler
const result = await Bun.build({
  entrypoints: ["./public/index.html"],
  outdir: "./dist",
})
if (!result.success) throw new AggregateError(result.logs, "Build failed")

// Start the server
Bun.serve<BunWsData>({
  port: 5173,
  async fetch(req, server) {
    const url = new URL(req.url)

    // WebSocket upgrade for Loro sync
    if (url.pathname === "/ws") {
      if (server.upgrade(req, { data: { handlers: {} } })) return
      return new Response("Upgrade failed", { status: 400 })
    }

    // Serve static files from dist/
    const pathname = url.pathname === "/" ? "/index.html" : url.pathname
    const file = Bun.file(`./dist${pathname}`)
    return (await file.exists())
      ? new Response(file)
      : new Response("Not found", { status: 404 })
  },
  websocket: createBunWebSocketHandlers(wsAdapter),
})

console.log(`
🔍 Username Checker - Askforce RPC Demo
   http://localhost:5173

   This demo shows how Askforce RPC replaces REST APIs.
   No HTTP endpoints - just CRDT sync!
`)
