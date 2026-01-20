# LEA: Loro-Extended Architecture

LEA is an architectural pattern for building applications with CRDT-backed state machines. It combines the predictability of The Elm Architecture (TEA) with the persistence and synchronization capabilities of CRDTs.

## Core Concepts

### The Problem

Traditional web applications face these challenges:

1. **State loss** - Browser crashes, refreshes, and tab closures lose in-progress work
2. **Cross-device friction** - Continuing work on another device requires explicit "save" actions
3. **Multi-tab confusion** - Multiple tabs can show inconsistent state
4. **State machine complexity** - Managing transitions between states is error-prone

CRDTs solve persistence and sync, but integrating them with application state machines requires a clear pattern.

### The Solution: LEA

LEA provides a structured approach:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              LEA Data Flow                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   User Action                                                               │
│       │                                                                     │
│       ▼                                                                     │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  Intention (Pure Data)                                              │   │
│   │  { type: "START_TASK" }                                             │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│       │                                                                     │
│       ▼                                                                     │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  dispatch(intention)                                                │   │
│   │  └── handle.change(draft => interpret(draft, intention))            │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│       │                                                                     │
│       ▼                                                                     │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  interpret(draft, intention)                                        │   │
│   │  - Checks guard conditions                                          │   │
│   │  - Mutates draft (CRDT operations)                                  │   │
│   │  - Batches multiple field updates                                   │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│       │                                                                     │
│       ▼                                                                     │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  CRDT Layer (Loro)                                                  │   │
│   │  - Operations committed                                             │   │
│   │  - Synced to other tabs/devices                                     │   │
│   │  - Persisted to storage                                             │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│       │                                                                     │
│       ▼                                                                     │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  React Re-render                                                    │   │
│   │  - useRefValue triggers update                                      │   │
│   │  - View reflects new state                                          │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## The Four Pillars

### 1. Intentions (Pure Data)

Intentions describe what the user wants to do, not how to do it. They are plain TypeScript objects with a `type` discriminator:

```typescript
type TaskIntention =
  | { type: "UPDATE_TITLE"; title: string }
  | { type: "PUBLISH" }
  | { type: "START" }
  | { type: "BLOCK"; reason: string }
  | { type: "COMPLETE" };
```

**Why Intentions?**

- **Testable** - Pure data is easy to construct in tests
- **Serializable** - Can be logged, stored, or sent over the network
- **Debuggable** - Clear audit trail of user actions
- **Decoupled** - UI doesn't know about CRDT operations

### 2. Interpret (State Transitions)

The `interpret` function applies an intention to the CRDT state. It contains all state transition logic:

```typescript
function interpret(
  draft: Mutable<typeof TaskDocSchema>,
  intention: TaskIntention,
): void {
  const state = draft.task.state;

  switch (intention.type) {
    case "PUBLISH":
      // Guard condition: can only publish from draft
      if (state.status !== "draft") return;

      // Transition: draft → todo
      draft.task.state = {
        status: "todo",
        title: state.title,
        description: "",
        createdAt: state.createdAt,
      };
      break;

    case "START":
      // Guard condition: can only start from todo
      if (state.status !== "todo") return;

      // Transition: todo → in_progress
      draft.task.state = {
        status: "in_progress",
        title: state.title,
        description: state.description,
        startedAt: Date.now(),
      };
      break;

    // ... other transitions
  }
}
```

**Key Properties:**

- **Guard conditions** - Invalid transitions are no-ops (return early)
- **Batched mutations** - Multiple fields update atomically
- **Impure but isolated** - Mutations happen only within `change()`
- **Deterministic** - Same state + same intention = same result

### 3. Dispatch (The Bridge)

The `dispatch` function connects React to the CRDT layer:

```typescript
function useTask(handle: Handle<typeof TaskDocSchema>) {
  const { value: task } = useRefValue(handle.doc.task.state);

  const dispatch = useCallback(
    (intention: TaskIntention) => {
      handle.change((draft) => {
        interpret(draft, intention);
      });
    },
    [handle],
  );

  return { task, dispatch };
}
```

**What dispatch does:**

1. Wraps the intention in `handle.change()`
2. Calls `interpret()` with the draft
3. Commits all changes atomically
4. Triggers sync to other tabs/devices

### 4. Refs as Model

In traditional TEA, the Model is an immutable snapshot. In LEA, the Model is a collection of **Refs** - live pointers into CRDT state:

```typescript
// Traditional TEA
const model: { title: string; count: number } = { title: "Hello", count: 0 };
// Must replace entire model on each update

// LEA
const handle = useHandle(DOC_ID, TaskDocSchema);
// handle.doc.task.state is a Ref - stable reference, value changes
// Reading is O(1) per path, not O(N) for entire document
```

**Benefits:**

- **Lazy reading** - Only read what you need
- **Fine-grained reactivity** - `useRefValue(ref)` subscribes to specific containers
- **No serialization overhead** - No `toJSON()` on every render

## State Machines with Discriminated Unions

LEA works especially well with discriminated union state machines:

```typescript
const TaskStateSchema = Shape.plain.discriminatedUnion("status", {
  draft: Shape.plain.struct({
    status: Shape.plain.string("draft"),
    title: Shape.plain.string(),
    createdAt: Shape.plain.number(),
  }),
  todo: Shape.plain.struct({
    status: Shape.plain.string("todo"),
    title: Shape.plain.string(),
    description: Shape.plain.string(),
    createdAt: Shape.plain.number(),
  }),
  in_progress: Shape.plain.struct({
    status: Shape.plain.string("in_progress"),
    title: Shape.plain.string(),
    description: Shape.plain.string(),
    startedAt: Shape.plain.number(),
  }),
  // ... more states
});
```

**Why discriminated unions?**

- **Type safety** - TypeScript knows which fields exist in each state
- **Exhaustive handling** - Switch statements catch missing cases
- **Clear transitions** - Each state has explicit entry/exit points
- **Self-documenting** - State machine is visible in the schema

## React Integration

### View Components

Views render based on the current state:

```typescript
function TaskCard() {
  const handle = useHandle(TASK_DOC_ID, TaskDocSchema);
  const { task, dispatch } = useTask(handle);

  switch (task.status) {
    case "draft":
      return (
        <div className="task-card draft">
          <input
            value={task.title}
            onChange={(e) =>
              dispatch({ type: "UPDATE_TITLE", title: e.target.value })
            }
            placeholder="Task title..."
          />
          <button onClick={() => dispatch({ type: "PUBLISH" })}>Publish</button>
        </div>
      );

    case "todo":
      return (
        <div className="task-card todo">
          <h2>{task.title}</h2>
          <button onClick={() => dispatch({ type: "START" })}>
            Start Working
          </button>
        </div>
      );

    // ... other states
  }
}
```

### Conditional Actions

Show only valid actions for the current state:

```typescript
function TaskActions({ task, dispatch }: TaskActionsProps) {
  return (
    <div className="actions">
      {task.status === "draft" && (
        <button onClick={() => dispatch({ type: "PUBLISH" })}>Publish</button>
      )}
      {task.status === "todo" && (
        <button onClick={() => dispatch({ type: "START" })}>Start</button>
      )}
      {task.status === "in_progress" && (
        <>
          <button onClick={() => dispatch({ type: "COMPLETE" })}>
            Complete
          </button>
          <button
            onClick={() =>
              dispatch({ type: "BLOCK", reason: "Waiting for review" })
            }
          >
            Block
          </button>
        </>
      )}
      {/* Archive is available from any state except archived */}
      {task.status !== "archived" && (
        <button onClick={() => dispatch({ type: "ARCHIVE" })}>Archive</button>
      )}
    </div>
  );
}
```

## Comparison with TEA

| Aspect       | TEA                               | LEA                            |
| ------------ | --------------------------------- | ------------------------------ |
| Model        | Immutable snapshot                | Live Refs into CRDT            |
| Update       | Pure function returning new Model | Impure function mutating draft |
| Persistence  | External (localStorage, server)   | Built-in (CRDT)                |
| Sync         | External (WebSocket, polling)     | Built-in (CRDT sync)           |
| Messages     | Trigger re-render                 | Trigger CRDT operations        |
| Side effects | Via Cmd/Effect                    | Via Asks (RPC) or direct       |

### What LEA Preserves from TEA

- **Unidirectional data flow** - Actions flow down, state flows up
- **Predictable updates** - Same intention + same state = same result
- **Centralized logic** - All transitions in `interpret()`
- **Testable** - Intentions are pure data, interpret is deterministic

### What LEA Adds

- **Automatic persistence** - State survives refresh
- **Automatic sync** - Multi-tab, multi-device
- **Lazy reading** - O(1) access to specific paths
- **Conflict resolution** - CRDT handles concurrent edits

## Testing

### Unit Testing Interpret

```typescript
import { createTypedDoc } from "@loro-extended/change";
import { interpret } from "./interpret";
import { TaskDocSchema } from "./schema";

describe("interpret", () => {
  it("transitions from draft to todo on PUBLISH", () => {
    const doc = createTypedDoc(TaskDocSchema);
    doc.change((draft) => {
      draft.task.state = {
        status: "draft",
        title: "My Task",
        createdAt: 1000,
      };
    });

    doc.change((draft) => {
      interpret(draft, { type: "PUBLISH" });
    });

    const state = doc.task.state.toJSON();
    expect(state.status).toBe("todo");
    expect(state.title).toBe("My Task");
    expect(state.description).toBe("");
  });

  it("ignores PUBLISH when not in draft state", () => {
    const doc = createTypedDoc(TaskDocSchema);
    doc.change((draft) => {
      draft.task.state = {
        status: "todo",
        title: "My Task",
        description: "Description",
        createdAt: 1000,
      };
    });

    doc.change((draft) => {
      interpret(draft, { type: "PUBLISH" });
    });

    // State unchanged
    expect(doc.task.state.toJSON().status).toBe("todo");
  });
});
```

### Integration Testing with React

```typescript
import { render, screen, fireEvent } from "@testing-library/react";
import { RepoProvider } from "@loro-extended/react";
import { TaskCard } from "./task-card";

describe("TaskCard", () => {
  it("shows Publish button in draft state", () => {
    render(
      <RepoProvider>
        <TaskCard />
      </RepoProvider>,
    );

    expect(screen.getByText("Publish")).toBeInTheDocument();
  });

  it("transitions to todo when Publish is clicked", async () => {
    render(
      <RepoProvider>
        <TaskCard />
      </RepoProvider>,
    );

    fireEvent.click(screen.getByText("Publish"));

    // Now in todo state
    expect(await screen.findByText("Start Working")).toBeInTheDocument();
  });
});
```

## Advanced Patterns

### Async Operations with Asks

For operations that require server-side processing, combine LEA with Asks:

```typescript
type TaskIntention =
  | { type: "SUBMIT_FOR_REVIEW" }
  | { type: "RECEIVE_REVIEW_RESULT"; approved: boolean; feedback: string }

function interpret(draft, intention) {
  switch (intention.type) {
    case "SUBMIT_FOR_REVIEW":
      if (state.status !== "in_progress") return

      // Create an Ask for server-side review
      const askId = crypto.randomUUID()
      draft.rpc.asks.set(askId, {
        question: { taskId: state.id, content: state.description },
        answers: {},
      })

      // Transition to reviewing state
      draft.task.state = {
        status: "reviewing",
        askId,
        submittedAt: Date.now(),
        // ... other fields
      }
      break

    case "RECEIVE_REVIEW_RESULT":
      if (state.status !== "reviewing") return

      draft.task.state = intention.approved
        ? { status: "approved", feedback: intention.feedback, ... }
        : { status: "needs_changes", feedback: intention.feedback, ... }
      break
  }
}
```

### Multiple State Machines

For complex apps, compose multiple state machines:

```typescript
const AppDocSchema = Shape.doc({
  // Each entity has its own state machine
  tasks: Shape.record(TaskStateSchema),
  projects: Shape.record(ProjectStateSchema),
  user: Shape.struct({
    auth: AuthStateSchema,
    preferences: PreferencesSchema,
  }),
})

// Separate interpret functions for each domain
function interpretTask(draft, taskId, intention) { ... }
function interpretProject(draft, projectId, intention) { ... }
function interpretAuth(draft, intention) { ... }
```

### Notifications for Async Results

When async results arrive after the user has moved on:

```typescript
function interpret(draft, intention) {
  switch (intention.type) {
    case "RECEIVE_REVIEW_RESULT":
      // Update the task state
      draft.tasks.get(intention.taskId).state = { ... }

      // Create a notification if user is viewing a different task
      if (draft.ui.currentTaskId !== intention.taskId) {
        draft.notifications.push({
          id: crypto.randomUUID(),
          type: "review_complete",
          taskId: intention.taskId,
          message: intention.approved ? "Task approved!" : "Changes requested",
          createdAt: Date.now(),
          acknowledged: false,
        })
      }
      break
  }
}
```

## Best Practices

### 1. Keep Intentions Granular

```typescript
// ❌ Too coarse
type Intention = { type: "UPDATE_TASK"; task: Partial<Task> };

// ✅ Granular
type Intention =
  | { type: "UPDATE_TITLE"; title: string }
  | { type: "UPDATE_DESCRIPTION"; description: string }
  | { type: "SET_PRIORITY"; priority: number };
```

### 2. Guard Conditions First

```typescript
function interpret(draft, intention) {
  switch (intention.type) {
    case "START":
      // ✅ Guard first, then mutate
      if (state.status !== "todo") return

      draft.task.state = { status: "in_progress", ... }
      break
  }
}
```

### 3. Batch Related Mutations

```typescript
// ✅ All fields update atomically in one change()
draft.task.state = {
  status: "in_progress",
  title: state.title,
  description: state.description,
  startedAt: Date.now(), // New field
};
```

### 4. Use TypeScript Exhaustiveness

```typescript
function TaskCard({ task, dispatch }) {
  switch (task.status) {
    case "draft": return <DraftView ... />
    case "todo": return <TodoView ... />
    case "in_progress": return <InProgressView ... />
    case "blocked": return <BlockedView ... />
    case "done": return <DoneView ... />
    case "archived": return <ArchivedView ... />
    // TypeScript error if a case is missing
  }
}
```

### 5. Separate Read and Write Concerns

```typescript
// ✅ Read via useRefValue (reactive)
const { value: task } = useRefValue(handle.doc.task.state);

// ✅ Write via dispatch (batched)
dispatch({ type: "START" });
```

## Summary

LEA provides a structured approach to building CRDT-backed applications:

1. **Intentions** - Pure data describing user actions
2. **Interpret** - Centralized state transition logic with guard conditions
3. **Dispatch** - Bridge between React and CRDT via `change()`
4. **Refs as Model** - Live pointers into CRDT state for lazy, reactive reading

The pattern preserves TEA's predictability while adding automatic persistence, sync, and conflict resolution through CRDTs.
