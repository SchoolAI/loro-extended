# @loro-extended/lens

Composable bidirectional filtered synchronization for Loro TypedDoc.

## Overview

A **Lens** creates a **worldview** (`lens.worldview`) from a **world** (`lens.world`). The worldview is your filtered perspective on the shared world—you see only the changes you've chosen to accept.

Changes flow bidirectionally:

- **World → Worldview**: Commit-level filtered import (preserves causal history)
- **Worldview → World**: State-based `applyDiff` (avoids causal history issues)

This enables **local sovereignty**—the ability to filter out unwanted peer changes while maintaining CRDT convergence in the background. Your worldview reflects your subjective interpretation of the shared world, while the world itself remains the canonical, converging state that all peers eventually agree upon.

```
┌─────────────────────────────────────────────────────────────────┐
│                     External Sync (Repo, etc.)                  │
│                               │                                 │
│                               ▼                                 │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │                  lens.world (TypedDoc)                  │   │
│   │                     World (shared)                      │   │
│   └─────────────────────────────────────────────────────────┘   │
│            │                                    ▲               │
│            │ subscribe()                        │ applyDiff()   │
│            │ (op-based)                         │ (state-based) │
│            │ → filter(commit)                   │               │
│            │ → import accepted                  │               │
│            ▼                                    │               │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │                 lens.worldview (TypedDoc)               │   │
│   │                  Worldview (filtered)                   │   │
│   └─────────────────────────────────────────────────────────┘   │
│                               │                                 │
│                               ▼                                 │
│                      UI Components read                         │
│                      lens.change() writes                       │
└─────────────────────────────────────────────────────────────────┘
```

## Installation

```bash
pnpm add @loro-extended/lens @loro-extended/change loro-crdt
```

## Basic Usage

```typescript
import { createTypedDoc, Shape } from "@loro-extended/change";
import { createLens, filterByMessage } from "@loro-extended/lens";

// Define your schema
const GameSchema = Shape.doc({
  players: Shape.record(
    Shape.struct({
      name: Shape.text(),
      score: Shape.counter(),
    }),
  ),
});

// Create the world document (synced externally)
const world = createTypedDoc(GameSchema);

// Create a lens with filtering
const lens = createLens(world, {
  filter: (info) => {
    // Only accept commits from trusted users
    const msg = info.message as { role?: string; userId?: string } | undefined;
    return msg?.role === "admin" || msg?.userId === myUserId;
  },
});

// Read from the worldview (filtered)
const players = lens.worldview.players.toJSON();

// Write through the lens (propagates to world)
lens.change((draft) => {
  draft.players.set("alice", { name: "Alice", score: 0 });
});

// Cleanup when done
lens.dispose();
```

## With Repo Handle

```typescript
import { createLens } from "@loro-extended/lens";

const handle = repo.get("game-doc", GameSchema);

// Create lens from the Handle's doc
const lens = createLens(handle.doc, {
  filter: (info) => {
    const msg = info.message as { userId?: string } | undefined;
    return msg?.userId === myUserId;
  },
});

// UI reads from lens.worldview (worldview)
// Writes go through lens.change()
```

## API Reference

### `createLens(world, options?)`

Creates a Lens from a world TypedDoc.

**Parameters:**

- `world: TypedDoc<D>` - The world document (shared, converging state)
- `options?: LensOptions` - Optional configuration
  - `filter?: LensFilter` - Filter function for incoming commits (default: accept all)

**Returns:** `Lens<D>`

### `Lens<D>`

```typescript
interface Lens<D extends DocShape> {
  /** The worldview (filtered) - UI reads from here */
  readonly worldview: TypedDoc<D>;

  /** The world (shared) - for reference/sync */
  readonly world: TypedDoc<D>;

  /** Apply changes to worldview, propagate to world via applyDiff */
  change(fn: (draft: Mutable<D>) => void, options?: ChangeOptions): void;

  /** Cleanup subscriptions */
  dispose(): void;
}
```

### `ChangeOptions`

```typescript
interface ChangeOptions {
  /** Commit message to attach (string or object, auto-serialized) */
  commitMessage?: string | object;
}
```

### `LensFilter`

```typescript
type LensFilter = (info: CommitInfo) => boolean;
```

Filter function called for each incoming commit. Return `true` to accept, `false` to reject.

### `CommitInfo`

```typescript
interface CommitInfo {
  raw: JsonChange; // Original JsonChange for advanced use
  peerId: string; // Extracted from commit.id
  counter: number; // Extracted from commit.id
  timestamp: number; // Unix timestamp
  message: unknown; // Parsed JSON message, or undefined if invalid
}
```

The filter receives pre-parsed commit metadata, eliminating manual parsing:

```typescript
const lens = createLens(world, {
  filter: (info) => {
    // No manual parsing needed!
    const msg = info.message as { role?: string } | undefined;
    return info.peerId === "12345" && msg?.role === "admin";
  },
});
```

### `parseCommitInfo(commit)`

Helper function to parse a `JsonChange` into `CommitInfo`:

```typescript
import { parseCommitInfo } from "@loro-extended/lens";

const info = parseCommitInfo(commit);
console.log(info.peerId, info.message);
```

## Built-in Filters

### `filterNone`

Accept all commits (default behavior).

```typescript
import { filterNone } from "@loro-extended/lens";

const lens = createLens(world, { filter: filterNone });
```

### `filterAll`

Reject all external commits (read-only for external changes).

```typescript
import { filterAll } from "@loro-extended/lens";

const lens = createLens(world, { filter: filterAll });
// External changes won't reach the worldview (lens.worldview)
// Local changes via lens.change() still work
```

### `filterByPeers(trustedPeers)`

Only accept commits from specified peer IDs.

```typescript
import { filterByPeers } from "@loro-extended/lens";

const lens = createLens(world, {
  filter: filterByPeers(["12345", "67890"]),
});
```

### `filterByMessage(predicate, parse?)`

Filter based on commit message content.

```typescript
import { filterByMessage } from "@loro-extended/lens";

const lens = createLens(world, {
  filter: filterByMessage((msg) => msg?.role === "admin"),
});
```

### `composeFilters(filters)`

Compose multiple filters with AND logic.

```typescript
import {
  composeFilters,
  filterByPeers,
  filterByMessage,
} from "@loro-extended/lens";

const lens = createLens(world, {
  filter: composeFilters([
    filterByPeers(["12345"]),
    filterByMessage((msg) => msg?.allowed === true),
  ]),
});
```

### `anyFilter(filters)`

Compose filters with OR logic.

```typescript
import { anyFilter, filterByPeers, filterByMessage } from "@loro-extended/lens";

const lens = createLens(world, {
  filter: anyFilter([
    filterByPeers(["admin-peer"]),
    filterByMessage((msg) => msg?.isSystem === true),
  ]),
});
```

### `notFilter(filter)`

Negate a filter.

```typescript
import { notFilter, filterByPeers } from "@loro-extended/lens";

// Accept commits from everyone EXCEPT blocked peers
const lens = createLens(world, {
  filter: notFilter(filterByPeers(["blocked-peer"])),
});
```

## Commit Messages

When using lens-based filtering, you can attach commit messages that will be visible to server-side filters:

```typescript
// String message
lens.change(
  (draft) => {
    draft.game.players.get(playerId).choice = "rock";
  },
  { commitMessage: "player-move" },
);

// Object message (auto-serialized to JSON)
lens.change(
  (draft) => {
    draft.game.players.get(playerId).choice = "rock";
  },
  { commitMessage: { playerId, action: "move" } },
);
```

The message is automatically JSON-serialized and available in the filter's `CommitInfo.message`. This enables identity-based filtering where the server can verify who made each change.

Commit messages also propagate through chained lenses, so a change made in a deeply nested lens will have its message available at the root world.

## Lens Composition

Lenses can be chained for multi-level filtering:

```typescript
// First lens: filter by role
const adminLens = createLens(world, {
  filter: filterByMessage((msg) => msg?.role === "admin"),
});

// Second lens: further filter by timestamp
const recentLens = createLens(adminLens.worldview, {
  filter: (info) => info.timestamp > Date.now() / 1000 - 3600,
});

// recentLens.worldview only contains recent admin commits
```

## Key Design Decisions

### Why `applyDiff` for Worldview → World?

If Bob tries to surreptitiously write Alice's choice to the world, and Alice filters it out, Alice's subsequent write via operation-based import might lose to Bob's write, due to CRDT convergence (her op wasn't based on "latest" state). Using `applyDiff()` makes it a state transformation that doesn't care about causal history—Alice's local changes always have a chance to "win" at the even playing field of the world.

### Causal Consistency in Filtering

If commit N from a peer is rejected, all subsequent commits (N+1, N+2, etc.) from that peer in the same batch are also rejected. This maintains causal consistency.

### Preserved Peer ID

The worldview is created via `world.fork()` with the same peer ID as the world. This keeps the version vector small and ensures local writes appear as the same peer in both documents.

## Limitations

### Divergence Behavior

**Local operations ADD to world state, they do not overwrite.** When you make changes through the lens, those changes are applied as a delta to the world. Filtered peer changes are PRESERVED in the world:

```typescript
// World has counter=100 from filtered peer
// Worldview (lens.worldview) has counter=0 (filtered)
lens.change((d) => d.counter.increment(5));

// Result:
// - lens.worldview.counter = 5 (worldview)
// - lens.world.counter = 105 (world: 100 + 5, NOT 5!)
```

This is intentional—the world maintains complete history, the worldview provides a filtered perspective.

### Outbound Writes Bypass Filters

Filters only apply to **inbound** changes (world → worldview). Outbound writes (worldview → world via `lens.change()`) always reach the world regardless of filters. This is inherent to a CRDT convergent world with lenses.

### Container Creation Limitations

| Operation                    | Status     | Notes                                  |
| ---------------------------- | ---------- | -------------------------------------- |
| Simple list push/pop         | ✅ Works   |                                        |
| Map key with primitive       | ✅ Works   |                                        |
| Delete map key               | ⚠️ Partial | Results in empty string, not undefined |
| Modify existing nested       | ✅ Works   | Requires loro-crdt ≥1.10.5             |
| Create new nested (raw Loro) | ✅ Works   | Requires loro-crdt ≥1.10.5             |
| Create new nested (TypedDoc) | ✅ Works   | Requires loro-crdt ≥1.10.5             |

**Notes**:

- **loro-crdt 1.10.5+**: The `applyDiff` same-peer-ID fix enables all nested container operations. Container IDs are preserved when applying diffs back to the source document.
- All nested container operations (create, modify) work correctly via `lens.change()` with loro-crdt 1.10.5+.

### Filter Lifecycle

- **New lens starts from current state**: Cannot re-filter historical commits
- **Filter exceptions are caught**: If filter throws, commit is rejected
- **Non-boolean returns are coerced**: Truthy → true, falsy → false

### Undo/Redo

- `lens.worldview` and `lens.world` are separate documents with independent undo stacks
- Changes via `applyDiff` create new commits, not replayed operations

See [TECHNICAL.md](./TECHNICAL.md) for detailed documentation.

## License

MIT
