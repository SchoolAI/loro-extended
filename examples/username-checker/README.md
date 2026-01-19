# Username Checker - Askforce RPC Demo

This example demonstrates how **Askforce RPC** replaces traditional REST APIs for a common web pattern: checking if a username is available during signup.

## Quick Start

```bash
# From the monorepo root
pnpm install
cd examples/username-checker
bun run src/server.ts
```

Then open http://localhost:5173

## What This Demonstrates

### The Problem with REST

Traditional username checking requires HTTP boilerplate:

```typescript
// Client
const response = await fetch('/api/check-username', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username }),
})
if (!response.ok) throw new Error('Request failed')
const data = await response.json()

// Server (Express)
app.post('/api/check-username', async (req, res) => {
  const { username } = req.body
  // ... validation logic
  res.json({ available: true })
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
  // ... validation logic
  return { available: true }
})
```

## Benefits

| Feature | REST | Askforce RPC |
|---------|------|--------------|
| Type Safety | Manual (OpenAPI, etc.) | Built-in via schemas |
| Offline Support | None | Asks queue automatically |
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
│   The "ask" is written to a CRDT document.                     │
│   The server sees it, processes it, writes the "answer".       │
│   The client's waitFor() resolves when the answer syncs back.  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## File Structure

```
src/
├── server.ts           # Bun server + Askforce onAsk handler
├── app.tsx             # React UI + Askforce ask/waitFor
├── styles.css          # Minimal styling
└── shared/
    └── schema.ts       # Question/Answer types (shared contract)
```

## Key Code

### Schema (shared/schema.ts)

The schema defines the RPC contract - what questions can be asked and what answers are expected:

```typescript
export const QuestionSchema = Shape.plain.struct({
  username: Shape.plain.string(),
})

export const AnswerSchema = Shape.plain.struct({
  available: Shape.plain.boolean(),
  reason: Shape.plain.string().optional(),
  suggestions: Shape.plain.list(Shape.plain.string()).optional(),
})

export const UsernameRpcSchema = createAskforceSchema(
  QuestionSchema,
  AnswerSchema,
)
```

### Server (server.ts)

The server creates an Askforce instance and registers a handler:

```typescript
const askforce = new Askforce(handle.doc.rpc, handle.presence, {
  peerId: "server",
  mode: "rpc",
})

askforce.onAsk(async (askId, question) => {
  const { username } = question
  
  if (!isValidUsername(username)) {
    return { available: false, reason: "invalid", suggestions: [...] }
  }
  
  if (isUsernameTaken(username)) {
    return { available: false, reason: "taken", suggestions: [...] }
  }
  
  return { available: true }
})
```

### Client (app.tsx)

The client creates an Askforce instance and calls `ask()` + `waitFor()`:

```typescript
const askforce = new Askforce(handle.doc.rpc, handle.presence, {
  peerId: handle.peerId,
  mode: "rpc",
})

const checkUsername = async () => {
  const askId = askforce.ask({ username })
  const answer = await askforce.waitFor(askId, 10000)
  setResult(answer)
}
```

## Try It

1. Enter a username like "alice" (taken) or "myname123" (available)
2. Click suggestions to try alternative usernames
3. Open the browser DevTools Network tab - notice there are no HTTP requests for the check!

## Learn More

- [Askforce README](../../packages/askforce/README.md) - Full API documentation
- [Loro Extended Docs](../../docs/) - Architecture and concepts
