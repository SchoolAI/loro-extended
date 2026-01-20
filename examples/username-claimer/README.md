# Username Claimer - Askforce RPC Demo

This example demonstrates how **Askforce RPC** replaces traditional REST APIs for a common web pattern: claiming usernames during signup. It showcases real-time CRDT sync, offline capability, and connection state management.

## Quick Start

```bash
# From the monorepo root
pnpm install
cd examples/username-claimer
bun run src/server.ts
```

Then open http://localhost:5173

## Features

- 🎯 **Claim usernames** - Not just check, but actually claim and persist
- 🔄 **Real-time sync** - See claimed usernames appear across all connected clients
- 📡 **Connection indicator** - Visual feedback for online/offline/reconnecting states
- 📋 **Offline queue** - Claims made while offline are queued and processed on reconnect
- ✨ **No flicker** - Previous results stay visible while new claims are processing

## What This Demonstrates

### The Problem with REST

Traditional username claiming requires HTTP boilerplate:

```typescript
// Client
const response = await fetch('/api/claim-username', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username }),
})
if (!response.ok) throw new Error('Request failed')
const data = await response.json()

// Server (Express)
app.post('/api/claim-username', async (req, res) => {
  const { username } = req.body
  // ... validation and persistence logic
  res.json({ claimed: true })
})
```

### The Askforce RPC Solution

With Askforce, the same pattern becomes:

```typescript
// Client
const askId = askforce.ask({ username })
const answer = await askforce.waitFor(askId)

// Server
askforce.onAsk(async (askId, question) => {
  const { username } = question
  // ... validation and persistence logic
  return { claimed: true }
})
```

## Benefits

| Feature | REST | Askforce RPC |
|---------|------|--------------|
| Type Safety | Manual (OpenAPI, etc.) | Built-in via schemas |
| Offline Support | None | Claims queue automatically |
| Real-time Sync | Requires WebSocket setup | Built-in via CRDT |
| Error Handling | HTTP status codes | Typed errors |
| Boilerplate | High | Minimal |
| Transport | HTTP only | Any (WebSocket, SSE, etc.) |

## How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│   Browser                              Server                   │
│   ┌─────────────┐                     ┌─────────────┐          │
│   │ askforce    │                     │ askforce    │          │
│   │ .ask()      │──── WebSocket ─────▶│ .onAsk()    │          │
│   │ .waitFor()  │◀─── CRDT Sync ──────│ return {...}│          │
│   └─────────────┘                     └─────────────┘          │
│                                                                 │
│   Two Documents (for permissions):                              │
│   ┌─────────────────────┐  ┌─────────────────────┐             │
│   │ "username-rpc"      │  │ "claimed-usernames" │             │
│   │ Client-writable     │  │ Server-only         │             │
│   │ (RPC questions)     │  │ (via permissions)   │             │
│   └─────────────────────┘  └─────────────────────┘             │
│                                                                 │
│   1. Client writes "ask" to RPC document                       │
│   2. Server sees it, processes claim, writes "answer"          │
│   3. Server writes to claimed-usernames doc (clients can't)    │
│   4. All clients see the new claimed username in real-time     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## File Structure

```
src/
├── server.ts              # Bun server + Askforce onAsk handler
├── app.tsx                # React UI + Askforce ask/waitFor
├── config.ts              # Centralized timeout and limit constants
├── styles.css             # Styling with animations
├── use-connection-state.ts # Hook for WebSocket connection state
└── shared/
    ├── schema.ts          # Question/Answer types + shared validation
    └── schema.test.ts     # Unit tests for validation logic
```

## Architecture

### Discriminated Union for Claim State

The client uses a discriminated union pattern for managing claim state, providing a single source of truth:

```typescript
type ClaimState =
  | { status: "idle" }
  | { status: "claiming"; username: string }
  | { status: "success"; username: string; answer: Answer }
  | { status: "error"; username: string; error: string }
  | { status: "invalid"; username: string; message: string }
```

This pattern eliminates the need for multiple related state variables and makes state transitions explicit and type-safe.

### Server-Authoritative Architecture

The demo uses **two separate CRDT documents** with different permissions:

| Document | Purpose | Permissions |
|----------|---------|-------------|
| `username-rpc` | Askforce RPC queue | Client-writable |
| `claimed-usernames` | List of claimed usernames | Server-only |

This is configured via the Loro Extended permissions system:

```typescript
const repo = new Repo({
  permissions: {
    mutability: (doc, peer) => {
      // Claimed usernames doc is server-only
      if (doc.id === "claimed-usernames") {
        return peer.channelKind === "storage"
      }
      // RPC doc is client-writable
      return true
    },
  },
})
```

**Why two documents?**
- Clients need to write to the RPC document to ask questions
- But only the server should write to the claimed usernames list
- Permissions operate at the document level, so we split them

**Benefits:**
- Server restart = clean state (no stale data from clients)
- Clients cannot forge claimed usernames
- Clear separation of concerns

### Shared Validation

Username validation is shared between client and server in `shared/schema.ts`:

```typescript
export const USERNAME_REGEX = /^[a-zA-Z0-9_]{3,20}$/

export function isValidUsername(username: string): boolean {
  return USERNAME_REGEX.test(username)
}
```

- **Client**: Validates before RPC call for immediate feedback (no network round-trip)
- **Server**: Validates authoritatively before claiming

### Configuration Constants

All timeouts and limits are centralized in `config.ts`:

```typescript
export const TIMEOUTS = {
  SYNC: 5000,              // Wait for network sync
  RPC_RESPONSE: 10000,     // Wait for RPC response
  QUEUE_RESULT_DISPLAY: 2000,  // Display each queued result
  CLEANUP_DELAY: 3000,     // Clean up completed claims
} as const

export const LIMITS = {
  RECENT_USERNAMES_DISPLAY: 10,
  SUGGESTIONS_COUNT: 3,
} as const
```

## Key Code

### Schema (shared/schema.ts)

The schema defines two separate documents:

```typescript
// RPC document - client-writable
export const RpcDocSchema = Shape.doc({
  rpc: UsernameRpcSchema,
})

// Claimed usernames document - server-only (via permissions)
export const ClaimedUsernamesDocSchema = Shape.doc({
  claimedUsernames: Shape.list(ClaimedUsernameSchema),
})
```

### Server (server.ts)

The server uses two handles with permissions:

```typescript
const repo = new Repo({
  permissions: {
    mutability: (doc, peer) => {
      if (doc.id === "claimed-usernames") {
        return peer.channelKind === "storage" // Server-only
      }
      return true // RPC is client-writable
    },
  },
})

const rpcHandle = repo.get("username-rpc", RpcDocSchema, EphemeralDeclarations)
const claimedHandle = repo.get("claimed-usernames", ClaimedUsernamesDocSchema)

askforce.onAsk(async (askId, question) => {
  const { username } = question
  
  // ... validation logic ...
  
  // Write to server-only document (clients can't write here)
  claimedHandle.change(doc => {
    doc.claimedUsernames.push({ username, claimedAt: Date.now() })
  })
  
  return { claimed: true, reason: null, suggestions: null }
})
```

### Client (app.tsx)

The client uses two handles - one for RPC, one for reading claimed usernames:

```typescript
// Two handles for different purposes
const rpcHandle = useHandle("username-rpc", RpcDocSchema, EphemeralDeclarations)
const claimedHandle = useHandle("claimed-usernames", ClaimedUsernamesDocSchema)
const claimedDoc = useDoc(claimedHandle)

// Askforce uses the RPC handle
const askforce = new Askforce(rpcHandle.doc.rpc, rpcHandle.presence, { ... })

// Read claimed usernames from server-only document
const claimedUsernames = claimedDoc.claimedUsernames

const claimUsername = async () => {
  // Client-side validation for immediate feedback
  if (!isValidUsername(trimmedUsername)) {
    setClaimState({ status: "invalid", username: trimmedUsername, message: "..." })
    return
  }
  
  // If offline, queue the claim for later
  if (connectionState !== "connected") {
    setPendingClaims(prev => [...prev, { username, status: "queued" }])
    return
  }
  
  setClaimState({ status: "claiming", username: trimmedUsername })
  const askId = askforce.ask({ username })
  const answer = await askforce.waitFor(askId, TIMEOUTS.RPC_RESPONSE)
  setClaimState({ status: "success", username: trimmedUsername, answer })
}
```

## Try It

1. **Claim a username** - Enter something like "myname123" and click "Claim"
2. **See it fail** - Try to claim the same username again
3. **Watch real-time sync** - Open two browser tabs and claim in one - see it appear in both
4. **Test offline mode** - Stop the server, try to claim, restart - watch the queue process
5. **Check the network tab** - No HTTP requests for claims, just WebSocket!

## Reserved Usernames

The following usernames are reserved and cannot be claimed:
`admin`, `root`, `user`, `test`, `support`, `help`, `info`, `contact`, `sales`, `marketing`

## Learn More

- [Askforce README](../../packages/askforce/README.md) - Full API documentation
- [Loro Extended Docs](../../docs/) - Architecture and concepts
