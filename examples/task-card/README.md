# Task Card — LEA Demo

A demonstration of the **LEA (Loro-Extended Architecture)** pattern: discriminated union state machines with CRDTs.

## Quick Start

```bash
# From the repository root
pnpm install
pnpm --filter example-task-card dev
```

Open http://localhost:5175 in your browser.

## What This Demo Shows

### 1. Discriminated Union State Machine

The task has 6 states, each with different fields:

```
draft ──▶ todo ──▶ in_progress ──▶ done
            │           │            │
            │           ▼            │
            │       blocked ─────────┘
            │           │
            └───────────┴──────────▶ archived
```

Each state is a discriminated union variant:

```typescript
type TaskState =
  | { status: "draft"; title: string; createdAt: number }
  | { status: "todo"; title: string; description: string; createdAt: number }
  | { status: "in_progress"; title: string; description: string; startedAt: number }
  | { status: "blocked"; title: string; description: string; blockedReason: string; blockedAt: number }
  | { status: "done"; title: string; description: string; completedAt: number }
  | { status: "archived"; title: string; archivedAt: number }
```

### 2. Intention-Based Dispatch

All state changes go through pure data "intentions":

```typescript
type TaskIntention =
  | { type: "UPDATE_TITLE"; title: string }
  | { type: "UPDATE_DESCRIPTION"; description: string }
  | { type: "PUBLISH" }     // draft → todo
  | { type: "START" }       // todo → in_progress
  | { type: "BLOCK"; reason: string }  // in_progress → blocked
  | { type: "UNBLOCK" }     // blocked → in_progress
  | { type: "COMPLETE" }    // in_progress → done
  | { type: "REOPEN" }      // done → todo
  | { type: "ARCHIVE" }     // any → archived
```

### 3. Guard Conditions

The `interpret` function enforces valid transitions:

```typescript
function interpret(draft: Mutable<TaskDoc>, intention: TaskIntention) {
  switch (intention.type) {
    case "START":
      // Guard: can only start from todo
      if (draft.task.state.status !== "todo") return
      draft.task.state = { status: "in_progress", ... }
      break
    // ...
  }
}
```

Invalid transitions are silently ignored (no-ops).

### 4. CRDT Persistence & Sync

- **Refresh persistence**: State survives page refresh
- **Multi-tab sync**: Open two tabs and watch changes sync in real-time

## The LEA Pattern

```
┌─────────────────────────────────────────────────────────────────┐
│                         LEA Pattern                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  User Action                                                    │
│       │                                                         │
│       ▼                                                         │
│  ┌─────────────┐                                                │
│  │  Intention  │  Pure data describing what user wants          │
│  └─────────────┘                                                │
│       │                                                         │
│       ▼                                                         │
│  ┌─────────────┐                                                │
│  │  dispatch() │  Wraps change() with interpret()               │
│  └─────────────┘                                                │
│       │                                                         │
│       ▼                                                         │
│  ┌─────────────┐                                                │
│  │ interpret() │  Checks guards, mutates CRDT draft             │
│  └─────────────┘                                                │
│       │                                                         │
│       ▼                                                         │
│  ┌─────────────┐                                                │
│  │    CRDT     │  Persisted, synced, conflict-free              │
│  └─────────────┘                                                │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Demo Scenarios

1. **Create and Publish**: Start with draft, add title, click Publish → becomes todo
2. **Work Flow**: todo → Start → in_progress → Complete → done
3. **Blocking**: in_progress → Block (with reason) → blocked → Unblock → in_progress
4. **Reopen**: done → Reopen → todo
5. **Archive**: Any state → Archive → archived
6. **Refresh**: Refresh page, state persists
7. **Multi-tab**: Open two tabs, make changes, both sync

## File Structure

```
src/
├── app.tsx           # Main app with RepoProvider
├── intentions.ts     # TaskIntention type
├── interpret.ts      # interpret() function with guards
├── interpret.test.ts # Unit tests for state transitions
├── schema.ts         # TaskDocSchema with discriminated union
├── server.ts         # Vite + WebSocket server
├── styles.css        # Task card styling
├── task-card.tsx     # TaskCard component with state views
└── use-task.ts       # useTask hook with dispatch
```

## Running Tests

```bash
pnpm --filter example-task-card verify
```

## Key Takeaways

1. **Discriminated unions work great with CRDTs** — The `Shape.plain.discriminatedUnion` schema handles state transitions cleanly.

2. **Intentions provide a clear audit trail** — Every state change is a discrete, named action.

3. **Guard conditions are simple** — Just check the current state and return early if invalid.

4. **The pattern scales** — This same approach works for complex multi-entity state machines.
