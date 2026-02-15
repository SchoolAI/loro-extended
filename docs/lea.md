# LEA: The Loro Extended Architecture

LEA is a rigorous architecture pattern for building CRDT-native applications with pure functional principles. It extends The Elm Architecture (TEA) to work seamlessly with CRDTs while preserving purity and determinism.

**LEA is TEA + Time.**

## About This Document

LEA is an **architecture pattern**, like [TEA (The Elm Architecture)](https://guide.elm-lang.org/architecture/), Flux, or Redux. This document describes the theoretical foundations that apply regardless of implementation language or framework.

- **TypeScript is used as a specification language** - The types precisely specify the pattern
- **Examples use [Loro](https://www.loro.dev)** - But the concepts apply to any CRDT implementation
- **Implementation details are labeled** - Look for "Implementation Note" callouts

For web-specific patterns (routing, browser history, React integration), see [LEA for Web Applications](./lea-web.md).

---

## Quick Start

LEA applications follow a simple pattern:

1. **Define your state** in a CRDT document
2. **Define your messages** as discriminated unions
3. **Define your update function** that transitions state based on messages
4. **Define your reactors** that respond to state transitions
5. **Create a runtime** that orchestrates everything

Here's a complete example--**Rock-Paper-Scissors** with two players and a server that reveals the result:

```typescript
type Status = "choosing" | "revealing" | "resolved";
type Choice = "rock" | "paper" | "scissors";
type PlayerID = "alice" | "bob";
type Result = "alice" | "bob" | "draw";

// 1. Define the schema (shared between CLIENTs and SERVER)
const RPSSchema = Shape.doc({
  game: Shape.struct({
    status: Shape.plain.string<Status>(),
    players: Shape.record(
      Shape.struct({
        choice: Shape.plain.string<Choice>().nullable(),
        locked: Shape.plain.boolean(), // Stability marker: player is done choosing
      }),
    ),
    result: Shape.plain.string<Result>().nullable(),
  }),
});

// 2. Define CLIENT messages and update
type ClientMsg =
  | { type: "CONSIDERING"; playerId: PlayerID; choice: Choice }
  | { type: "LOCK_IN"; playerId: PlayerID };

const clientUpdate = createUpdate<typeof RPSSchema, ClientMsg>((doc, msg) => {
  switch (msg.type) {
    case "CONSIDERING":
      if (doc.game.players[msg.playerId]?.locked) return;

      doc.game.players[msg.playerId] = { choice: msg.choice, locked: false };

      break;

    case "LOCK_IN":
      if (!doc.game.players[msg.playerId]?.choice) return;

      // Client ONLY sets their own locked flag - nothing else!
      doc.game.players[msg.playerId].locked = true;

      break;
  }
});

// 3. Define SERVER messages and update
type ServerMsg = { type: "BOTH_LOCKED" } | { type: "RESOLVE"; result: Result };

const serverUpdate = createUpdate<typeof RPSSchema, ServerMsg>((doc, msg) => {
  switch (msg.type) {
    case "BOTH_LOCKED":
      if (doc.game.status !== "choosing") return;

      doc.game.status = "revealing";

      break;

    case "RESOLVE":
      if (doc.game.status !== "revealing") return;

      // Batch both changes together
      change(doc, (d) => {
        d.game.result = msg.result;
        d.game.status = "resolved";
      });

      break;
  }
});

// Now we create runtimes - THREE SEPARATE PROCESSES sharing ONE document
//
//    ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
//    │  Alice Browser  │     │   Bob Browser   │     │     Server      │
//    │                 │     │                 │     │                 │
//    │  clientUpdate   │     │  clientUpdate   │     │  serverUpdate   │
//    │  (no reactors)  │     │  (no reactors)  │     │  + reactors     │
//    └────────┬────────┘     └────────┬────────┘     └────────┬────────┘
//             │                       │                       │
//             └───────────────────────┴───────────────────────┘
//                                     │
//                        ┌────────────┴────────────┐
//                        │     CRDT Document       │
//                        │   (syncs automatically) │
//                        └─────────────────────────┘

// === ALICE'S BROWSER ===
const aliceDoc = createTypedDoc(RPSSchema);
const alice = createRuntime({
  doc: aliceDoc,
  update: clientUpdate,
  reactors: [],
});

// === BOB'S BROWSER ===
const bobDoc = createTypedDoc(RPSSchema);
const bob = createRuntime({
  doc: bobDoc,
  update: clientUpdate,
  reactors: [],
});

// === SERVER ===

// Detects when both players are locked
const bothLockedReactor: Reactor<typeof RPSSchema, ServerMsg> = (
  { before, after },
  dispatch,
) => {
  const wasBothLocked =
    Object.values(before.game.players).length === 2 &&
    Object.values(before.game.players).every((p) => p.locked);
  const isBothLocked =
    Object.values(after.game.players).length === 2 &&
    Object.values(after.game.players).every((p) => p.locked);

  if (!wasBothLocked && isBothLocked) {
    dispatch({ type: "BOTH_LOCKED" });
  }
};

// Detects revealing status, determines winner
const resolveReactor: Reactor<typeof RPSSchema, ServerMsg> = (
  { before, after },
  dispatch,
) => {
  if (before.game.status !== "revealing" && after.game.status === "revealing") {
    const [[id1, p1], [id2, p2]] = Object.entries(after.game.players);

    const result = determineWinner(p1.choice, p2.choice, id1, id2);

    dispatch({ type: "RESOLVE", result });
  }
};

const serverDoc = createTypedDoc(RPSSchema);
const server = createRuntime({
  doc: serverDoc,
  update: serverUpdate,
  reactors: [bothLockedReactor, resolveReactor],
});

// In reality, aliceDoc, bobDoc, and serverDoc are the SAME document
// connected via CRDT sync. We show them separately to emphasize
// that each process has its own runtime.

// Play a game!
alice.dispatch({ type: "CONSIDERING", playerId: "alice", choice: "rock" });
alice.dispatch({ type: "CONSIDERING", playerId: "alice", choice: "paper" }); // Changed mind!
alice.dispatch({ type: "LOCK_IN", playerId: "alice" });

bob.dispatch({ type: "CONSIDERING", playerId: "bob", choice: "scissors" });
bob.dispatch({ type: "LOCK_IN", playerId: "bob" });
// → Changes sync to server
// → bothLockedReactor fires → BOTH_LOCKED → status = "revealing"
// → resolveReactor fires → RESOLVE → result = "alice"
// → Result syncs back to Alice and Bob
```

**What this demonstrates:**

1. **Three distributed processes** — Alice's browser, Bob's browser, and server each run their own runtime
2. **State machine** — `choosing → revealing → resolved`
3. **Stability markers** — `locked` flag signals "I'm done choosing"; server reactor detects when both are locked
4. **Effects Are State** — Server reactor detects condition, dispatches message, update writes state
5. **Separation of concerns** — Clients only write to their own slot; server handles game-level transitions

> **Across Domains**
> This same pattern works for:
>
> - **Web**: Two players in browsers, server resolves
> - **Backend**: Two workers coordinate, supervisor resolves
> - **Agents**: Two AI agents negotiate, arbiter decides

---

## The Grand Unification

### Before LEA: Understanding TEA

TEA (The Elm Architecture) is a pattern for building applications with pure functions and immutable state. The core loop is simple: a **Model** holds state, a **View** renders it, user actions produce **Messages**, and an **Update** function computes the next Model. If you're unfamiliar with TEA, the [Elm Guide's Architecture section](https://guide.elm-lang.org/architecture/) is the definitive resource.

### LEA's Key Insight

LEA and TEA share a similar fundamental structure. The key insights are:

- **LEA is like TEA, but the Model is a pointer in time (Frontier), rather than a Value.**
- **In LEA, everything is a reactor.** Views, subscriptions, and effects are all the same pattern--functions that react to state transitions.

### The Core Architecture

```typescript
// Conceptual types
type Program<Schema, Msg> = {
  doc: TypedDoc<Schema>;
  update: UpdateFn<Schema, Msg>;
  reactors: Reactor<Schema, Msg>[];
};

type Reactor<Schema, Msg> = (
  transition: { before: TypedDoc<Schema>; after: TypedDoc<Schema> },
  dispatch: (msg: Msg) => void,
) => void | Promise<void>;
```

That's it. **Doc, Update, Reactors.** Three concepts that handle everything:

| Component    | Type                            | Purpose                            |
| ------------ | ------------------------------- | ---------------------------------- |
| **Doc**      | `TypedDoc<Schema>`              | The CRDT document (shared state)   |
| **Update**   | `(frontier, msg) → Frontier'`   | Apply message, return new frontier |
| **Reactors** | `(transition, dispatch) → void` | React to transitions               |

### The Mapping: TEA → LEA

| Concept     | TEA (In-Memory)                | LEA (CRDT-Native)                |
| :---------- | :----------------------------- | :------------------------------- |
| **Version** | `Model` (The value itself)     | `Frontier` (Pointer to history)  |
| **State**   | `Model` (identity fn)          | `state(doc, frontier)` (Derived) |
| **Msg**     | `Msg`                          | `Msg` (same concept)             |
| **Update**  | `(Model, Msg) → Model'`        | `(Frontier, Msg) → Frontier'`    |
| **Effect**  | `Cmd Msg` (Returned by update) | **State** (Written to CRDT)      |
| **View**    | `(Model) → UI`                 | Reactor that updates UI          |
| **History** | Ephemeral / None               | **The Document** (Persistent)    |

---

## The Core Equation

```
LEA:  (Frontier, Msg) → Frontier'
```

Where:

- **Frontier** = immutable model identifier (a point in causal history)
- **Msg** = incoming message, e.g. a user action (pure data)
- **Frontier'** = new immutable model identifier after state transition

---

## Everything Is a Reactor

The key insight that simplifies LEA: views, subscriptions, and effects are all **reactors**--functions that receive state transitions and can dispatch messages.

```typescript
type Reactor<Schema, Msg> = (
  transition: { before: TypedDoc<Schema>; after: TypedDoc<Schema> },
  dispatch: (msg: Msg) => void,
) => void | Promise<void>;
```

### Message Reactor (Replaces Subscriptions)

Dispatches messages based on state transitions:

```typescript
const sensorReactor: Reactor<Schema, Msg> = ({ before, after }, dispatch) => {
  if (after.status === "reviewing") {
    const response = after.sensors.responses[after.requestId];
    const wasNew = !before.sensors.responses[after.requestId];
    if (response && wasNew) {
      dispatch({ type: "RECEIVE_RESULT", feedback: response.feedback });
    }
  }
};
```

### Effect Reactor

Handles async I/O by writing results back to the document:

```typescript
const apiReactor: Reactor<Schema, Msg> = async (
  { before, after },
  dispatch,
) => {
  if (before.status !== "submitting" && after.status === "submitting") {
    const result = await fetch("/api/review", {
      method: "POST",
      body: JSON.stringify({ content: after.content }),
    });
    const data = await result.json();

    // Write result to sensors namespace
    change(doc, (draft) => {
      draft.sensors.responses[after.requestId] = data;
    });
  }
};
```

> **Across Domains**
>
> - **Web**: Effect reactor makes API call, writes response to sensors
> - **Backend**: Effect reactor processes job, writes result to database
> - **Agents**: Effect reactor calls LLM, writes response for other agents to see

---

## Effects Are State

This is the paradigm shift that makes LEA different from TEA.

### The Problem with Traditional Effects

In TEA, the update function returns both a new model AND a command:

```elm
update : Msg -> Model -> (Model, Cmd Msg)
```

This works for single-client apps, but in distributed systems:

- Open two tabs → two API calls → double the cost
- Two clients dispatch simultaneously → race conditions
- Offline client queues commands → conflicts on reconnect

### LEA's Solution: Writing State IS the Effect

In LEA, **there is no separate effect system**. When you write `{ status: "reviewing" }` to the CRDT, that state syncs to all peers. A server (or any peer designated as the "effect executor") sees the state change and triggers the API call exactly once.

```typescript
// Client writes state
change(doc, (draft) => {
  draft.status = "reviewing";
  draft.requestId = generateId();
});

// Server reactor (runs on server only) sees the transition
const serverReactor: Reactor<Schema, Msg> = async ({ before, after }) => {
  if (before.status !== "reviewing" && after.status === "reviewing") {
    // Make the API call exactly once
    const result = await callAI(after.content);

    // Write result back to document (syncs to all clients)
    change(doc, (draft) => {
      draft.sensors.responses[after.requestId] = result;
    });
  }
};
```

**The CRDT becomes the coordination layer.** No duplicate calls. No race conditions. No plumbing.

> **Across Domains**
>
> - **Web**: Write `{ status: "submitting" }` → server makes API call
> - **Backend**: Write `{ jobStatus: "pending" }` → worker processes job
> - **Agents**: Write `{ taskAssigned: "agent-2" }` → agent-2 sees it and acts

---

## The Spacetime Boundary

The CRDT document serves as a **typed I/O boundary**--the meeting point between the pure LEA core and the impure external universe.

```
    ┌──────────────┐                           ┌──────────────┐
    │   External   │                           │     LEA      │
    │    World     │                           │ (pure core)  │
    │   (impure)   │                           │              │
    └──────┬───────┘                           └──────┬───────┘
           │                                          │
           │    read/write                            │    read/write
           │                                          │
           ▼                                          ▼
    ┌─────────────────────────────────────────────────────────┐
    │                     CRDT DOCUMENT                       │
    │                                                         │
    │       The shared boundary where both sides meet.        │
    │                  All state lives here.                  │
    │                                                         │
    │              History: F₀ ← F₁ ← F₂ ← F_now              │
    └─────────────────────────────────────────────────────────┘
```

**Key insight:** Both the external universe and LEA interact with the document through reads and writes. The document is the single source of truth, and its append-only history enables time travel.

### The Frontier of Now

Reactors only fire at the frontier of "now". This is a feature, not a limitation:

```
Time ────────────────────────────────────────────────────────▶

     F₀        F₁        F₂        F₃        F₄ (now)
      │         │         │         │         │
      ▼         ▼         ▼         ▼         ▼
    ┌───┐     ┌───┐     ┌───┐     ┌───┐     ┌───┐
    │ S │────▶│ S │────▶│ S │────▶│ S │────▶│ S │  ← Reactors ONLY here
    └───┘     └───┘     └───┘     └───┘     └───┘
      ↑         ↑         ↑         ↑         ↑
   (history) (history) (history) (history)  (live)
```

**Key property**: Checking out a historical frontier does NOT trigger effects. Time travel is safe for debugging and inspection.

---

## Stability Markers: Solving the Atomicity Problem

### The Problem

LEA reactors detect state transitions via `{before, after}`. This works perfectly when state changes atomically. But in distributed systems, a "logical unit" of state may arrive in fragments:

- **Chunked data** from a streaming API (e.g., AI responses arriving token by token)
- **Contributions from multiple peers** (e.g., all participants submitting their parts)
- **Multi-step operations** that can't be batched into a single commit

The reactor sees each fragment as a separate transition, but the application needs to react to the **complete logical unit**, not the fragments.

### The Insight

**Writers know when a logical unit is complete. Reactors don't.**

The student knows when they've finished typing. The server knows when the AI has produced all its output. Each peer knows when their contribution is done. This knowledge exists at the point of writing--it just needs to be captured.

### The Solution

Writers explicitly mark semantic completeness in the document:

```typescript
const Schema = Shape.doc({
  // The data itself (arrives in chunks from streaming API)
  aiFeedback: Shape.struct({
    score: Shape.plain.number().nullable(),
    explanation: Shape.plain.string().nullable(), // Streams in token by token
    suggestions: Shape.list(Shape.plain.string()),
  }),

  // Stability marker (writer sets when ALL chunks have arrived)
  stability: Shape.struct({
    aiFeedbackComplete: Shape.plain.boolean(),
  }),
});
```

**Server writes chunks as they stream in, marks complete only at the end:**

```typescript
// Called repeatedly as tokens stream from the AI
function appendExplanationChunk(doc: TypedDoc, chunk: string) {
  change(doc, (draft) => {
    draft.aiFeedback.explanation = (draft.aiFeedback.explanation ?? "") + chunk;
    // NOT setting aiFeedbackComplete - more chunks coming
  });
}

// Called once when the AI finishes
function finalizeAIFeedback(
  doc: TypedDoc,
  score: number,
  suggestions: string[],
) {
  change(doc, (draft) => {
    draft.aiFeedback.score = score;
    draft.aiFeedback.suggestions = suggestions;
    draft.stability.aiFeedbackComplete = true; // ← NOW it's complete
  });
}
```

**With the stability marker**, the reactor fires exactly once when the writer signals completion:

```typescript
const feedbackReactor: Reactor<Schema, Msg> = ({ before, after }, dispatch) => {
  if (
    !before.stability.aiFeedbackComplete &&
    after.stability.aiFeedbackComplete
  ) {
    // Fires exactly once, after ALL chunks have arrived
    dispatch({
      type: "PROCESS_FEEDBACK",
      score: after.aiFeedback.score,
      explanation: after.aiFeedback.explanation,
    });
  }
};
```

### Multi-Peer Coordination Without a Coordinator

For scenarios where multiple peers contribute parts, each peer marks their own contribution as complete. The reactor computes aggregate stability:

```typescript
const Schema = Shape.doc({
  expectedPeers: Shape.list(Shape.plain.string()),
  contributions: Shape.record(
    Shape.struct({
      content: Shape.plain.string(),
      complete: Shape.plain.boolean(), // ← Per-peer stability marker
    }),
  ),
});

// Reactor computes aggregate stability from individual markers
const allContributionsReactor: Reactor<Schema, Msg> = (
  { before, after },
  dispatch,
) => {
  const wasComplete = before.expectedPeers.every(
    (p) => before.contributions[p]?.complete,
  );
  const isComplete = after.expectedPeers.every(
    (p) => after.contributions[p]?.complete,
  );

  if (!wasComplete && isComplete) {
    dispatch({ type: "ALL_CONTRIBUTIONS_RECEIVED" });
  }
};
```

No coordinator is needed--each peer marks their part, and the reactor detects when all parts are present.

### The Pattern

```
Writers mark completion    →    Document holds markers    →    Reactors detect edges
     (semantic)                      (state)                      (syntactic)
```

**Stability markers transform the semantic question "is this logically complete?" into a syntactic question "did this boolean change from false to true?"**

---

## The Four Pillars

### 1. Messages (Pure Data)

Messages describe what the user wants to do. They are plain objects with a `type` discriminator. Different programs may have different message types:

```typescript
// Client messages - what players can do
type ClientMsg =
  | {
      type: "CONSIDERING";
      playerId: string;
      choice: "rock" | "paper" | "scissors";
    }
  | { type: "LOCK_IN"; playerId: string };

// Server messages - game-level transitions
type ServerMsg = { type: "BOTH_LOCKED" } | { type: "RESOLVE"; result: string };
```

**Why Messages?**

- **Testable** - Pure data is easy to construct in tests
- **Serializable** - Can be logged, stored, or sent over the network
- **Debuggable** - Clear audit trail of user actions
- **Decoupled** - UI doesn't know about CRDT operations

### 2. State Derivation (Pure Function)

State is derived from the document at a specific frontier:

```typescript
function state<Schema>(doc: TypedDoc<Schema>, frontier: Frontiers): State {
  // Fork the document at the frontier to get a read-only snapshot
  const snapshot = ext(doc).forkAt(frontier);
  return snapshot.toJSON();
}
```

**Key Properties:**

- **Pure** - Same doc + same frontier = same state, always
- **Lazy** - Only compute state when needed
- **Time travel ready** - Any frontier gives you that point in history

### 3. Update (State Transition)

The update function transitions from one frontier to another. Different programs have different update functions that handle their own message types:

```typescript
// Client update - players only write to their own slot
const clientUpdate = createUpdate<typeof RPSSchema, ClientMsg>((doc, msg) => {
  switch (msg.type) {
    case "CONSIDERING":
      if (doc.game.players[msg.playerId]?.locked) return;
      change(doc, (d) => {
        d.game.players[msg.playerId] = { choice: msg.choice, locked: false };
      });
      break;

    case "LOCK_IN":
      if (!doc.game.players[msg.playerId]?.choice) return;
      change(doc, (d) => {
        d.game.players[msg.playerId].locked = true;
      });
      break;
  }
});

// Server update - handles game-level transitions
const serverUpdate = createUpdate<typeof RPSSchema, ServerMsg>((doc, msg) => {
  switch (msg.type) {
    case "BOTH_LOCKED":
      if (doc.game.status !== "choosing") return;
      change(doc, (d) => {
        d.game.status = "revealing";
      });
      break;

    case "RESOLVE":
      if (doc.game.status !== "revealing") return;
      change(doc, (d) => {
        d.game.result = msg.result;
        d.game.status = "resolved";
      });
      break;
  }
});
```

**Why separate update functions?**

- **Separation of concerns** - Clients write to their slots; server handles game state
- **No "fighting"** - Only one program writes to each field
- **Clear ownership** - Easy to reason about who can change what
- **Automatic merge** - Changes from all programs merge via CRDT

> **Loro Implementation Note**
> The `createUpdate` factory in `@loro-extended/lea` uses `shallowForkAt` for memory efficiency and `replayDiff` to merge changes back as LOCAL events (captured by UndoManager and sync). Other CRDT implementations may use different techniques.

### 4. Reactors (Unified Response Pattern)

Reactors respond to state transitions. They unify views, subscriptions, and effects:

```typescript
type Reactor<Schema, Msg> = (
  transition: { before: TypedDoc<Schema>; after: TypedDoc<Schema> },
  dispatch: (msg: Msg) => void,
) => void | Promise<void>;
```

**Why Reactors?**

- **Edge detection** - Compare `before` and `after` to detect transitions
- **Unified pattern** - Views, subscriptions, effects all work the same way
- **Composable** - Add/remove reactors freely
- **Testable** - Pure functions, easy to test in isolation

---

## The Runtime (Imperative Shell)

The runtime is the only impure part. It manages the document subscription and invokes reactors:

```typescript
function createRuntime<Schema, Msg>(program: Program<Schema, Msg>) {
  const { doc, update, reactors, done } = program;

  let isRunning = true;
  let previousFrontier = loro(doc).frontiers();

  // Dispatch applies the update and lets the subscription handle reactors
  function dispatch(msg: Msg): void {
    if (!isRunning) return;
    update(loro(doc).frontiers(), msg); // Runtime binds doc internally
  }

  // Subscribe to document changes - the SINGLE path for reactor invocation
  const unsubscribe = subscribe(doc, (event) => {
    if (!isRunning) return;

    // Skip checkout events (time travel doesn't trigger reactors)
    if (event.by === "checkout") {
      previousFrontier = loro(doc).frontiers();
      return;
    }

    // Create snapshots at before/after frontiers
    const before = ext(doc).forkAt(previousFrontier);
    const after = ext(doc).forkAt(loro(doc).frontiers());
    previousFrontier = loro(doc).frontiers();

    // Invoke all reactors with the transition
    for (const reactor of reactors) {
      try {
        const result = reactor({ before, after }, dispatch);
        if (result instanceof Promise) {
          result.catch(console.error);
        }
      } catch (error) {
        console.error("Reactor error:", error);
      }
    }
  });

  return {
    dispatch,
    dispose(): void {
      if (isRunning) {
        isRunning = false;
        unsubscribe();
        done?.(loro(doc).frontiers());
      }
    },
  };
}
```

**Key Runtime Features:**

1. **Functional, not class-based** - No `this`, no `new`, just closures
2. **Transition-based** - Reactors receive `{ before, after }` for edge detection
3. **External change handling** - Document changes from other peers trigger reactors
4. **Error isolation** - Reactor errors are caught and logged; other reactors continue
5. **Clean disposal** - Returns a `dispose` function for cleanup

> **Loro Implementation Note**
> The runtime skips events where `event.by === "checkout"`. This means checking out a historical frontier for inspection does NOT trigger reactors--time travel is safe.

---

## External Systems and the Document

External systems (servers, browser APIs, other clients) interact with the document through a **sensors/actuators** pattern:

```typescript
const Schema = Shape.doc({
  // Application state (LEA manages this)
  app: AppStateSchema,

  // Sensor namespace (external systems write here)
  sensors: Shape.struct({
    clipboard: Shape.plain.string().nullable(),
    serverTime: Shape.plain.number(),
    apiResponses: Shape.record(Shape.plain.any()),
  }),

  // Actuator namespace (LEA writes here, external systems read & act)
  actuators: Shape.struct({
    copyToClipboard: Shape.plain.string().nullable(),
    sendNotification: Shape.plain
      .struct({
        title: Shape.plain.string(),
        body: Shape.plain.string(),
      })
      .nullable(),
  }),
});
```

**Why This Works:**

LEA's purity is preserved because:

- LEA only cares about **state derivation** (pure function of doc + frontier)
- LEA only cares about **update logic** (deterministic given frontier + msg)
- LEA only cares about **reactor invocation** (pure function of transition)

External writes just create new frontiers. LEA handles them like any other state change.

> **Across Domains**
>
> - **Web**: Browser events → sensors; actuators → DOM/clipboard
> - **Backend**: Message queue → sensors; actuators → external APIs
> - **Agents**: Other agents' outputs → sensors; actuators → agent actions

---

## State Machines with Discriminated Unions

LEA works especially well with discriminated union state machines:

```typescript
const GameStateSchema = Shape.plain.discriminatedUnion("status", {
  choosing: Shape.plain.struct({
    status: Shape.plain.literal("choosing"),
    players: Shape.record(PlayerSchema),
  }),
  revealing: Shape.plain.struct({
    status: Shape.plain.literal("revealing"),
    players: Shape.record(PlayerSchema),
  }),
  resolved: Shape.plain.struct({
    status: Shape.plain.literal("resolved"),
    players: Shape.record(PlayerSchema),
    result: Shape.plain.string(), // "alice" | "bob" | "draw"
  }),
});
```

**Why discriminated unions?**

- **Type safety** - TypeScript knows which fields exist in each state
- **Exhaustive handling** - Switch statements catch missing cases
- **Clear transitions** - Each state has explicit entry/exit points
- **Self-documenting** - State machine is visible in the schema

---

## Mathematical Foundation

```
Let:
  D = Document (complete causal history, append-only)
  F = Set of all Frontiers
  M = Set of all Messages
  S = Set of all States

Functions (given D):
  state:    F → S                  -- Derive state (pure)
  update:   F × M → F              -- Transition to new frontier
  reactor:  (S × S) × dispatch → * -- React to transitions

Key Properties:
  1. Determinism:
     ∀ f ∈ F: state(f) is deterministic

  2. Replayability:
     ∀ f ∈ F: state(f) can be computed at any time

  3. Edge Detection:
     Reactors receive (before, after), enabling transition detection
```

---

## LEA vs TEA

| Aspect           | TEA                           | LEA                                   |
| ---------------- | ----------------------------- | ------------------------------------- |
| Model            | Immutable value               | Immutable frontier (identifier)       |
| Message          | Pure data                     | Pure data                             |
| Update           | `(Model, Msg) → (Model, Cmd)` | `(Frontier, Msg) → Frontier`          |
| Effects          | Returned as `Cmd`             | Written as state (triggers reactors)  |
| View             | `(Model) → UI`                | Reactor that updates UI               |
| Subscriptions    | External events (time, ports) | Reactors that dispatch on transitions |
| Persistence      | External                      | Built-in (CRDT)                       |
| Sync             | External                      | Built-in (CRDT)                       |
| Time travel      | Manual                        | Built-in (frontiers)                  |
| Offline          | External                      | Built-in                              |
| Concurrent edits | N/A                           | Built-in (CRDT merge)                 |

### What LEA Preserves from TEA

- **Unidirectional data flow** - Messages flow down, state flows up
- **Pure update logic** - Deterministic state transitions
- **Centralized logic** - All transitions in one place
- **Testable** - Messages are pure data, state derivation is pure

### What LEA Adds

- **Automatic persistence** - State survives refresh
- **Automatic sync** - Multi-tab, multi-device
- **Causal context** - Messages are implicitly anchored to frontiers
- **Conflict resolution** - CRDT handles concurrent edits
- **Time travel** - Frontiers give you any point in history
- **Effects as state** - No separate effect system needed
- **Edge detection** - Reactors see `{ before, after }` for transitions

---

## Testing

### Unit Testing State Derivation (Pure!)

```typescript
describe("state derivation", () => {
  it("derives state at a specific frontier", () => {
    const doc = createTypedDoc(RPSSchema);
    change(doc, (draft) => {
      draft.game = { status: "choosing", players: {}, result: null };
    });
    const frontier = loro(doc).frontiers();

    const result = state(doc, frontier);

    expect(result.game.status).toBe("choosing");
    expect(Object.keys(result.game.players)).toHaveLength(0);
  });
});
```

### Unit Testing Update (Deterministic!)

```typescript
describe("clientUpdate", () => {
  it("records player choice", () => {
    const doc = createTypedDoc(RPSSchema);
    change(doc, (d) => {
      d.game = { status: "choosing", players: {}, result: null };
    });

    clientUpdate(doc, loro(doc).frontiers(), {
      type: "CONSIDERING",
      playerId: "alice",
      choice: "rock",
    });

    expect(doc.game.players["alice"].choice).toBe("rock");
    expect(doc.game.players["alice"].locked).toBe(false);
  });

  it("sets locked but does NOT change status", () => {
    const doc = createTypedDoc(RPSSchema);
    change(doc, (d) => {
      d.game = {
        status: "choosing",
        players: {
          alice: { choice: "rock", locked: true },
          bob: { choice: "scissors", locked: false },
        },
        result: null,
      };
    });

    clientUpdate(doc, loro(doc).frontiers(), { type: "LOCK_IN", playerId: "bob" });

    expect(doc.game.players["bob"].locked).toBe(true);
    expect(doc.game.status).toBe("choosing"); // Still choosing!
  });
});

describe("serverUpdate", () => {
  it("transitions to revealing on BOTH_LOCKED", () => {
    const doc = createTypedDoc(RPSSchema);
    change(doc, (d) => {
      d.game = { status: "choosing", players: {}, result: null };
    });

    serverUpdate(doc, loro(doc).frontiers(), { type: "BOTH_LOCKED" });

    expect(doc.game.status).toBe("revealing");
  });
});
```

### Unit Testing Reactors (Pure!)

```typescript
describe("bothLockedReactor", () => {
  it("dispatches BOTH_LOCKED when both players become locked", () => {
    const before = createSnapshot({
      game: {
        status: "choosing",
        players: {
          alice: { choice: "rock", locked: true },
          bob: { choice: "scissors", locked: false },
        },
        result: null,
      },
    });
    const after = createSnapshot({
      game: {
        status: "choosing",
        players: {
          alice: { choice: "rock", locked: true },
          bob: { choice: "scissors", locked: true },
        },
        result: null,
      },
    });

    const dispatched: ServerMsg[] = [];
    bothLockedReactor({ before, after }, (msg) => dispatched.push(msg));

    expect(dispatched).toEqual([{ type: "BOTH_LOCKED" }]);
  });
});

describe("resolveReactor", () => {
  it("dispatches RESOLVE when status becomes revealing", () => {
    const before = createSnapshot({
      game: { status: "choosing", players: {}, result: null },
    });
    const after = createSnapshot({
      game: {
        status: "revealing",
        players: {
          alice: { choice: "rock", locked: true },
          bob: { choice: "scissors", locked: true },
        },
        result: null,
      },
    });

    const dispatched: ServerMsg[] = [];
    resolveReactor({ before, after }, (msg) => dispatched.push(msg));

    expect(dispatched).toHaveLength(1);
    expect(dispatched[0].type).toBe("RESOLVE");
  });
});
```

---

## Advanced Topics

### Time Travel Debugging with Commit Messages

Store serialized messages as commit messages to understand _why_ the document is in its current state:

```typescript
function createDispatchWithHistory<Msg>(doc: TypedDoc, update: UpdateFn<Msg>) {
  return (msg: Msg) => {
    const frontier = loro(doc).frontiers();

    // Store the message as the commit message
    loro(doc).setNextCommitMessage(
      JSON.stringify({
        type: (msg as any).type,
        msg,
        frontier: frontier.map((f) => `${f.counter}@${f.peer}`),
      }),
    );

    update(doc, frontier, msg);
  };
}

// Use with either client or server update
const clientDispatch = createDispatchWithHistory(doc, clientUpdate);
const serverDispatch = createDispatchWithHistory(doc, serverUpdate);
```

### Speculative Execution with `forkAt`

Preview the effect of a message without committing:

```typescript
function previewChoice(
  doc: TypedDoc<typeof RPSSchema>,
  playerId: string,
  choice: "rock" | "paper" | "scissors",
): GameState {
  const frontier = loro(doc).frontiers();
  const forkedDoc = ext(doc).forkAt(frontier);

  // Apply the choice to the fork
  clientUpdate(forkedDoc, frontier, { type: "CONSIDERING", playerId, choice });

  // Return the resulting state (original doc unchanged)
  return state(forkedDoc, loro(forkedDoc).frontiers());
}
```

### Concurrent Messages and CRDT Merge

When two users dispatch messages concurrently, the CRDT layer handles merging:

```typescript
// Alice and Bob both consider choices at the same frontier (concurrent)
alice.dispatch({ type: "CONSIDERING", playerId: "alice", choice: "rock" });
bob.dispatch({ type: "CONSIDERING", playerId: "bob", choice: "scissors" });

// After sync, both considerations are in the document
// Each player's slot is independent - no conflict!
```

**Key insight**: Messages don't need to commute--the _operations they generate_ commute, which the CRDT guarantees.

### Offline-First Patterns

LEA naturally supports offline-first applications:

1. **Messages apply locally** - When offline, messages are applied to the local CRDT
2. **Sync on reconnect** - CRDT operations sync automatically when connectivity returns
3. **Conflicts resolve** - CRDT merge semantics handle any concurrent changes

---

## Web Application Patterns

LEA provides specific patterns for web applications, including:

- **View Doc**: Separating "what exists" (App Doc) from "what I'm looking at" (View Doc)
- **Browser History Integration**: Modeling navigation as undo/redo operations
- **Cross-Doc Reactors**: Coordinating multiple documents
- **React Integration**: Hooks for connecting LEA to React components

See [LEA for Web Applications](./lea-web.md) for detailed patterns.

---

## Glossary

- **Frontier**: A CRDT version vector representing a point in causal history. Immutable identifier for a state.

- **Reactor**: A function that responds to state transitions. Receives `{ before, after }` and can dispatch messages or perform side effects.

- **Transition**: A pair of before/after states representing a state change. Reactors detect edges by comparing these.

- **Sensor**: External system input written to the document. External systems write here; LEA reads.

- **Actuator**: Document state that triggers external system actions. LEA writes here; external systems read and act.

- **Stability Marker**: A boolean flag indicating semantic completeness. Writers set it when a logical unit is complete; reactors detect the `false→true` edge.

- **Spacetime Boundary**: The document as the meeting point between pure LEA code and the impure external world. All I/O flows through the document.

---

## Summary

LEA provides a rigorous, pure functional foundation for CRDT-native applications:

1. **Doc** - The CRDT document (shared state boundary)
2. **Update** - Deterministic state transition returning new frontier
3. **Reactors** - Unified pattern for views, subscriptions, and effects

The key insights:

- **LEA is TEA where the Model is a Pointer** - Frontiers are immutable identifiers, not values
- **Everything is a Reactor** - Views, subscriptions, and effects all use the same pattern
- **Effects are State** - Writing to the CRDT _is_ the effect mechanism
- **The Document is the I/O Boundary** - Both LEA and external systems read/write here
- **The Frontier of Now** - Effects only happen at the edge of now, but understanding can reach into the past
- **Stability Markers** - Writers mark semantic completeness; reactors detect edges on markers
- **Multiple Programs, One Document** - Different peers (client, server) have different update functions and reactors, but share the same document

**LEA** -- The Loro Extended Architecture: TEA + Time for CRDT-native applications.

---

```
Version: 4.1
Published: 2025-01-24
```
