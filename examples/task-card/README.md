# Task Card - LEA Demo

A demonstration of the **Loro Extended Architecture (LEA)** pattern using a task state machine.

## What This Demonstrates

This example showcases the core LEA principles:

1. **Pure Interpret Function** - `interpret(doc, intention, frontier) → Operations[]`
2. **Frontiers as Causal Context** - State AND timestamp derived from frontier
3. **Discriminated Union State Machine** - 6 states with type-safe transitions
4. **Guard Conditions** - Invalid transitions return empty operations
5. **Isolated Mutation** - All mutation happens in `apply()`
6. **CRDT Persistence & Sync** - State survives refresh and syncs across tabs

## The Full LEA Pattern

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              LEA Data Flow                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   User Action                                                               │
│       │                                                                     │
│       ▼                                                                     │
│   Intention (Pure Data)                                                     │
│   { type: "START" }                                                         │
│       │                                                                     │
│       ▼                                                                     │
│   dispatch(intention)                                                       │
│   └── frontier = loro(doc).doc.frontiers()  // Capture causal context       │
│       │                                                                     │
│       ▼                                                                     │
│   interpret(doc, intention, frontier) → Operations[]                        │
│   └── PURE! Derives state AND timestamp from frontier                       │
│       │                                                                     │
│       ▼                                                                     │
│   apply(draft, operations)                                                  │
│   └── Isolated mutation step                                                │
│       │                                                                     │
│       ▼                                                                     │
│   CRDT Layer (Loro)                                                         │
│   └── Synced to other tabs/devices, persisted to storage                    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Why Frontiers?

The frontier is the key to LEA's purity. It provides:

1. **State derivation** - `doc.forkAt(frontier)` gives you state at that point
2. **Logical timestamp** - Sum of counters gives monotonically increasing time
3. **Time travel** - Interpret with any historical frontier
4. **Determinism** - Same (doc, intention, frontier) always produces same operations

```typescript
// Derive state from frontier
function getStateAtFrontier(doc, frontier) {
  return doc.forkAt(frontier).task.state
}

// Derive timestamp from frontier
function getTimestampFromFrontier(frontier) {
  return frontier.reduce((sum, f) => sum + f.counter + 1, 0)
}
```

## State Machine

```
draft ──▶ todo ──▶ in_progress ──▶ done
            │           │            │
            │           ▼            │
            │       blocked ─────────┘
            │           │
            └───────────┴──────────▶ archived
```

### States

| State       | Description                    | Fields                                          |
| ----------- | ------------------------------ | ----------------------------------------------- |
| draft       | Initial state, editing title   | status, title, createdAt                        |
| todo        | Published, ready to start      | status, title, description, createdAt           |
| in_progress | Work has begun                 | status, title, description, startedAt           |
| blocked     | Waiting on something           | status, title, description, blockedReason, blockedAt |
| done        | Work completed                 | status, title, description, completedAt         |
| archived    | No longer active               | status, title, archivedAt                       |

### Intentions

| Intention          | From State   | To State    |
| ------------------ | ------------ | ----------- |
| UPDATE_TITLE       | draft, todo, in_progress, blocked | (same) |
| UPDATE_DESCRIPTION | todo, in_progress, blocked | (same) |
| PUBLISH            | draft        | todo        |
| START              | todo         | in_progress |
| BLOCK              | in_progress  | blocked     |
| UNBLOCK            | blocked      | in_progress |
| COMPLETE           | in_progress  | done        |
| REOPEN             | done         | todo        |
| ARCHIVE            | any (except archived) | archived |

## Key Files

```
src/
├── schema.ts         # TaskDocSchema with discriminated union
├── intentions.ts     # TaskIntention type (9 intentions)
├── operations.ts     # Operation type (pure data)
├── interpret.ts      # PURE interpret(doc, intention, frontier) function
├── apply.ts          # Isolated mutation step
├── use-task.ts       # useTask hook with dispatch
├── task-card.tsx     # TaskCard component with state views
└── interpret.test.ts # 35 unit tests (pure function testing!)
```

## Running

```bash
# From repo root
pnpm install
pnpm --filter example-task-card dev
```

Open http://localhost:5173

## Demo Scenarios

1. **Create and Publish**: Start with draft, add title, click Publish → becomes todo
2. **Work Flow**: todo → Start → in_progress → Complete → done
3. **Blocking**: in_progress → Block (with reason) → blocked → Unblock → in_progress
4. **Reopen**: done → Reopen → todo
5. **Archive**: Any state → Archive → archived
6. **Refresh**: Refresh page, state persists
7. **Multi-tab**: Open two tabs, make changes, both sync

## Why Pure Interpret?

The `interpret` function is **pure**:

```typescript
function interpret(
  doc: TypedDoc<typeof TaskDocSchema>,
  intention: TaskIntention,
  frontier: Frontiers,
): Operation[] {
  // Derive state from (doc, frontier) - PURE
  const state = getStateAtFrontier(doc, frontier)

  // Derive timestamp from frontier - PURE
  const timestamp = getTimestampFromFrontier(frontier)

  // No side effects, no Date.now(), no mutations
  // Same inputs ALWAYS produce same outputs
}
```

Benefits:

- **Testable** - No mocking needed, just pass inputs and check outputs
- **Deterministic** - Replay intentions and get same results
- **Debuggable** - Operations are data you can log and inspect
- **Time travel** - Use any historical frontier to see what would have happened

## Learn More

See [docs/lea.md](../../docs/lea.md) for the full LEA architecture documentation.
