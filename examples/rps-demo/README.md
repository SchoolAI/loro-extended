# Rock-Paper-Scissors Demo - Lens + Transitions

This demo showcases the **World + Worldview Architecture** using the new primitives: `createLens()` and `subscribe()` + `getTransition()`.

## Features

- **World + Worldview Separation**: Each peer maintains a world and a filtered worldview via `createLens()`
- **Identity Extraction**: Player identity is extracted from commit messages for filtering
- **Server-side Filtering**: The server validates that players can only modify their own data (authoritative for phase/result)
- **Client-side Sovereignty**: Clients filter out peer attempts to modify other players’ state
- **Reactors**: Game logic (all locked → reveal → resolved) runs on the server via `subscribe()` + `getTransition()`
- **Real-time Sync**: Changes sync instantly via WebSocket

## Architecture

```
┌───────────────────────────────────────────────────────────────┐
│                           SERVER                              │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │         Lens (World → Worldview, commit filter)         │  │
│  │  ┌─────────┐                 ┌─────────────────┐        │  │
│  │  │  World  │───filter───────▶│    Worldview    │        │  │
│  │  │ (CRDT)  │                 │   (filtered)    │        │  │
│  │  └─────────┘                 └─────────────────┘        │  │
│  │       │                                   │             │  │
│  │       │         ┌──────────────────┐      │             │  │
│  │       └────────▶│ subscribe +      │◀─────┘             │  │
│  │                 │ getTransition()  │                    │  │
│  │                 │ (reactors)       │                    │  │
│  │                 └──────────────────┘                    │  │
│  └─────────────────────────────────────────────────────────┘  │
│                              │                                │
│                         WebSocket                             │
│                              │                                │
└──────────────────────────────┼────────────────────────────────┘
                               │
        ┌──────────────────────┼──────────────────────┐
        │                      │                      │
        ▼                      ▼                      ▼
   ┌─────────┐            ┌─────────┐            ┌─────────┐
   │  Alice  │            │   Bob   │            │ Viewer  │
   │ Client  │            │ Client  │            │ Client  │
   └─────────┘            └─────────┘            └─────────┘
```

## How It Works

### Identity Extraction

Players include their identity in commit messages:

```typescript
// Client sets identity before making changes
loro(doc).doc.setNextCommitMessage(JSON.stringify({ playerId: "alice" }));

lens.change((d) => {
  d.game.players.set("alice", { choice: "rock", locked: true });
});
```

The server extracts this identity:

```typescript
const lens = createLens(handle.doc, { filter: gameFilter });

const unsubscribe = loro(lens.doc).subscribe((event) => {
  if (event.by === "checkout") return;
  const { before, after } = getTransition(lens.doc, event);
  for (const reactor of reactors) reactor({ before, after }, lens.change);
});
```

### Filtering

The server's filter validates each commit:

```typescript
const gameFilter: LensFilter = (info) => {
  // Accept server writes and each player’s own state; reject phase/result edits by clients
  return allowCommit(info, info.message?.playerId);
};
```

### Reactors

Game logic runs as reactors on the server:

1. **allLockedReactor**: When both players lock in → transition to "reveal"
2. **resolveGameReactor**: When phase becomes "reveal" → calculate winner → transition to "resolved"

## Running the Demo

1. Install dependencies:

   ```bash
   pnpm install
   ```

2. Start the server:

   ```bash
   pnpm dev
   ```

3. Open two browser tabs:

   - Alice: http://localhost:5173?player=alice
   - Bob: http://localhost:5173?player=bob

4. Play the game:
   - Each player selects rock, paper, or scissors
   - Click "Lock In" to confirm choice
   - When both players lock in, the game reveals choices and shows the winner

## Engineering Practices

- **Functional core / imperative shell**: Reactors operate on transitions derived from `getTransition()`; subscriptions and network wiring live in the server/client shells.
- **Role separation**: Shared filter helpers live in `src/shared/filters.ts`, while role-specific filters live in `src/server/filters.ts` and `src/client/filters.ts`.
- **Tests**: `src/shared/filters.test.ts` verifies client sovereignty and server authority rules.

## Key Files

- `src/shared/schema.ts` - Game document schema
- `src/shared/identity.ts` - Identity extraction utilities
- `src/shared/filters.ts` - Shared filter helpers
- `src/server/filters.ts` - Server lens filter
- `src/client/filters.ts` - Client lens filter
- `src/shared/filters.test.ts` - Filter tests
- `src/shared/reactors.ts` - Game logic reactors
- `src/server/server.ts` - Server using lens + subscribe/getTransition
- `src/client/app.tsx` - React client app
- `src/client/use-rps-game.ts` - Client-side game hook

## Concepts Demonstrated

1. **World**: The shared CRDT document that converges across all peers
2. **Worldview**: Filtered projection created by `createLens`
3. **Identity Extraction**: Flexible identity from commit messages (could be JWT, signatures, etc.)
4. **Filtering**: Server and clients validate peer commits before applying to Worldview
5. **Reactors**: Pattern-match on state transitions via `getTransition()`
6. **Repo Integration**: Repo syncs into World, lenses filter into worldviews
