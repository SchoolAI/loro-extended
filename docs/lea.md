# LEA: The Loro Extended Architecture

LEA is a rigorous framework for building CRDT-native applications with pure functional principles. It extends The Elm Architecture (TEA) to work seamlessly with CRDTs while preserving purity and determinism.

## The Core Equation

```
LEA:  (Frontier, AnchoredIntention) → Frontier'
```

Where:

- **Frontier** = immutable model identifier (a point in causal history)
- **AnchoredIntention** = (Intention, Frontier) — user intent + causal context
- **Frontier'** = new immutable model identifier after state transition

## The Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    The Loro Extended Architecture (LEA)                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  MODEL = Frontier                                                           │
│  └── Immutable identifier for a point in causal history                     │
│      Uniquely determines state: state(doc, frontier) → State                │
│                              │                                              │
│                              ▼                                              │
│  VIEW = render(state(doc, frontier))                                        │
│  └── Pure function from Frontier to UI                                      │
│      Uses Refs for efficient lazy state access                              │
│                              │                                              │
│                              ▼                                              │
│  INTENTION = pure data describing user intent                               │
│  └── { type: "SUBMIT_ANSWER", challengeId: "q1", answer: "42" }             │
│                              │                                              │
│                              ▼                                              │
│  ANCHORED INTENTION = (Intention, Frontier)                                 │
│  └── Intent + causal context = the "Message" in TEA terms                   │
│                              │                                              │
│                              ▼                                              │
│  INTERPRET = interpret(doc, intention, frontier) → Operations               │
│  └── PURE FUNCTION! Same inputs always produce same outputs                 │
│                              │                                              │
│                              ▼                                              │
│  APPLY = applyOperations(doc, operations) → Frontier'                       │
│  └── Isolated mutation, returns new immutable frontier                      │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Mathematical Foundation

```
Let:
  D = Document (complete causal history, append-only)
  F = Set of all Frontiers
  I = Set of all Intentions
  O = Set of all Operations

Functions:
  state:     D × F → S           -- Derive state (pure)
  interpret: D × I × F → O*      -- Compute operations (PURE!)
  apply:     D × O* → F          -- Apply ops, get new frontier

Key Property:
  ∀ d ∈ D, ∀ i ∈ I, ∀ f ∈ F:
    interpret(d, i, f) is deterministic
```

## The Problem LEA Solves

Traditional web applications face these challenges:

1. **State loss** - Browser crashes, refreshes, and tab closures lose in-progress work
2. **Cross-device friction** - Continuing work on another device requires explicit "save" actions
3. **Multi-tab confusion** - Multiple tabs can show inconsistent state
4. **State machine complexity** - Managing transitions between states is error-prone
5. **Impure update functions** - Side effects (like `Date.now()`) make testing and reasoning difficult

CRDTs solve persistence and sync, but integrating them with application state machines requires a clear pattern that preserves functional purity.

## The Four Pillars

### 1. Intentions (Pure Data)

Intentions describe what the user wants to do, not how to do it. They are plain TypeScript objects with a `type` discriminator:

```typescript
type TaskIntention =
  | { type: "UPDATE_TITLE"; title: string }
  | { type: "PUBLISH" }
  | { type: "START" }
  | { type: "BLOCK"; reason: string }
  | { type: "COMPLETE" }
```

**Why Intentions?**

- **Testable** - Pure data is easy to construct in tests
- **Serializable** - Can be logged, stored, or sent over the network
- **Debuggable** - Clear audit trail of user actions
- **Decoupled** - UI doesn't know about CRDT operations

### 2. Anchored Intentions (Intent + Context)

An anchored intention pairs user intent with causal context:

```typescript
type AnchoredIntention<I> = {
  intention: I
  frontier: Frontiers  // The causal context when intention was created
  timestamp: number    // Wall-clock time (for display, not logic)
}
```

The frontier captures "what state did the user see when they made this decision?" This is crucial for:

- **Deterministic interpretation** - Same anchored intention always produces same operations
- **Conflict detection** - Know if state changed between intent and application
- **Time travel** - Replay intentions from any point in history

### 3. Interpret (Pure State Transitions)

The `interpret` function computes what operations to perform. It is **pure**:

```typescript
import { loro, type Frontiers, type TypedDoc } from "@loro-extended/change"

/**
 * Derive state at a given frontier using forkAt.
 */
function getStateAtFrontier(
  doc: TypedDoc<typeof TaskDocSchema>,
  frontier: Frontiers,
): TaskState {
  const forkedDoc = doc.forkAt(frontier)
  return forkedDoc.task.state
}

/**
 * Derive a logical timestamp from the frontier.
 * Sum of counters gives monotonically increasing logical time.
 */
function getTimestampFromFrontier(frontier: Frontiers): number {
  return frontier.reduce((sum, f) => sum + f.counter + 1, 0)
}

/**
 * Pure interpret function - the heart of LEA.
 */
function interpret(
  doc: TypedDoc<typeof TaskDocSchema>,
  intention: TaskIntention,
  frontier: Frontiers,
): Operation[] {
  // Derive state from (doc, frontier) - PURE
  const state = getStateAtFrontier(doc, frontier)

  // Derive timestamp from frontier - PURE
  const timestamp = getTimestampFromFrontier(frontier)

  switch (intention.type) {
    case "PUBLISH":
      // Guard condition: can only publish from draft
      if (state.status !== "draft") return []

      // Return operations to perform (not mutations!)
      return [
        {
          type: "SET_TASK_STATE",
          value: {
            status: "todo",
            title: state.title,
            description: "",
            createdAt: state.createdAt,
          },
        },
      ]

    case "START":
      // Guard condition: can only start from todo
      if (state.status !== "todo") return []

      return [
        {
          type: "SET_TASK_STATE",
          value: {
            status: "in_progress",
            title: state.title,
            description: state.description,
            startedAt: timestamp, // Derived from frontier!
          },
        },
      ]

    // ... other transitions
  }

  return []
}
```

**Key Properties:**

- **Pure** - No side effects, no mutations, no `Date.now()` calls
- **Deterministic** - Same inputs always produce same outputs
- **Guard conditions** - Invalid transitions return empty operations
- **Returns operations** - Describes what to do, doesn't do it
- **Time travel ready** - Uses frontier to derive both state AND timestamp

### 4. Apply (Isolated Mutation)

The `apply` function executes operations and returns a new frontier:

```typescript
function apply(
  doc: TypedDoc<Schema>,
  operations: Operation[],
): Frontiers {
  doc.change(draft => {
    for (const op of operations) {
      switch (op.type) {
        case "SET_TASK_STATE":
          draft.task.state = op.value
          break
        // ... other operation types
      }
    }
  })

  return doc.frontiers()
}
```

**Key Properties:**

- **Isolated** - All mutation happens here, nowhere else
- **Returns frontier** - New immutable model identifier
- **Atomic** - All operations commit together

## The Dispatch Bridge

The `dispatch` function connects React to the LEA architecture:

```typescript
import { loro } from "@loro-extended/change"

function useTask(handle: Handle<typeof TaskDocSchema>) {
  const task = useDoc(handle, doc => doc.task.state) as TaskState

  const dispatch = useCallback(
    (intention: TaskIntention) => {
      // Capture frontier at dispatch time (the "anchored" context)
      // This gives us both state and logical timestamp
      const frontier = loro(handle.doc).doc.frontiers()

      // Pure interpretation: compute operations from (doc, intention, frontier)
      const operations = interpret(handle.doc, intention, frontier)

      // Isolated mutation: apply operations
      if (operations.length > 0) {
        handle.change(draft => {
          apply(draft, operations)
        })
      }
    },
    [handle],
  )

  return { task, dispatch }
}
```

**What dispatch does:**

1. Captures the current frontier via `loro(doc).doc.frontiers()`
2. Calls pure `interpret(doc, intention, frontier)` to compute operations
3. Calls `apply(draft, operations)` inside `handle.change()` for isolated mutation
4. CRDT layer handles sync automatically

## Frontiers as Model

In traditional TEA, the Model is an immutable value that gets replaced on each update. In LEA, the Model is a **Frontier** - an immutable identifier for a point in causal history:

```typescript
import { loro } from "@loro-extended/change"

// Traditional TEA
const model: TaskState = { status: "draft", title: "Hello" }
// Must replace entire model on each update

// LEA
const frontier: Frontiers = loro(doc).doc.frontiers()
// Frontier is an identifier; state is derived: state(doc, frontier)
```

**Benefits:**

- **Immutable identity** - Frontiers never change; we get new ones
- **Lazy state derivation** - Only compute state when needed
- **Time travel** - Any frontier gives you that point in history
- **Efficient comparison** - Compare frontiers, not deep state

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
})
```

**Why discriminated unions?**

- **Type safety** - TypeScript knows which fields exist in each state
- **Exhaustive handling** - Switch statements catch missing cases
- **Clear transitions** - Each state has explicit entry/exit points
- **Self-documenting** - State machine is visible in the schema

## LEA vs TEA

| Aspect           | TEA                   | LEA                                   |
| ---------------- | --------------------- | ------------------------------------- |
| Model            | Immutable value       | Immutable frontier (identifier)       |
| Message          | Pure data             | Anchored intention (intent + context) |
| Update           | Pure function         | Pure function (interpret)             |
| Mutation         | Returns new model     | Separate apply step                   |
| Persistence      | External              | Built-in (CRDT)                       |
| Sync             | External              | Built-in (CRDT)                       |
| Time travel      | Manual                | Built-in (frontiers)                  |
| Offline          | External              | Built-in                              |
| Concurrent edits | N/A                   | Built-in (CRDT merge)                 |

### What LEA Preserves from TEA

- **Unidirectional data flow** - Actions flow down, state flows up
- **Pure update function** - `interpret` is deterministic
- **Centralized logic** - All transitions in `interpret()`
- **Testable** - Intentions are pure data, interpret is pure

### What LEA Adds

- **Automatic persistence** - State survives refresh
- **Automatic sync** - Multi-tab, multi-device
- **Causal context** - Anchored intentions capture "when"
- **Conflict resolution** - CRDT handles concurrent edits
- **Time travel** - Frontiers give you any point in history

## Testing

### Unit Testing Interpret (Pure!)

```typescript
import { change, createTypedDoc, loro } from "@loro-extended/change"

describe("interpret", () => {
  it("returns SET_TASK_STATE operation for PUBLISH from draft", () => {
    const doc = createTypedDoc(TaskDocSchema)
    change(doc, draft => {
      draft.task.state = {
        status: "draft",
        title: "My Task",
        createdAt: 1000,
      }
    })
    const frontier = loro(doc).doc.frontiers()

    const operations = interpret(doc, { type: "PUBLISH" }, frontier)

    expect(operations).toEqual([
      {
        type: "SET_TASK_STATE",
        value: {
          status: "todo",
          title: "My Task",
          description: "",
          createdAt: 1000,
        },
      },
    ])
  })

  it("returns empty operations for PUBLISH when not in draft", () => {
    const doc = createTypedDoc(TaskDocSchema)
    change(doc, draft => {
      draft.task.state = {
        status: "todo",
        title: "My Task",
        description: "",
        createdAt: 1000,
      }
    })
    const frontier = loro(doc).doc.frontiers()

    const operations = interpret(doc, { type: "PUBLISH" }, frontier)

    expect(operations).toEqual([]) // Guard condition: no-op
  })
})
```

### Testing Apply (Isolated Mutation)

```typescript
describe("apply", () => {
  it("applies SET_TASK_STATE operation", () => {
    const doc = createTypedDoc(TaskDocSchema)
    const operations: Operation[] = [
      {
        type: "SET_TASK_STATE",
        value: { status: "todo", title: "Test", description: "", createdAt: 1000 },
      },
    ]

    const newFrontier = apply(doc, operations)

    expect(doc.task.state.status).toBe("todo")
    expect(newFrontier).not.toEqual([]) // New frontier returned
  })
})
```

## Best Practices

### 1. Keep Intentions Granular

```typescript
// ❌ Too coarse
type Intention = { type: "UPDATE_TASK"; task: Partial<Task> }

// ✅ Granular
type Intention =
  | { type: "UPDATE_TITLE"; title: string }
  | { type: "UPDATE_DESCRIPTION"; description: string }
  | { type: "SET_PRIORITY"; priority: number }
```

### 2. Interpret Must Be Pure

```typescript
// ❌ Impure - uses Date.now()
function interpret(doc, intention, frontier) {
  return [{ type: "SET_STATE", value: { startedAt: Date.now() } }]
}

// ✅ Pure - timestamp from anchored intention
function interpret(doc, intention, frontier, timestamp) {
  return [{ type: "SET_STATE", value: { startedAt: timestamp } }]
}
```

### 3. Guard Conditions Return Empty Operations

```typescript
function interpret(doc, intention, frontier) {
  const state = getState(doc, frontier)

  switch (intention.type) {
    case "START":
      // ✅ Guard returns empty, doesn't throw
      if (state.status !== "todo") return []

      return [{ type: "SET_STATE", value: { status: "in_progress", ... } }]
  }
}
```

### 4. Operations Are Data

```typescript
// Operations are plain objects, easy to serialize/log
type Operation =
  | { type: "SET_TASK_STATE"; value: TaskState }
  | { type: "ADD_COMMENT"; taskId: string; comment: Comment }
  | { type: "DELETE_TASK"; taskId: string }
```

### 5. Use TypeScript Exhaustiveness

```typescript
function interpret(doc, intention, frontier): Operation[] {
  switch (intention.type) {
    case "PUBLISH": return [...]
    case "START": return [...]
    case "COMPLETE": return [...]
    // TypeScript error if a case is missing
    default:
      const _exhaustive: never = intention
      return []
  }
}
```

## Summary

LEA provides a rigorous, pure functional foundation for CRDT-native applications:

1. **Intentions** - Pure data describing user intent
2. **Anchored Intentions** - Intent + causal context (frontier)
3. **Interpret** - Pure function computing operations from intent
4. **Apply** - Isolated mutation returning new frontier
5. **Frontiers as Model** - Immutable identifiers for points in history

The key insight: by separating **what to do** (interpret, pure) from **doing it** (apply, isolated), LEA preserves functional purity while gaining CRDT superpowers.

**LEA** — The Loro Extended Architecture: Extending TEA principles to CRDT-native applications with mathematical rigor.
