# Task Card Technical Documentation

This document captures architectural decisions and implementation details for the LEA 3.0 Quiz Challenge demo.

## LEA 3.0 Architecture

LEA (Loro Extended Architecture) is a pattern for building CRDT-native applications with pure functional principles. It extends The Elm Architecture (TEA) to work with CRDTs.

**Core equation**: `(Frontier, Msg) → Frontier'`

### Key Components

| Component    | Purpose                                                |
| ------------ | ------------------------------------------------------ |
| **Doc**      | The CRDT document (shared state)                       |
| **State**    | Pure function: `(doc, frontier) → state`               |
| **Update**   | State transition: `(doc, frontier, msg) → frontier'`   |
| **Reactors** | Respond to transitions: `(before, after) → void \| UI` |

## Runtime Optimization: Lazy TypedDoc Transitions

### The Problem

The naive runtime implementation calls `toJSON()` on every document change:

```typescript
// ❌ Expensive: O(N) serialization on every change
let previousState = getState(doc, frontier); // calls toJSON()

doc.subscribe(() => {
  const after = getState(doc, frontier); // calls toJSON() again!
  invokeReactors({ before: previousState, after });
  previousState = after;
});
```

For large documents, this is wasteful - reactors often only access a few properties.

### The Solution: Frontier-Based Lazy Evaluation

Store **frontiers** instead of JSON, create **lazy TypedDoc forks** on demand:

```typescript
// ✅ Efficient: O(1) frontier storage, lazy evaluation
let previousFrontier = doc.frontiers();

doc.subscribe(() => {
  const beforeFrontier = previousFrontier;
  const afterFrontier = doc.frontiers();
  previousFrontier = afterFrontier;

  // Lazy forks - no toJSON() until values are accessed
  const before = doc.forkAt(beforeFrontier);
  const after = doc.forkAt(afterFrontier);

  invokeReactors({ before, after });
});
```

### Benefits

1. **No upfront serialization** - `forkAt()` is O(1)
2. **Lazy evaluation** - values only computed when accessed
3. **Minimal memory** - frontiers are small (just peer IDs + counters)
4. **Correct async behavior** - frontiers are captured at transition time

### Transition Type Change

The `Transition` type changed from plain JSON to TypedDoc:

```typescript
// Before: Plain JSON (eager)
type Transition = {
  before: QuizDoc; // Plain object from toJSON()
  after: QuizDoc;
};

// After: TypedDoc (lazy)
type Transition = {
  before: TypedDoc<typeof QuizDocSchema>; // Lazy proxy
  after: TypedDoc<typeof QuizDocSchema>;
};
```

### Reactor Access Patterns

Most reactor code works unchanged:

```typescript
// Status access - same syntax
if (after.quiz.state.status === "submitted") { ... }

// Record access - use .get() instead of bracket notation
const response = after.sensors.feedbackResponses.get(requestId)
```

### Read-Only Semantics

The `before` and `after` TypedDocs are **read-only snapshots**:

- They are forks at specific frontiers
- Mutations would only affect the fork, not the main doc
- Effect reactors that need to write receive the doc separately via factory closure

```typescript
// Effect reactor pattern - doc for writes is separate
function createAiFeedbackReactor(
  doc: TypedDoc<Schema>,  // ← Doc for writes (via closure)
): Reactor {
  return async ({ before, after }) => {  // ← Transition for reads only
    if (!entered("submitted", before, after)) return

    // Write to the closure's doc, not the transition's after
    change(doc, draft => {
      draft.sensors.feedbackResponses[requestId] = { ... }
    })
  }
}
```

## Fork-and-Merge Update Pattern

The update function uses a **fork-and-merge** pattern that provides a clean mental model for state transitions.

### The Problem

In a naive implementation, you need separate objects for reading (guards) and writing (mutations):

```typescript
// Confusing: two objects, easy to mix up
const state = getState(doc, frontier); // read-only
change(doc, (draft) => {
  // write-only
  if (state.status !== "idle") return; // read from state
  draft.status = "running"; // write to draft
});
```

### The Solution: Fork-and-Merge

Fork the document at the frontier, work on the fork, then merge changes back:

```typescript
const update = createUpdate<Schema, Msg>((doc, msg, timestamp) => {
  // Single object for both reading and writing!
  if (doc.status !== "idle") return; // read from doc
  change(doc, (d) => (d.status = "running")); // write via change()
});
```

### Critical Implementation Detail: Peer ID Preservation

**Problem**: Loro forks get new peer IDs by default. Without correction, each update creates operations from a different peer, causing the frontier to not advance correctly.

```
// Without setPeerId():
After START_QUIZ:    [{"peer":"7453188888951615348","counter":0}]
After SELECT_OPTION: [{"peer":"12985456156409979979","counter":0}]  // Different peer!
// Timestamp doesn't increase because counter is 0 for each new peer
```

**Solution**: Copy the main doc's peer ID to the fork:

```typescript
const workingDoc = doc.forkAt(frontier);
loro(workingDoc).doc.setPeerId(loro(doc).doc.peerId); // Critical!
```

```
// With setPeerId():
After START_QUIZ:    [{"peer":"4368829338941871688","counter":0}]
After SELECT_OPTION: [{"peer":"4368829338941871688","counter":1}]  // Same peer, counter advances!
```

### The createUpdate Factory

```typescript
export function createUpdate<Schema extends DocShape, Msg>(
  handler: (doc: TypedDoc<Schema>, msg: Msg, timestamp: number) => void,
): (doc: TypedDoc<Schema>, frontier: Frontiers, msg: Msg) => Frontiers {
  return (doc, frontier, msg) => {
    // 1. Create a SHALLOW fork at the frontier (memory efficient!)
    // Uses shallowForkAt with preservePeerId: true
    const workingDoc = shallowForkAt(doc, frontier, { preservePeerId: true });

    // 2. Compute timestamp from frontier
    const timestamp = getTimestampFromFrontier(frontier);

    // 3. Let handler work on the fork
    handler(workingDoc, msg, timestamp);

    // 4. Merge changes back
    const updateData = loro(workingDoc).doc.export({
      mode: "update",
      from: loro(doc).doc.version(),
    });
    if (updateData.byteLength > 0) {
      loro(doc).doc.import(updateData);
    }

    return loro(doc).doc.frontiers();
  };
}
```

### Shallow Fork Optimization

We use `shallowForkAt` instead of `forkAt` for memory efficiency:

| Aspect | `forkAt` (Full Fork) | `shallowForkAt` (Shallow Fork) |
|--------|---------------------|-------------------------------|
| **Memory** | O(history) - full oplog | O(state) - current state only |
| **Creation time** | O(history) | O(state) |
| **Time travel** | ✅ Full history | ❌ Only from frontier |
| **Merge capability** | ✅ | ✅ |

For the fork-and-merge pattern, we don't need time travel on the working doc - we only need to:
1. Read current state
2. Apply changes
3. Export delta and merge back

The `preservePeerId: true` option ensures operations from the fork appear to come from the same peer, maintaining consistent frontier progression.

## State Machine Pattern

The quiz uses a discriminated union state machine:

```
idle → answering → submitted → reviewing → (answering | complete)
                                              ↑
                                              └── NEXT_QUESTION loops back
```

Each state has different fields, enforced by TypeScript:

```typescript
type QuizState =
  | { status: "idle" }
  | {
      status: "answering";
      questionIndex: number;
      selectedOption: number | null;
      startedAt: number;
    }
  | {
      status: "submitted";
      questionIndex: number;
      selectedOption: number;
      requestId: string;
    }
  | {
      status: "reviewing";
      questionIndex: number;
      isCorrect: boolean;
      feedback: string;
    }
  | { status: "complete"; score: number; totalQuestions: number };
```

## Sensors/Actuators Pattern

External I/O (like AI feedback) flows through dedicated namespaces:

- **Sensors**: External systems write here (e.g., AI responses)
- **Actuators**: LEA writes here, external systems read and act

```typescript
const Schema = Shape.doc({
  quiz: Shape.struct({ state: QuizStateSchema }),
  sensors: Shape.struct({
    feedbackResponses: Shape.record(FeedbackResponseSchema),
  }),
});
```

The server reactor watches for `submitted` state, calls the AI, and writes to `sensors.feedbackResponses`. A client reactor watches for new responses and dispatches `RECEIVE_FEEDBACK`.

## Server-Side Score Management

The score is incremented by the server's `aiFeedbackReactor`, not by clients. This follows LEA's principle that effects which should happen once must run on a single authoritative node.

### Why Server-Only?

- Multiple clients observing the same state transition would each increment
- CRDT Counter merges all increments, causing N× score with N clients
- Server is already the authority for feedback generation

### Implementation

- Score uses `Shape.struct({ value: Shape.plain.number() })` (not Counter)
- Server increments in `aiFeedbackReactor` when writing feedback
- Clients read score but never write to it
- Plain number allows reset on quiz restart

```typescript
// Server reactor (runs exactly once per answer)
change(doc, draft => {
  draft.sensors.feedbackResponses[requestId] = { isCorrect, feedback, receivedAt }
  if (isCorrect) {
    draft.score.value = (draft.score.value ?? 0) + 1  // Server-only increment
  }
})

// Client update (does NOT increment score)
case "RECEIVE_FEEDBACK": {
  change(doc, draft => {
    draft.quiz.state = { status: "reviewing", ... }
    // Score is incremented by server in aiFeedbackReactor
  })
}
```

## Time Travel Debugging (History Panel)

The quiz-challenge includes a history panel that demonstrates LEA's time travel capabilities using Loro's commit annotations and checkout mechanism.

### Commit Message Storage

Each `dispatch()` stores the message as a commit annotation before applying the update:

```typescript
function dispatch(msg: QuizMsg): void {
  // Store the message as a commit annotation for history tracking
  loro(doc).doc.setNextCommitMessage(
    JSON.stringify({
      type: msg.type,
      msg,
      timestamp: Date.now(),
    }),
  )

  // Apply the update
  update(doc, frontier, msg, questions)
}
```

### History Retrieval

The `getMessageHistory()` function traverses change ancestors to build a chronological history:

```typescript
export function getMessageHistory(doc, fromFrontiers?): HistoryEntry[] {
  const entries: HistoryEntry[] = []
  const frontiers = fromFrontiers ?? loro(doc).doc.frontiers()

  loro(doc).doc.travelChangeAncestors(frontiers, change => {
    if (change.message) {
      try {
        const data = JSON.parse(change.message)
        if (data.type && data.msg) {
          entries.push({
            id: `${change.counter}@${change.peer}`,
            msg: data.msg,
            timestamp: data.timestamp,
            frontier: [{ peer: change.peer, counter: change.counter }],
          })
        }
      } catch {
        // Skip malformed commit messages
      }
    }
    return true // Continue traversing
  })

  // travelChangeAncestors returns reverse causal order, so reverse for chronological
  return entries.reverse()
}
```

### Checkout/Attach Flow

Time travel uses Loro's `checkout()` and `checkoutToLatest()` methods:

```typescript
// Restore to historical state
const handleRestoreState = (frontier: Frontiers) => {
  loro(handle.doc).doc.checkout(frontier)
  // Document is now "detached" - viewing history
}

// Return to live state
const handleReturnToLive = () => {
  loro(handle.doc).doc.checkoutToLatest()
  // Document is now "attached" again
}
```

### Detached Mode Behavior

When the document is checked out to a historical frontier:

| Aspect | Behavior |
|--------|----------|
| `isDetached()` | Returns `true` |
| Editing | Disabled by default |
| Imports | Update OpLog only, not visible state |
| Reactors | Do NOT fire (LEA's "Frontier of Now" principle) |
| React hooks | Automatically reflect checked-out state |

### Why Reactors Don't Fire on Checkout

This is a key LEA design principle: **Reactors only fire at the "Frontier of Now"**.

When you checkout to a historical state:
- No timers start
- No AI calls trigger
- No toasts appear
- No side effects occur

This makes time travel safe for debugging and inspection. The historical state is purely for viewing - all effects are tied to the live edge of the document.

## File Structure

```
src/
├── shared/           # Shared between client and server
│   ├── schema.ts     # Document schema and types
│   ├── messages.ts   # Message types (discriminated union)
│   ├── update.ts     # Update function with createUpdate factory
│   ├── runtime.ts    # LEA runtime (stores commit messages)
│   ├── history.ts    # History retrieval utilities
│   ├── history.test.ts # Tests for history utilities
│   └── reactor-types.ts  # Reactor type definitions
├── client/           # Browser-only code
│   ├── app.tsx       # React app entry (history panel integration)
│   ├── quiz-card.tsx # Quiz UI component
│   ├── history-panel.tsx # Time travel debugging panel
│   ├── reactors.ts   # Client reactors (timer, sensor watcher)
│   └── use-quiz.ts   # React hook for quiz state
└── server/           # Node.js-only code
    ├── server.ts     # Express server
    └── reactors.ts   # Server reactors (AI feedback)
```
