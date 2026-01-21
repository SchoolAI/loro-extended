# LEA: The Loro Extended Architecture

LEA is a rigorous framework for building CRDT-native applications with pure functional principles. It extends The Elm Architecture (TEA) to work seamlessly with CRDTs while preserving purity and determinism.

**LEA is TEA + Time.**

### Before LEA: Understanding TEA

TEA (The Elm Architecture) is a pattern for building user interfaces with pure functions and immutable state. The core loop is simple: a **Model** holds state, a **View** renders it, user actions produce **Messages**, and an **Update** function computes the next Model. If you're unfamiliar with TEA, the [Elm Guide's Architecture section](https://guide.elm-lang.org/architecture/) is the definitive resource--the concepts translate directly to LEA.

## The Grand Unification

LEA and TEA share a similar fundamental structure. The key insights are:

- **LEA is like TEA, but the Model is a pointer in time (Frontier), rather than a Value.**
- **in LEA, everything is a reactor**. Views, subscriptions, and effects are all the same pattern--functions that react to state transitions.

### The Core Architecture

```typescript
type Program<S, Msg> = {
  doc: TypedDoc<S>;
  state: (frontier: Frontiers) => Infer<S>;
  update: (frontier: Frontiers, msg: Msg) => Frontiers;
  reactors: Reactor<Infer<S>, Msg>[];
};

type Reactor<S, Msg> = (
  transition: { before: S; after: S },
  dispatch: (msg: Msg) => void,
) => void | UI | Promise<void>;
```

That's it. **Doc, State, Update, Reactors.** Four concepts that handle everything:

| Component    | Type                                             | Purpose                            |
| ------------ | ------------------------------------------------ | ---------------------------------- |
| **Doc**      | `TypedDoc<Schema>`                               | The CRDT document (shared state)   |
| **State**    | `(frontier) → S`                                 | Derive state from history          |
| **Update**   | `(frontier, msg) → Frontier'`                    | Apply message, return new frontier |
| **Reactors** | `(transition, dispatch) → void \| UI \| Promise` | React to transitions               |

### The Mapping

| Concept     | TEA (In-Memory)                | LEA (CRDT-Native)                |
| :---------- | :----------------------------- | :------------------------------- |
| **Version** | `Model` (The value itself)     | `Frontier` (Pointer to history)  |
| **State**   | `Model` (identity fn; State)   | `state(doc, frontier)` (Derived) |
| **Msg**     | `Msg`                          | `Msg` (same concept)             |
| **Update**  | `(Model, Msg) → Model'`        | `(Frontier, Msg) → Frontier'`    |
| **Effect**  | `Cmd Msg` (Returned by update) | **State** (Written to CRDT)      |
| **View**    | `(Model) → UI`                 | Reactor that returns UI          |
| **History** | Ephemeral / None               | **The Document** (Persistent)    |

## The Core Equation

```
LEA:  (Frontier, Msg) → Frontier'
```

Where:

- **Frontier** = immutable model identifier (a point in causal history)
- **Msg** = incoming message, e.g. a user action (pure data)
- **Frontier'** = new immutable model identifier after state transition

## Everything Is a Reactor

The key insight that simplifies LEA: views, subscriptions, and effects are all **reactors**--functions that receive state transitions and can dispatch messages.

```typescript
type Reactor<S, Msg> = (
  transition: { before: S; after: S },
  dispatch: (msg: Msg) => void,
) => void | UI | Promise<void>;
```

### View Reactor

Renders UI, can detect edges for animations and toasts:

```typescript
const viewReactor: Reactor<State, Msg> = ({ before, after }, dispatch) => {
  const justCompleted =
    before.status !== "complete" && after.status === "complete";

  return (
    <>
      {justCompleted && <Confetti />}
      <App state={after} dispatch={dispatch} />
    </>
  );
};
```

### Message Reactor (Replaces Subscriptions)

Dispatches messages based on state transitions:

```typescript
const sensorReactor: Reactor<State, Msg> = ({ before, after }, dispatch) => {
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
const apiReactor: Reactor<State, Msg> = async ({ before, after }, dispatch) => {
  if (before.status !== "submitting" && after.status === "submitting") {
    const result = await fetch("/api/review", {
      method: "POST",
      body: JSON.stringify({ content: after.content }),
    });
    const data = await result.json();

    // Write result to sensors namespace
    doc.change((draft) => {
      draft.sensors.responses[after.requestId] = data;
    });
  }
};
```

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

## Mathematical Foundation

```
Let:
  D = Document (complete causal history, append-only)
  F = Set of all Frontiers
  M = Set of all Messages
  S = Set of all States

Functions:
  state:    D × F → S              -- Derive state (pure)
  update:   D × F × M → F          -- Transition to new frontier
  reactor:  (S × S) × dispatch → * -- React to transitions

Key Properties:
  1. Determinism:
     ∀ d ∈ D, ∀ f ∈ F: state(d, f) is deterministic

  2. Replayability:
     ∀ f ∈ F: state(d, f) can be computed at any time

  3. Edge Detection:
     Reactors receive (before, after), enabling transition detection
```

## The Problem LEA Solves

### Modern Apps Are Distributed by Default

Today's web applications aren't just "user opens browser, talks to server." They're distributed systems:

- **Multiple devices** - Phone, tablet, laptop, desktop--users expect their work to follow them
- **Multiple tabs** - Users open the same app in several tabs without thinking about it
- **Multiple participants** - Collaboration isn't just "multiplayer"--it includes AI assistants editing alongside humans
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
- **How do I trigger side effects?** (AI calls, notifications, timers--without duplicating them across tabs)
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

## The Four Pillars

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
function state<Schema>(
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

### 3. Update (State Transition)

The update function transitions from one frontier to another. LEA uses a **fork-and-merge** pattern that provides a clean mental model: work on a single document object for both reading and writing.

#### The createUpdate Factory (Recommended)

Use `createUpdate` to create update functions with fork-and-merge semantics:

```typescript
import { createUpdate, change, loro } from "@loro-extended/change";

function createUpdate<Schema extends DocShape, Msg>(
  handler: (doc: TypedDoc<Schema>, msg: Msg, timestamp: number) => void
): (doc: TypedDoc<Schema>, frontier: Frontiers, msg: Msg) => Frontiers {
  return (doc, frontier, msg) => {
    // 1. Fork at the frontier - this becomes the "working doc"
    const workingDoc = doc.forkAt(frontier);
    
    // 2. Set peer ID to match main doc (ensures consistent frontier)
    loro(workingDoc).doc.setPeerId(loro(doc).doc.peerId);
    
    // 3. Compute timestamp from frontier
    const timestamp = getTimestampFromFrontier(frontier);
    
    // 4. Let handler read/write to the working doc
    handler(workingDoc, msg, timestamp);
    
    // 5. Merge changes back into main doc
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

Now define your update logic with a single `doc` parameter:

```typescript
const update = createUpdate<typeof TimerSchema, TimerMsg>((doc, msg, timestamp) => {
  // Read and write to the same object - it's a fork!
  const timer = doc.timer;
  
  switch (msg.type) {
    case "START":
      if (timer.status !== "stopped" && timer.status !== "paused") return;
      change(doc, draft => {
        draft.timer.status = "running";
        draft.timer.startedAt = timestamp;
      });
      break;

    case "PAUSE":
      if (timer.status !== "running") return;
      change(doc, draft => {
        draft.timer.status = "paused";
        draft.timer.pausedAt = timestamp;
      });
      break;

    case "RESET":
      change(doc, draft => {
        draft.timer.status = "stopped";
        draft.timer.elapsed = 0;
      });
      break;

    case "TICK":
      if (timer.status !== "running") return;
      change(doc, draft => {
        draft.timer.elapsed = timer.elapsed + 1;
      });
      break;
  }
});
```

**Why fork-and-merge?**

- **Single object** - No confusion between `state` and `write` variables
- **Natural mental model** - "Work on the doc, changes get applied"
- **Impossible to misuse** - Read from `doc`, mutate via `change(doc, ...)`
- **Automatic merge** - Changes flow back to the main document

**Key Properties:**

- **Guard conditions** - Read directly from the forked doc
- **Deterministic timestamps** - Derived from frontier, not `Date.now()`
- **Effects via state** - Writing to CRDT triggers external systems
- **Peer ID preservation** - Fork uses same peer ID for consistent frontiers

### 4. Reactors (Unified Response Pattern)

Reactors respond to state transitions. They unify views, subscriptions, and effects:

```typescript
type Reactor<S, Msg> = (
  transition: { before: S; after: S },
  dispatch: (msg: Msg) => void,
) => void | UI | Promise<void>;
```

**Why Reactors?**

- **Edge detection** - Compare `before` and `after` to detect transitions
- **Unified pattern** - Views, subscriptions, effects all work the same way
- **Composable** - Add/remove reactors freely
- **Testable** - Pure functions, easy to test in isolation

## The Runtime (Imperative Shell)

The runtime is the only impure part. It manages the document subscription and invokes reactors:

```typescript
export type Dispatch<Msg> = (msg: Msg) => void;
export type Disposer = () => void;

export type Program<Schema extends DocShape, Msg> = {
  doc: TypedDoc<Schema>;
  state: (frontier: Frontiers) => Infer<Schema>;
  update: (frontier: Frontiers, msg: Msg) => Frontiers;
  reactors: Reactor<Infer<Schema>, Msg>[];
  done?: (frontier: Frontiers) => void;
};

export function runtime<Schema extends DocShape, Msg>(
  program: Program<Schema, Msg>,
): { dispatch: Dispatch<Msg>; dispose: Disposer } {
  const { doc, state, update, reactors, done } = program;

  let isRunning = true;
  let previousState = state(doc.frontiers());

  // Dispatch only writes to the document. Reactors are invoked by the
  // document subscription - this ensures reactors fire exactly once.
  function dispatch(msg: Msg): void {
    if (!isRunning) return;
    update(doc.frontiers(), msg);
    // NO reactor invocation here - let the subscription handle it
  }

  // Subscribe to document changes - this is the SINGLE path for reactor
  // invocation. Both local dispatches and remote peer changes flow through here.
  const unsubDoc = loro(doc).subscribe(() => {
    if (!isRunning) return;

    const before = previousState;
    const after = state(doc.frontiers());
    previousState = after;

    // Invoke all reactors with the transition
    for (const reactor of reactors) {
      const result = reactor({ before, after }, dispatch);
      if (result instanceof Promise) {
        result.catch(console.error);
      }
    }
  });

  return {
    dispatch,
    dispose(): void {
      if (isRunning) {
        isRunning = false;
        unsubDoc();
        if (done) {
          done(doc.frontiers());
        }
      }
    },
  };
}
```

**Key Runtime Features:**

1. **Functional, not class-based** - No `this`, no `new`, just closures
2. **Transition-based** - Reactors receive `{ before, after }` for edge detection
3. **External change handling** - Document changes from other peers trigger reactors
4. **Clean disposal** - Returns a `dispose` function for cleanup

## The Complete Picture

```typescript
// 1. Create the document (external to LEA)
const doc = createTypedDoc(TimerSchema);

// 2. Connect adapters (external to LEA)
const repo = new Repo({ doc });
repo.connect(websocketAdapter);

// 3. Define reactors
const viewReactor: Reactor<TimerState, TimerMsg> = (
  { before, after },
  dispatch,
) => {
  return <TimerView state={after} dispatch={dispatch} />;
};

const tickReactor: Reactor<TimerState, TimerMsg> = (
  { before, after },
  dispatch,
) => {
  // When timer starts running, begin ticking
  if (before.status !== "running" && after.status === "running") {
    const intervalId = setInterval(() => dispatch({ type: "TICK" }), 1000);
    // Store cleanup in document or external registry
  }
};

// 4. Define the LEA program
const timerProgram: Program<typeof TimerSchema, TimerMsg> = {
  doc,
  state: (frontier) => state(doc, frontier),
  update: (frontier, msg) => update(doc, frontier, msg),
  reactors: [viewReactor, tickReactor],
  done: (frontier) => console.log("Timer stopped at", frontier),
};

// 5. Start the runtime
const { dispatch, dispose } = runtime(timerProgram);

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
    showNotification: Shape.plain
      .struct({ title: Shape.plain.string(), body: Shape.plain.string() })
      .nullable(),
  }),
});
```

### External Adapter Example

```typescript
// Clipboard adapter - reads actuators, writes sensors
function clipboardAdapter(doc: TypedDoc<Schema>) {
  // Watch for copy requests (actuator)
  loro(doc).subscribe(() => {
    const toCopy = doc.actuators.copyToClipboard;
    if (toCopy) {
      navigator.clipboard.writeText(toCopy);
      doc.change((d) => {
        d.actuators.copyToClipboard = null;
      }); // Clear after handling
    }
  });

  // Listen for paste events (sensor)
  document.addEventListener("paste", async () => {
    const text = await navigator.clipboard.readText();
    doc.change((d) => {
      d.sensors.clipboard = text;
    });
  });
}
```

**Why This Works:**

LEA's purity is preserved because:

- LEA only cares about **state derivation** (pure function of doc + frontier)
- LEA only cares about **update logic** (deterministic given frontier + msg)
- LEA only cares about **reactor invocation** (pure function of transition)

External writes just create new frontiers. LEA handles them like any other state change. The only invariant LEA requires is that the document history is append-only and causally consistent--which Loro enforces.

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

| Aspect           | TEA                           | LEA                                   |
| ---------------- | ----------------------------- | ------------------------------------- |
| Model            | Immutable value               | Immutable frontier (identifier)       |
| Message          | Pure data                     | Pure data                             |
| Update           | `(Model, Msg) → (Model, Cmd)` | `(Frontier, Msg) → Frontier`          |
| Effects          | Returned as `Cmd`             | Written as state (triggers reactors)  |
| View             | `(Model) → UI`                | Reactor that returns UI               |
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

    const result = state(doc, frontier);

    expect(result.timer.status).toBe("stopped");
    expect(result.timer.elapsed).toBe(0);
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

    const result = state(doc, newFrontier);
    expect(result.timer.status).toBe("running");
  });

  it("ignores START when already running", () => {
    const doc = createTypedDoc(TimerSchema);
    change(doc, (draft) => {
      draft.timer = { status: "running", elapsed: 5, startedAt: 1000 };
    });
    const frontier = doc.frontiers();

    const newFrontier = update(doc, frontier, { type: "START" });

    const result = state(doc, newFrontier);
    expect(result.timer.status).toBe("running"); // Unchanged
  });
});
```

### Unit Testing Reactors (Pure!)

```typescript
describe("reactors", () => {
  it("dispatches RECEIVE_RESULT when response arrives", () => {
    const before: State = {
      status: "reviewing",
      requestId: "req_123",
      sensors: { responses: {} },
    };

    const after: State = {
      status: "reviewing",
      requestId: "req_123",
      sensors: {
        responses: {
          req_123: { feedback: "Great work!" },
        },
      },
    };

    const dispatched: Msg[] = [];
    sensorReactor({ before, after }, (msg) => dispatched.push(msg));

    expect(dispatched).toEqual([
      { type: "RECEIVE_RESULT", feedback: "Great work!" },
    ]);
  });

  it("does not dispatch when response already existed", () => {
    const response = { feedback: "Great work!" };

    const before: State = {
      status: "reviewing",
      requestId: "req_123",
      sensors: { responses: { req_123: response } },
    };

    const after: State = {
      status: "reviewing",
      requestId: "req_123",
      sensors: { responses: { req_123: response } },
    };

    const dispatched: Msg[] = [];
    sensorReactor({ before, after }, (msg) => dispatched.push(msg));

    expect(dispatched).toEqual([]); // No dispatch - response wasn't new
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
  return state(forkedDoc, forkedDoc.frontiers());
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

**Key insight**: Messages don't need to commute--the _operations they generate_ commute, which Loro guarantees.

### Offline-First Patterns

LEA naturally supports offline-first applications:

1. **Messages apply locally** - When offline, messages are applied to the local CRDT
2. **Sync on reconnect** - CRDT operations sync automatically when connectivity returns
3. **Conflicts resolve** - CRDT merge semantics handle any concurrent changes

## React Integration

```typescript
function useTimer(handle: Handle<typeof TimerSchema>) {
  const [timerState, setTimerState] = useState(() =>
    state(handle.doc, handle.doc.frontiers()),
  );
  const runtimeRef = useRef<{
    dispatch: Dispatch<TimerMsg>;
    dispose: Disposer;
  }>();

  useEffect(() => {
    const viewReactor: Reactor<TimerState, TimerMsg> = ({ after }) => {
      setTimerState(after);
    };

    runtimeRef.current = runtime({
      doc: handle.doc,
      state: (frontier) => state(handle.doc, frontier),
      update: (frontier, msg) => update(handle.doc, frontier, msg),
      reactors: [viewReactor],
    });

    return () => runtimeRef.current?.dispose();
  }, [handle]);

  const dispatch = useCallback((msg: TimerMsg) => {
    runtimeRef.current?.dispatch(msg);
  }, []);

  return { state: timerState, dispatch };
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

1. **Doc** - The CRDT document (shared state boundary)
2. **State** - Pure function from (doc, frontier) to state
3. **Update** - Deterministic state transition returning new frontier
4. **Reactors** - Unified pattern for views, subscriptions, and effects

The key insights:

- **LEA is TEA where the Model is a Pointer** - Frontiers are immutable identifiers, not values
- **Everything is a Reactor** - Views, subscriptions, and effects all use the same pattern
- **Effects are State** - Writing to the CRDT _is_ the effect mechanism
- **The Document is the I/O Boundary** - Both LEA and external systems read/write here
- **The Frontier of Now** - Effects only happen at the edge of now, but understanding can reach into the past

**LEA** -- The Loro Extended Architecture: TEA + Time for CRDT-native applications.

---

```
Version: 3.0
Published: 2026-01-21
```
