# @loro-extended/lea

**LEA 3.0** (Loro Extended Architecture) - A pattern for building CRDT-native applications with pure functional principles.

## Overview

LEA extends The Elm Architecture (TEA) to work with CRDTs. The core equation is:

```
(Frontier, Msg) → Frontier'
```

Where:
- **Frontier** is a CRDT version vector (point in time)
- **Msg** is an immutable message describing what happened
- **Frontier'** is the new version after applying the message

## Key Components

### 1. Doc (Shared State)
The CRDT document that holds your application state. Uses `@loro-extended/change` for type-safe schema definitions.

### 2. Update (State Transition)
A pure function that applies messages to the document:

```typescript
import { createUpdate } from "@loro-extended/lea"
import { change } from "@loro-extended/change"

const update = createUpdate<MySchema, MyMsg>((doc, msg, timestamp) => {
  switch (msg.type) {
    case "INCREMENT":
      change(doc, draft => {
        draft.counter.value += 1
      })
      break
  }
})
```

### 3. Reactors (Side Effects)
Functions that respond to state transitions:

```typescript
import type { Reactor } from "@loro-extended/lea"
import { entered } from "@loro-extended/lea"

const myReactor: Reactor<MySchema, MyMsg> = (transition, dispatch) => {
  // Detect when we enter a specific state
  if (entered("complete", t => t.status, transition)) {
    console.log("Quiz completed!")
  }
}
```

### 4. Runtime (Imperative Shell)
The only impure part - orchestrates everything:

```typescript
import { createRuntime } from "@loro-extended/lea"

const { dispatch, dispose } = createRuntime({
  doc: myDoc,
  update: myUpdate,
  reactors: [myReactor],
})

// Dispatch messages
dispatch({ type: "INCREMENT" })

// Clean up when done
dispose()
```

## Transition Helpers

Detect state changes with type-safe helpers:

```typescript
import { entered, exited, changed, transitioned } from "@loro-extended/lea"

// Did we enter a specific value?
if (entered("active", t => t.status, transition)) { ... }

// Did we exit a specific value?
if (exited("loading", t => t.status, transition)) { ... }

// Did a value change at all?
if (changed(t => t.count, transition)) { ... }

// Did we transition from one value to another?
if (transitioned("draft", "published", t => t.status, transition)) { ... }
```

## History Tracking

Track message history for debugging and time travel:

```typescript
import { 
  HistoryDocSchema, 
  appendHistoryEntry, 
  getHistoryEntries 
} from "@loro-extended/lea"

// Create a history document
const historyDoc = createTypedDoc(HistoryDocSchema)

// Pass to runtime for automatic tracking
const { dispatch, dispose } = createRuntime({
  doc: myDoc,
  update: myUpdate,
  reactors: [],
  historyDoc, // Messages are automatically recorded
})

// Later, retrieve history
const entries = getHistoryEntries(historyDoc)
```

## Installation

```bash
pnpm add @loro-extended/lea @loro-extended/change loro-crdt
```

## API Reference

### Types

- `Transition<Schema>` - Before/after state pair
- `Dispatch<Msg>` - Function to dispatch messages
- `Reactor<Schema, Msg>` - Function that responds to transitions
- `Program<Schema, Msg>` - Runtime configuration

### Functions

- `createUpdate<Schema, Msg>(handler)` - Create an update function
- `createRuntime(program)` - Create a runtime instance
- `entered(value, selector, transition)` - Detect entering a state
- `exited(value, selector, transition)` - Detect exiting a state
- `changed(selector, transition)` - Detect any change
- `transitioned(from, to, selector, transition)` - Detect specific transition

### History

- `HistoryDocSchema` - Schema for history documents
- `appendHistoryEntry(doc, msg, timestamp)` - Add a history entry
- `getHistoryEntries(doc)` - Get all history entries
- `getHistoryDocId(appDocId)` - Generate history doc ID from app doc ID

## Philosophy

LEA follows these principles:

1. **Pure Core, Impure Shell** - Update functions are pure; runtime handles side effects
2. **Single Source of Truth** - The CRDT document is the only state
3. **Deterministic Transitions** - Same frontier + same message = same result
4. **Lazy Evaluation** - TypedDoc proxies avoid unnecessary serialization
5. **Unified Reactors** - Views, effects, and subscriptions are all reactors

## License

MIT
