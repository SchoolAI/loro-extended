# Quiz Challenge -- LEA 3.0 Demo

This example demonstrates **LEA 3.0** (Loro Extended Architecture), the unified reactor pattern for CRDT-native applications.

## LEA 3.0: Doc, State, Update, Reactors

LEA 3.0 simplifies the architecture to just four concepts:

| Component    | Type                                             | Purpose                            |
| ------------ | ------------------------------------------------ | ---------------------------------- |
| **Doc**      | `TypedDoc<Schema>`                               | The CRDT document (shared state)   |
| **State**    | `(frontier) → S`                                 | Derive state from history          |
| **Update**   | `(frontier, msg) → Frontier'`                    | Apply message, return new frontier |
| **Reactors** | `(transition, dispatch) → void \| UI \| Promise` | React to transitions               |

### The Key Insight: Everything Is a Reactor

Views, subscriptions, and effects are all **reactors**--functions that receive state transitions and can dispatch messages:

```typescript
type Reactor<S, Msg> = (
  transition: { before: S; after: S },
  dispatch: (msg: Msg) => void,
) => void | UI | Promise<void>;
```

## Reactors in This Demo

This quiz app demonstrates several reactor patterns:

### 1. Timer Reactor (Time-Based Effect)
Monitors elapsed time and dispatches `TIME_UP` when the question time limit expires:

```typescript
const timerReactor: Reactor = ({ before, after }, dispatch) => {
  if (after.quiz.state.status === "answering") {
    const elapsed = (Date.now() - after.quiz.state.startedAt) / 1000;
    if (elapsed >= QUESTION_TIME_LIMIT) {
      dispatch({ type: "TIME_UP" });
    }
  }
};
```

**Key Insight**: We store `startedAt` (a timestamp) in the CRDT, not `timeRemaining`.
The UI calculates time remaining locally. This ensures consistent timing across
multiple tabs/peers--no TICK messages that could cause double-counting when synced.

### 2. Sensor Reactor (Sensor → Dispatch)
Watches the sensors namespace for AI responses and dispatches when they arrive:

```typescript
const sensorReactor: Reactor = ({ before, after }, dispatch) => {
  if (after.quiz.state.status === "submitted") {
    const response = after.sensors.feedbackResponses[requestId];
    if (!before.sensors.feedbackResponses[requestId] && response) {
      dispatch({ type: "RECEIVE_FEEDBACK", ...response });
    }
  }
};
```

### 3. AI Feedback Reactor (Effect Reactor - SERVER SIDE)
Performs async I/O and writes results to the sensors namespace.

**This reactor runs on the SERVER**, not the client. This ensures:
- Feedback is generated exactly once (not duplicated across tabs)
- The server is the single source of truth for AI responses
- All clients receive the same feedback via CRDT sync

```typescript
// In server.ts - runs as part of server-side LEA Program
const aiFeedbackReactor: Reactor = async ({ before, after }) => {
  if (entered("submitted", before, after)) {
    const feedback = await callAI(after.quiz.state);
    change(doc, (draft) => {
      draft.sensors.feedbackResponses[requestId] = feedback;
    });
  }
};
```

### 4. Toast Reactor (Observation Reactor)
Shows notifications on state transitions:

```typescript
const toastReactor: Reactor = ({ before, after }) => {
  if (entered("reviewing", before, after)) {
    showToast(after.quiz.state.isCorrect ? "🎉 Correct!" : "❌ Incorrect");
  }
};
```

## State Machine

```
idle → answering → submitted → reviewing → (next_question | complete)
         ↑                         │
         └─────────────────────────┘
```

## History Panel (Time Travel Debugging)

This demo includes a **History Panel** that demonstrates LEA's time travel capabilities:

### Opening the Panel
Click the **📜 History** button in the top-right corner to open the fly-out panel.

### What You'll See
- A chronological list of all state transitions (messages dispatched)
- Each entry shows the message type (e.g., "🚀 Started Quiz", "👆 Selected Option")
- Timestamps for when each action occurred

### Restoring Historical State
Click **Restore** on any entry to view the app at that point in time:
- The document "checks out" to that historical frontier
- A yellow banner appears: "📜 Viewing historical state"
- The quiz card shows the exact state at that moment
- Click **Return to Live** to go back to the current state

### How It Works
1. **Commit Messages**: Each `dispatch()` stores the message as a commit annotation via `setNextCommitMessage()`
2. **History Retrieval**: `getMessageHistory()` traverses change ancestors using `travelChangeAncestors()`
3. **Time Travel**: `checkout(frontier)` moves the document to a historical state (detached mode)
4. **Return to Live**: `checkoutToLatest()` re-attaches the document to the latest version

**Key LEA Principle**: Reactors only fire at the "Frontier of Now". Checking out historical states is safe for inspection--no timers start, no AI calls trigger, no side effects occur.

## Running the Demo

```bash
# From the repo root
pnpm install
pnpm --filter example-task-card dev
```

Then open http://localhost:5173 in your browser.

## File Structure

```
src/
├── shared/                    # Shared between client and server
│   ├── schema.ts              # Document schema with sensors namespace
│   ├── messages.ts            # Message types (user actions + system events)
│   ├── update.ts              # State derivation + update function
│   ├── update.test.ts         # Tests for update function
│   ├── reactor-types.ts       # Reactor type definitions
│   ├── runtime.ts             # The imperative shell (stores commit messages)
│   ├── history.ts             # History retrieval utilities
│   └── history.test.ts        # Tests for history utilities
│
├── client/                    # Browser-only code
│   ├── app.tsx                # Client app entry (history panel integration)
│   ├── quiz-card.tsx          # UI components
│   ├── history-panel.tsx      # Time travel debugging panel
│   ├── use-quiz.ts            # React hook integrating LEA 3.0
│   ├── reactors.ts            # Client reactors (timer, sensor, toast)
│   └── styles.css             # Styling (includes history panel styles)
│
└── server/                    # Node.js-only code
    ├── server.ts              # Server entry with LEA Program
    └── reactors.ts            # Server reactors (AI feedback)
```

## Client/Server Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         CLIENT                                   │
│                                                                  │
│   LEA Program                                                    │
│   ├── timerReactor      (dispatches TIME_UP)                     │
│   ├── sensorReactor     (dispatches RECEIVE_FEEDBACK)            │
│   └── toastReactor      (shows notifications)                    │
│                                                                  │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           │  CRDT Sync (WebSocket)
                           │
┌──────────────────────────┴──────────────────────────────────────┐
│                         SERVER                                   │
│                                                                  │
│   LEA Program                                                    │
│   └── aiFeedbackReactor (writes to sensors.feedbackResponses)    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Key Insight**: Both client and server run LEA Programs with different reactors.
The CRDT document is the shared state boundary. Effects that should happen once
(like AI calls) run on the server; effects that should happen per-client (like
toasts) run on the client.

## Key Patterns Demonstrated

1. **Dispatch vs Change**:
   - `dispatch()` for state machine transitions (goes through `update()`)
   - `change()` for sensor data (raw data arriving from external systems)

2. **Edge Detection**: Reactors receive `{ before, after }` to detect transitions

3. **Sensors/Actuators**: External I/O flows through typed namespaces in the document

4. **Cleanup**: Timer reactor demonstrates lifecycle management

5. **Time in Messages (Pure Update Pattern)**:
   Messages that need real time include a `timestamp` field:
   ```typescript
   dispatch({ type: "START_QUIZ", timestamp: Date.now() })
   ```
   The runtime captures `Date.now()` when creating the message, keeping
   the update function pure (same message → same state). This enables:
   - Deterministic replay for debugging
   - Consistent timing across tabs (timestamp syncs via CRDT)
   - Time travel that shows historical state correctly

## Learn More

See [docs/lea.md](/docs/lea.md) for the complete LEA 3.0 specification.
