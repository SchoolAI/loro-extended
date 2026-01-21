# LEA: The Loro Extended Architecture

LEA is a rigorous framework for building CRDT-native applications with pure functional principles. It extends The Elm Architecture (TEA) to work seamlessly with CRDTs while preserving purity and determinism.

**LEA is TEA + Time.**

### Before LEA: Understanding TEA

TEA (The Elm Architecture) is a pattern for building user interfaces with pure functions and immutable state. The core loop is simple: a **Model** holds state, a **View** renders it, user actions produce **Messages**, and an **Update** function computes the next Model. If you're unfamiliar with TEA, the [Elm Guide's Architecture section](https://guide.elm-lang.org/architecture/) is the definitive resource—the concepts translate directly to LEA.

## The Grand Unification

LEA and TEA share the same fundamental structure. The key insight is that **LEA is simply TEA where the Model is a pointer in time (Frontier), rather than a Value.**

For those familiar with TEA, let's first show how both architectures can be unified. To make it less abstract, we'll use a "Timer" that keeps track of time as the model in the examples below.

```typescript
// The Generic Architecture Interface (we can build both TEA and LEA with this)
type Architecture<Version, State, Msg> = {
  init: () => Version;
  state: (v: Version) => State;
  view: (s: State, dispatch: (m: Msg) => void) => UI;
  subscriptions: (s: State, dispatch: (m: Msg) => void) => Unsubscribe[];
  update: (v: Version, m: Msg) => Version;
};
```

### TEA Instantiation

```typescript
// TEA: Version = State (identity function)
type TEA<Model, Msg> = Architecture<Model, Model, Msg>;

const teaRuntime: TEA<TimerModel, TimerMsg> = {
  init: () => initialModel,
  state: (model) => model, // Identity function! Version IS State
  view: (model, dispatch) => render(model, dispatch),
  subscriptions: (model, dispatch) =>
    model.status === "running"
      ? [subscribeToTime(() => dispatch({ type: "TICK" }))]
      : [],
  update: (model, msg) => reducer(model, msg),
};
```

### LEA Instantiation

```typescript
// LEA: Version = Frontier, State = Derived from Doc
type LEA<Schema, Msg> = Architecture<Frontiers, Infer<Schema>, Msg>;

// The document is created externally and passed to the LEA factory
const doc = createTypedDoc(TimerSchema);

const createLeaRuntime = (doc: TypedDoc<Schema>): LEA<Schema, TimerMsg> => ({
  init: () => doc.frontiers(),
  state: (frontier) => getStateAtFrontier(doc, frontier), // Derived!
  view: (state, dispatch) => render(state, dispatch),
  subscriptions: (state, dispatch) => deriveSubscriptions(state, dispatch),
  update: (frontier, msg) => {
    const state = getStateAtFrontier(doc, frontier);
    doc.change((draft) => applyMsg(draft, state, msg));
    return doc.frontiers();
  },
});

// later:
const leaRuntime = createLeaRuntime(doc);
```

### The Mapping

| Concept           | TEA (In-Memory)                | LEA (CRDT-Native)                |
| :---------------- | :----------------------------- | :------------------------------- |
| **Version**       | `Model` (The value itself)     | `Frontier` (Pointer to history)  |
| **State**         | `Model` (Model = State)        | `state(doc, frontier)` (Derived) |
| **Msg**           | `Msg`                          | `Msg` (same concept)             |
| **Update**        | `(Model, Msg) → Model'`        | `(Frontier, Msg) → Frontier'`    |
| **Effect**        | `Cmd Msg` (Returned by update) | **State** (Written to CRDT)      |
| **Subscriptions** | External events (time, ports)  | CRDT state changes (derived)     |
| **History**       | Ephemeral / None               | **The Document** (Persistent)    |

## The Core Equation

```
LEA:  (Frontier, Msg) → Frontier'
```

Where:

- **Frontier** = immutable model identifier (a point in causal history)
- **Msg** = incoming message, e.g. a user action (pure data)
- **Frontier'** = new immutable model identifier after state transition

## The Spacetime Boundary

The LoroDoc serves as a **typed I/O boundary**--the meeting point between the pure LEA core and the impure external universe.

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
    │                      LORO DOCUMENT                      │
    │                                                         │
    │       The shared boundary where both sides meet.        │
    │                  All state lives here.                  │
    │                                                         │
    │              History: F₀ ← F₁ ← F₂ ← F_now              │
    └─────────────────────────────────────────────────────────┘
```

**Key insight:** Both the external universe and LEA interact with the document through reads and writes. The document is the single source of truth, and its append-only history enables time travel.

### The Frontier of Now

Subscriptions only fire at the frontier of "now". This is a feature, not a limitation:

```
Time ────────────────────────────────────────────────────────▶

     F₀        F₁        F₂        F₃        F₄ (now)
      │         │         │         │         │
      ▼         ▼         ▼         ▼         ▼
    ┌───┐     ┌───┐     ┌───┐     ┌───┐     ┌───┐
    │ S │────▶│ S │────▶│ S │────▶│ S │────▶│ S │  ← Subscriptions ONLY here
    └───┘     └───┘     └───┘     └───┘     └───┘
      ↑         ↑         ↑         ↑         ↑
   (history) (history) (history) (history)  (live)

Time ────────────────────────────────────────────────────────▶
```

**Key property**: Checking out a historical frontier does NOT trigger effects. Time travel is safe for debugging and inspection.

## Mathematical Foundation

```
Let:
  D = Document (complete causal history, append-only)
  F = Set of all Frontiers
  M = Set of all Messages
  S = Set of all States

Functions:
  state:         D × F → S              -- Derive state (pure)
  subscriptions: S → Set<Subscription>  -- Derive subscriptions (pure)
  update:        D × F × M → F          -- Transition to new frontier

Key Properties:
  1. Determinism:
     ∀ d ∈ D, ∀ f ∈ F: state(d, f) is deterministic

  2. Subscription Determinism:
     ∀ s₁, s₂ ∈ S: s₁ = s₂ ⟹ subscriptions(s₁) = subscriptions(s₂)

  3. Replayability:
     ∀ f ∈ F: subscriptions(state(d, f)) can be computed at any time
```

## The Problem LEA Solves

### Modern Apps Are Distributed by Default

Today's web applications aren't just "user opens browser, talks to server." They're distributed systems:

- **Multiple devices** - Phone, tablet, laptop, desktop—users expect their work to follow them
- **Multiple tabs** - Users open the same app in several tabs without thinking about it
- **Multiple participants** - Collaboration isn't just "multiplayer"—it includes AI assistants editing alongside humans
- **Intermittent connectivity** - School WiFi drops, mobile networks flake, and users expect things to just work

### The Traditional Approach: API Plumbing

The traditional solution is extensive plumbing:

- Write API endpoints for every operation
- Shuttle data between client, server, and database
- Handle loading states, error states, retry logic
- Implement optimistic updates, then reconcile with server
- Build conflict resolution for every feature

This works, but it's slow to build and fragile. Teams spend weeks on sync bugs instead of features.

### What CRDTs Provide

CRDTs (like Loro) eliminate the plumbing for state synchronization:

- State syncs automatically across all devices and tabs
- Offline edits queue and merge correctly when connectivity returns
- No API endpoints needed for state changes
- No conflict resolution code--it's built into the data structure

### What's Still Missing

But CRDTs are a data structure, not an architecture. You still need to answer:

- **How do I structure my app logic?** (State machines, valid transitions, guards)
- **How do I trigger side effects?** (AI calls, notifications, timers—without duplicating them across tabs)
- **How do I keep my code testable?** (Pure functions, deterministic behavior)
- **How do I debug problems?** (Understanding why the app is in a particular state)

### What LEA Provides

LEA is the architecture layer that answers these questions:

- **State machines that work with CRDTs** - Discriminated unions, guard conditions, clear transitions
- **Effects without duplication** - Write state, and the effect happens once via sync (not from every tab)
- **Pure, testable logic** - Same inputs always produce same outputs
- **Full history with intent** - Every state change includes the message that caused it

### The Key Insight: Effects Are State

In traditional apps, each client makes its own API calls. Open two tabs → two AI calls → double the cost and conflicting results.

In LEA, **writing state IS the effect**. When you write `{ status: "reviewing" }` to the CRDT, that state syncs to the server, which triggers the AI call exactly once. All clients see the result.

The CRDT becomes the coordination layer. No duplicate calls. No race conditions. No plumbing.

## The Five Pillars

### 1. Messages (Pure Data)

Messages describe what the user wants to do. They are plain TypeScript objects with a `type` discriminator:

```typescript
type TimerMsg =
  | { type: "START" }
  | { type: "PAUSE" }
  | { type: "RESET" }
  | { type: "TICK" };
```

**Why Messages?**

- **Testable** - Pure data is easy to construct in tests
- **Serializable** - Can be logged, stored, or sent over the network
- **Debuggable** - Clear audit trail of user actions
- **Decoupled** - UI doesn't know about CRDT operations

### 2. State Derivation (Pure Function)

State is derived from the document at a specific frontier:

```typescript
function getStateAtFrontier<Schema>(
  doc: TypedDoc<Schema>,
  frontier: Frontiers,
): Infer<Schema> {
  const forkedDoc = loro(doc).doc.forkAt(frontier);
  return forkedDoc.toJSON();
}
```

**Key Properties:**

- **Pure** - Same doc + same frontier = same state, always
- **Lazy** - Only compute state when needed
- **Time travel ready** - Any frontier gives you that point in history

### 3. Subscriptions (Derived from State)

Subscriptions are **derived from state**, not returned from update. This is the key insight that replaces TEA's `Cmd`:

```typescript
import {
  PathSelector,
  PathBuilder,
  createPathBuilder,
} from "@loro-extended/change";

type Subscription<Msg> = {
  selector: PathSelector<unknown>; // Type-safe path to watch
  predicate: (value: unknown) => boolean; // When to fire
  msg: Msg | ((value: unknown) => Msg); // What to dispatch
};

// Create a path builder for type-safe path construction
const path = createPathBuilder(ChallengeSchema);

function deriveSubscriptions(
  state: ChallengeState,
): Subscription<ChallengeMsg>[] {
  // When reviewing, watch for the answer to arrive
  if (state.challenge.status === "reviewing") {
    return [
      {
        // Type-safe path using PathBuilder
        selector: path.asks.$key(state.challenge.askId).answers,

        // Fire when answers object has entries
        predicate: (answers) => Object.keys(answers as object).length > 0,

        // Derive message from the value
        msg: (answers) => ({
          type: "RECEIVE_RESULT",
          ...pickFirstAnswer(answers),
        }),
      },
    ];
  }

  return [];
}
```

**Why Subscriptions Instead of Cmd?**

In TEA, `update` returns `(Model, Cmd Msg)`. In LEA, `update` returns just `Frontier`. Where did `Cmd` go?

**Effects are State.** When you write `{ status: "reviewing" }` to the CRDT, that state change _is_ the effect. The existence of that state triggers external systems (via sync) and internal subscriptions (via state derivation).

**Why PathSelector?**

The `PathSelector` from `@loro-extended/change` provides:

1. **Type safety** - Paths are checked at compile time
2. **Runtime optimization** - The `__segments` property enables efficient path-based watching
3. **Dynamic paths** - Use `$key(id)` for dynamic keys, `$each` for wildcards
4. **Composability** - Build complex paths: `path.asks.$key(askId).answers`

**Formal Properties:**

1. **Determinism**: `subscriptions(s₁) = subscriptions(s₂)` when `s₁ = s₂`
2. **Replayability**: `subscriptions(state(doc, frontier))` computable at any frontier
3. **Compositionality**: Subscriptions compose from sub-states
4. **Efficiency**: Runtime only re-evaluates when watched paths change

### 4. Update (State Transition)

The update function transitions from one frontier to another:

```typescript
function update(
  doc: TypedDoc<Schema>,
  frontier: Frontiers,
  msg: TimerMsg,
): Frontiers {
  const state = getStateAtFrontier(doc, frontier);

  doc.change((draft) => {
    switch (msg.type) {
      case "START":
        if (state.status !== "stopped" && state.status !== "paused") return;
        draft.timer.status = "running";
        draft.timer.startedAt = getTimestampFromFrontier(frontier);
        break;

      case "PAUSE":
        if (state.status !== "running") return;
        draft.timer.status = "paused";
        draft.timer.pausedAt = getTimestampFromFrontier(frontier);
        break;

      case "RESET":
        draft.timer.status = "stopped";
        draft.timer.elapsed = 0;
        break;

      case "TICK":
        if (state.status !== "running") return;
        draft.timer.elapsed = state.elapsed + 1;
        break;
    }
  });

  return doc.frontiers();
}
```

**Key Properties:**

- **Guard conditions** - Invalid transitions are no-ops
- **Deterministic timestamps** - Derived from frontier, not `Date.now()`
- **Effects via state** - Writing to CRDT triggers external systems

### 5. The Runtime (Imperative Shell)

The runtime is the only impure part. It manages subscriptions and dispatches messages. Following the elegant functional style of [raj](https://github.com/andrejewski/raj), we use a simple `runtime()` function rather than a class:

```typescript
import {
  compileToJsonPath,
  evaluatePath,
  PathSelector,
} from "@loro-extended/change";

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export type Dispatch<Msg> = (msg: Msg) => void;
export type Disposer = () => void;

export type Program<Schema extends DocShape, Msg> = {
  doc: TypedDoc<Schema>;
  state: (frontier: Frontiers) => Infer<Schema>;
  subscriptions: (state: Infer<Schema>) => Subscription<Msg>[];
  update: (frontier: Frontiers, msg: Msg) => Frontiers;
  done?: (frontier: Frontiers) => void;
};

// ═══════════════════════════════════════════════════════════════════════════
// Runtime (functional, no classes)
// ═══════════════════════════════════════════════════════════════════════════

export function runtime<Schema extends DocShape, Msg>(
  program: Program<Schema, Msg>,
): { dispatch: Dispatch<Msg>; dispose: Disposer } {
  const { doc, state, subscriptions, update, done } = program;

  let frontier = doc.frontiers();
  let isRunning = true;
  const activeSubscriptions = new Map<string, () => void>();

  function dispatch(msg: Msg): void {
    if (isRunning) {
      frontier = update(frontier, msg);
      // Subscriptions reconcile via doc subscription, not here
    }
  }

  function reconcileSubscriptions(): void {
    if (!isRunning) return;

    const currentState = state(frontier);
    const desired = subscriptions(currentState);
    const newKeys = new Set<string>();

    // Subscribe to new
    for (const sub of desired) {
      const key = compileToJsonPath(sub.selector.__segments);
      newKeys.add(key);

      if (!activeSubscriptions.has(key)) {
        const unsub = subscribeToPath(sub);
        activeSubscriptions.set(key, unsub);
      }
    }

    // Unsubscribe from old
    for (const [key, unsub] of activeSubscriptions) {
      if (!newKeys.has(key)) {
        unsub();
        activeSubscriptions.delete(key);
      }
    }
  }

  function subscribeToPath(sub: Subscription<Msg>): () => void {
    const jsonPath = compileToJsonPath(sub.selector.__segments);

    return loro(doc).doc.subscribeJsonpath(jsonPath, () => {
      const value = evaluatePath(doc, sub.selector);
      if (sub.predicate(value)) {
        const msg = typeof sub.msg === "function" ? sub.msg(value) : sub.msg;
        dispatch(msg);
      }
    });
  }

  // Subscribe to doc changes to reconcile subscriptions
  const unsubDoc = loro(doc).subscribe(() => {
    frontier = doc.frontiers(); // Update frontier on external changes
    reconcileSubscriptions();
  });

  // Initial reconciliation
  reconcileSubscriptions();

  // Return dispatch and disposer
  return {
    dispatch,
    dispose(): void {
      if (isRunning) {
        isRunning = false;
        unsubDoc();
        for (const unsub of activeSubscriptions.values()) {
          unsub();
        }
        activeSubscriptions.clear();
        if (done) {
          done(frontier);
        }
      }
    },
  };
}
```

**Key Runtime Features:**

1. **Functional, not class-based** - No `this`, no `new`, just closures
2. **Path-based watching** - Uses `subscribeJsonpath` for efficient change detection
3. **Automatic reconciliation** - Subscriptions are reconciled on every state change
4. **Predicate filtering** - Only dispatches when the predicate returns true
5. **Clean disposal** - Returns a `dispose` function for cleanup

## The Complete Picture

```typescript
// 1. Create the document (external to LEA)
const doc = createTypedDoc(TimerSchema);

// 2. Connect adapters (external to LEA)
const repo = new Repo({ doc });
repo.connect(websocketAdapter);

// 3. Define the LEA program (pure data)
const timerProgram: Program<typeof TimerSchema, TimerMsg> = {
  doc,
  state: (frontier) => getStateAtFrontier(doc, frontier),
  subscriptions: deriveSubscriptions,
  update: (frontier, msg) => update(doc, frontier, msg),
  done: (frontier) => console.log("Timer stopped at", frontier),
};

// 4. Start the runtime (returns dispatch and dispose)
const { dispatch, dispose } = runtime(timerProgram);

// 5. External systems can interact with the doc
timeAdapter(doc); // Provides TICK messages when running

// 6. Use dispatch to send messages
dispatch({ type: "START" });

// 7. Clean up when done
dispose();
```

**Why the Document is External:**

The document must be created externally because:

1. **Lifecycle**: The doc may outlive any single LEA program instance
2. **Sharing**: Multiple LEA programs might share the same doc
3. **Persistence**: The doc connects to storage/sync adapters
4. **Testing**: Tests can create docs with specific initial states

## External Systems and the Document

External systems (servers, browser APIs, other clients) can also read from and write to the document. LEA handles these external writes just like any other state change—they create new frontiers that flow through the same pure derivation pipeline.

```typescript
// Example: A time adapter that writes to the document
function timeAdapter(doc: TypedDoc<Schema>) {
  let intervalId: number | null = null;

  // Watch the document for state changes
  loro(doc).subscribe(() => {
    const state = doc.timer;

    if (state.status === "running" && !intervalId) {
      // Start providing time updates
      intervalId = setInterval(() => {
        doc.change((d) => {
          d.currentTime = Date.now();
        });
      }, 1000);
    } else if (state.status !== "running" && intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
  });
}
```

**Why This Works:**

LEA's purity is preserved because:

- LEA only cares about **state derivation** (pure function of doc + frontier)
- LEA only cares about **subscription derivation** (pure function of state)
- LEA only cares about **update logic** (deterministic given frontier + msg)

External writes just create new frontiers. LEA handles them like any other state change. The only invariant LEA requires is that the document history is append-only and causally consistent—which Loro enforces.

## State Machines with Discriminated Unions

LEA works especially well with discriminated union state machines:

```typescript
const TimerStateSchema = Shape.plain.discriminatedUnion("status", {
  stopped: Shape.plain.struct({
    status: Shape.plain.literal("stopped"),
    elapsed: Shape.plain.number(),
  }),
  running: Shape.plain.struct({
    status: Shape.plain.literal("running"),
    elapsed: Shape.plain.number(),
    startedAt: Shape.plain.number(),
  }),
  paused: Shape.plain.struct({
    status: Shape.plain.literal("paused"),
    elapsed: Shape.plain.number(),
    pausedAt: Shape.plain.number(),
  }),
});
```

**Why discriminated unions?**

- **Type safety** - TypeScript knows which fields exist in each state
- **Exhaustive handling** - Switch statements catch missing cases
- **Clear transitions** - Each state has explicit entry/exit points
- **Self-documenting** - State machine is visible in the schema

## LEA vs TEA

| Aspect           | TEA                           | LEA                                       |
| ---------------- | ----------------------------- | ----------------------------------------- |
| Model            | Immutable value               | Immutable frontier (identifier)           |
| Message          | Pure data                     | Pure data                                 |
| Update           | `(Model, Msg) → (Model, Cmd)` | `(Frontier, Msg) → Frontier`              |
| Effects          | Returned as `Cmd`             | Written as state (triggers subscriptions) |
| Subscriptions    | External events (time, ports) | CRDT state changes                        |
| Persistence      | External                      | Built-in (CRDT)                           |
| Sync             | External                      | Built-in (CRDT)                           |
| Time travel      | Manual                        | Built-in (frontiers)                      |
| Offline          | External                      | Built-in                                  |
| Concurrent edits | N/A                           | Built-in (CRDT merge)                     |

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

## Testing

### Unit Testing State Derivation (Pure!)

```typescript
describe("state derivation", () => {
  it("derives state at a specific frontier", () => {
    const doc = createTypedDoc(TimerSchema);
    change(doc, (draft) => {
      draft.timer = { status: "stopped", elapsed: 0 };
    });
    const frontier = doc.frontiers();

    const state = getStateAtFrontier(doc, frontier);

    expect(state.timer.status).toBe("stopped");
    expect(state.timer.elapsed).toBe(0);
  });
});
```

### Unit Testing Subscriptions (Pure!)

```typescript
import { compileToJsonPath } from "@loro-extended/change";

describe("subscriptions", () => {
  it("derives subscriptions when reviewing", () => {
    const state: ChallengeState = {
      challenge: {
        status: "reviewing",
        answer: "42",
        askId: "ask_123",
        submittedAt: 1000,
      },
      asks: {},
    };

    const subs = deriveSubscriptions(state);

    expect(subs).toHaveLength(1);
    // Verify the path is correct
    const jsonPath = compileToJsonPath(subs[0].selector.__segments);
    expect(jsonPath).toBe('$.asks["ask_123"].answers');
  });

  it("derives no subscriptions when complete", () => {
    const state: ChallengeState = {
      challenge: {
        status: "complete",
        answer: "42",
        correct: true,
        feedback: "Great!",
        completedAt: 2000,
      },
      asks: {},
    };

    const subs = deriveSubscriptions(state);

    expect(subs).toHaveLength(0);
  });

  it("predicate returns true when answer exists", () => {
    const state: ChallengeState = {
      challenge: { status: "reviewing", askId: "ask_123", ... },
      asks: {},
    };

    const subs = deriveSubscriptions(state);
    const predicate = subs[0].predicate;

    // No answers yet
    expect(predicate({})).toBe(false);

    // Answer arrived
    expect(predicate({ "peer_1": { result: { correct: true } } })).toBe(true);
  });
});
```

### Unit Testing Update (Deterministic!)

```typescript
describe("update", () => {
  it("transitions from stopped to running on START", () => {
    const doc = createTypedDoc(TimerSchema);
    change(doc, (draft) => {
      draft.timer = { status: "stopped", elapsed: 0 };
    });
    const frontier = doc.frontiers();

    const newFrontier = update(doc, frontier, { type: "START" });

    const state = getStateAtFrontier(doc, newFrontier);
    expect(state.timer.status).toBe("running");
  });

  it("ignores START when already running", () => {
    const doc = createTypedDoc(TimerSchema);
    change(doc, (draft) => {
      draft.timer = { status: "running", elapsed: 5, startedAt: 1000 };
    });
    const frontier = doc.frontiers();

    const newFrontier = update(doc, frontier, { type: "START" });

    const state = getStateAtFrontier(doc, newFrontier);
    expect(state.timer.status).toBe("running"); // Unchanged
  });
});
```

## Advanced Topics

### Time Travel Debugging with Commit Messages

Store serialized messages as commit messages to understand _why_ the document is in its current state:

```typescript
function dispatch(msg: TimerMsg) {
  const frontier = doc.frontiers();

  // Store the message as the commit message
  loro(doc).doc.setNextCommitMessage(
    JSON.stringify({
      type: msg.type,
      msg,
      frontier: frontier.map((f) => `${f.counter}@${f.peer}`),
    }),
  );

  update(doc, frontier, msg);
}

// Retrieve message history
function getMessageHistory(doc: LoroDoc, fromFrontiers: Frontiers): TimerMsg[] {
  const messages: TimerMsg[] = [];

  doc.travelChangeAncestors(fromFrontiers, (change) => {
    if (change.message) {
      try {
        const parsed = JSON.parse(change.message);
        messages.push(parsed.msg);
      } catch {
        // Skip non-message commits
      }
    }
    return true;
  });

  return messages.reverse();
}
```

### Speculative Execution with `forkAt`

Preview the effect of a message without committing:

```typescript
function previewMessage(doc: TypedDoc<Schema>, msg: TimerMsg): TimerState {
  const frontier = doc.frontiers();
  const forkedDoc = loro(doc).doc.forkAt(frontier);

  // Apply the message to the fork
  update(forkedDoc, frontier, msg);

  // Return the resulting state (original doc unchanged)
  return getStateAtFrontier(forkedDoc, forkedDoc.frontiers());
}
```

### Concurrent Messages and CRDT Merge

When two users dispatch messages concurrently, the CRDT layer handles merging:

```typescript
// User A dispatches at frontier F1
dispatch({ type: "START" });

// User B dispatches at frontier F1 (same frontier, concurrent)
dispatch({ type: "RESET" });

// After sync, both operations are in the document
// The final state depends on CRDT semantics
```

**Key insight**: Messages don't need to commute—the _operations they generate_ commute, which Loro guarantees.

### Offline-First Patterns

LEA naturally supports offline-first applications:

1. **Messages apply locally** - When offline, messages are applied to the local CRDT
2. **Sync on reconnect** - CRDT operations sync automatically when connectivity returns
3. **Conflicts resolve** - CRDT merge semantics handle any concurrent changes

For "stale" messages (user intended X but state has changed):

```typescript
function dispatchWithStaleCheck(msg: TimerMsg): boolean {
  const frontier = doc.frontiers();
  const stateBefore = getStateAtFrontier(doc, frontier);

  update(doc, frontier, msg);

  const stateAfter = getStateAtFrontier(doc, doc.frontiers());

  if (JSON.stringify(stateBefore) === JSON.stringify(stateAfter)) {
    // Guard condition failed - state didn't change
    console.warn("Message rejected: guard condition failed");
    return false;
  }

  return true;
}
```

## React Integration

```typescript
function useTimer(handle: Handle<typeof TimerSchema>) {
  const state = useDoc(handle, (doc) => doc.timer) as TimerState;
  const runtimeRef = useRef<{
    dispatch: Dispatch<TimerMsg>;
    dispose: Disposer;
  }>();

  useEffect(() => {
    runtimeRef.current = runtime({
      doc: handle.doc,
      state: (frontier) => getStateAtFrontier(handle.doc, frontier),
      subscriptions: deriveSubscriptions,
      update: (frontier, msg) => update(handle.doc, frontier, msg),
    });

    return () => runtimeRef.current?.dispose();
  }, [handle]);

  const dispatch = useCallback((msg: TimerMsg) => {
    runtimeRef.current?.dispatch(msg);
  }, []);

  return { state, dispatch };
}

// Usage in component
function TimerView() {
  const { state, dispatch } = useTimer(handle);

  return (
    <div>
      <div>Elapsed: {state.elapsed}s</div>
      <div>Status: {state.status}</div>
      {state.status === "stopped" && (
        <button onClick={() => dispatch({ type: "START" })}>Start</button>
      )}
      {state.status === "running" && (
        <button onClick={() => dispatch({ type: "PAUSE" })}>Pause</button>
      )}
      {state.status === "paused" && (
        <>
          <button onClick={() => dispatch({ type: "START" })}>Resume</button>
          <button onClick={() => dispatch({ type: "RESET" })}>Reset</button>
        </>
      )}
    </div>
  );
}
```

## Summary

LEA provides a rigorous, pure functional foundation for CRDT-native applications:

1. **Messages** - Pure data describing user intent
2. **State Derivation** - Pure function from (doc, frontier) to state
3. **Subscriptions** - Derived from state, replace TEA's Cmd
4. **Update** - Deterministic state transition returning new frontier
5. **Runtime** - Imperative shell managing subscriptions

The key insights:

- **LEA is TEA where the Model is a Pointer** - Frontiers are immutable identifiers, not values
- **Effects are State** - Writing to the CRDT _is_ the effect mechanism
- **Subscriptions are Derived** - No separate effect system needed
- **The Document is the I/O Boundary** - Both LEA and external systems read/write here
- **The Frontier of Now** - Effects only happen at the edge of now, but understanding can reach into the past

**LEA** — The Loro Extended Architecture: TEA + Time for CRDT-native applications.

---

```
Version: 2.0
Published: 2026-01-20
```
