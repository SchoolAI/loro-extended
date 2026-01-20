import {
  type BunWsData,
  createBunWebSocketHandlers,
} from "@loro-extended/adapter-websocket/bun"
import { WsServerNetworkAdapter } from "@loro-extended/adapter-websocket/server"
import { Askforce } from "@loro-extended/askforce"
import { Repo } from "@loro-extended/repo"
import { LIMITS } from "./config"
import {
  type Answer,
  ClaimedUsernamesDocSchema,
  EphemeralDeclarations,
  isValidUsername,
  RpcDocSchema,
} from "./shared/schema"

// ═══════════════════════════════════════════════════════════════════════════
// Mock Database - Reserved usernames (cannot be claimed)
// ═══════════════════════════════════════════════════════════════════════════

const reservedUsernames = new Set([
  "admin",
  "root",
  "user",
  "test",
  "support",
  "help",
  "info",
  "contact",
  "sales",
  "marketing",
])

// Usernames that have been claimed during this session
// In a real app, this would be a database
const claimedUsernames = new Set<string>()

// ═══════════════════════════════════════════════════════════════════════════
// Username Availability Logic
// ═══════════════════════════════════════════════════════════════════════════

function isUsernameReserved(username: string): boolean {
  return reservedUsernames.has(username.toLowerCase())
}

function isUsernameClaimed(username: string): boolean {
  return claimedUsernames.has(username.toLowerCase())
}

function isUsernameTaken(username: string): boolean {
  return isUsernameReserved(username) || isUsernameClaimed(username)
}

function claimUsername(username: string): boolean {
  const lower = username.toLowerCase()
  if (isUsernameTaken(lower)) {
    return false
  }
  claimedUsernames.add(lower)
  return true
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
      if (suggestions.length >= LIMITS.SUGGESTIONS_COUNT) break
    }
  }

  return suggestions
}

// ═══════════════════════════════════════════════════════════════════════════
// Loro Repo Setup - Two documents with permissions
// ═══════════════════════════════════════════════════════════════════════════

const wsAdapter = new WsServerNetworkAdapter()
const repo = new Repo({
  identity: { name: "username-claimer-server", type: "service" },
  adapters: [wsAdapter],
  permissions: {
    // Claimed usernames document is server-only (read-only for network clients)
    mutability: (doc, peer) => {
      if (doc.id === "claimed-usernames") {
        // Only accept writes from storage adapters, not network clients
        return peer.channelKind === "storage"
      }
      // RPC document is client-writable
      return true
    },
  },
})

// RPC document - clients can write (for asking questions)
const rpcHandle = repo.get("username-rpc", RpcDocSchema, EphemeralDeclarations)

// Claimed usernames document - server-only writes (via permissions above)
const claimedHandle = repo.get(
  "claimed-usernames",
  ClaimedUsernamesDocSchema,
  {},
)

// ═══════════════════════════════════════════════════════════════════════════
// Askforce RPC Handler - This replaces your REST endpoint!
// ═══════════════════════════════════════════════════════════════════════════

const askforce = new Askforce(rpcHandle.doc.rpc, rpcHandle.presence, {
  peerId: rpcHandle.peerId, // Use the Repo's peerId for consistency
  mode: "rpc", // Single server answers each request
})

// This is the equivalent of an Express route handler:
//   app.post('/api/claim-username', (req, res) => { ... })
//
// But instead of HTTP, it uses CRDT sync!
askforce.onAsk(async (_askId, question): Promise<Answer> => {
  const { username } = question

  // Validate format
  if (!isValidUsername(username)) {
    return {
      claimed: false,
      reason: "invalid",
      suggestions: generateSuggestions(username),
    }
  }

  // Check if already taken (reserved or claimed)
  if (isUsernameTaken(username)) {
    return {
      claimed: false,
      reason: "taken",
      suggestions: generateSuggestions(username),
    }
  }

  // Attempt to claim the username
  const success = claimUsername(username)

  if (success) {
    // Add to the CRDT claimed list for sync across clients
    // This writes to the server-only document (clients can't write to it)
    claimedHandle.change(doc => {
      doc.claimedUsernames.push({
        username: username.trim(),
        claimedAt: Date.now(),
      })
    })

    return {
      claimed: true,
      reason: null,
      suggestions: null,
    }
  }

  // Race condition - someone else claimed it between check and claim
  return {
    claimed: false,
    reason: "taken",
    suggestions: generateSuggestions(username),
  }
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
const port = Number(process.env.PORT) || 5173
Bun.serve<BunWsData>({
  port,
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
🔍 Username Claimer - Askforce RPC Demo
   http://localhost:${port}

   This demo shows how Askforce RPC replaces REST APIs.
   No HTTP endpoints - just CRDT sync!
   
   Reserved usernames: ${[...reservedUsernames].join(", ")}
`)
