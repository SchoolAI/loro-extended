# Technical Documentation

This document captures architectural decisions, technical insights, and implementation details for the loro-extended project.

## Loro CRDT Behavior

### Commit Idempotency

Loro's `commit()` is **idempotent** - calling it multiple times without changes between calls has no effect:

- Empty commits do not advance the version vector or frontiers
- Multiple sequential commits without mutations are safe and have no overhead
- This enables nested `change()` calls without requiring nesting detection

**Implication**: When implementing batched mutation patterns, you don't need to track nesting depth. Simply call `commit()` at the end of each `change()` block - Loro handles the rest.

## @loro-extended/change Architecture

### Ref Internals Pattern

All typed refs follow a **Facade + Internals** pattern:

```
TypedRef (public facade)
    └── [INTERNAL_SYMBOL]: BaseRefInternals (implementation)
```

- **Public facade** (`TypedRef` subclasses): Thin API surface, delegates to internals
- **Internals** (`BaseRefInternals` subclasses): Contains all state, caching, and implementation logic
- **Symbol access**: Internals are accessed via `[INTERNAL_SYMBOL]` to prevent namespace collisions with user data

### Key Internal Methods

| Method | Purpose |
|--------|---------|
| `getTypedRefParams()` | Returns params to recreate the ref (used by `change()` for draft creation) |
| `getChildTypedRefParams(key/index, shape)` | Returns params for creating child refs (lists, structs, records) |
| `absorbPlainValues()` | Commits cached plain value mutations back to Loro containers |
| `commitIfAuto()` | Commits if `autoCommit` mode is enabled (respects suppression flag) |
| `setSuppressAutoCommit(boolean)` | Temporarily suppress auto-commit during batch operations |

### Draft Creation for `change()`

The `change()` function creates draft refs by:

1. Getting params via `internals.getTypedRefParams()`
2. Creating a new ref with `autoCommit: false`, `batchedMutation: true`
3. Executing the user function with the draft
4. Calling `absorbPlainValues()` to persist cached mutations
5. Calling `doc.commit()` to finalize

This works for all ref types because `createContainerTypedRef()` handles the polymorphic creation.

### Value Shape Caching

When `batchedMutation: true` (inside `change()` blocks):

- **Value shapes** (plain objects, primitives) are cached so mutations persist
- **Container shapes** (refs) are cached as handles - mutations go directly to Loro

When `batchedMutation: false` (direct access):

- Values are read fresh from Loro on each access
- No caching overhead for simple reads

### Batch Assignment and Subscription Timing

When assigning a plain object to a struct/record via `ref.set(key, value)` or property assignment, `assignPlainValueToTypedRef()` handles the assignment atomically:

1. **Suppresses auto-commit** before iterating over properties
2. **Assigns all properties** in a loop
3. **Restores auto-commit** state
4. **Commits once** at the end (if autoCommit is enabled)

This ensures subscribers see **complete data** on the first notification, not partial data from intermediate states.

**Why this matters**: Without batching, each property assignment would trigger a separate `commit()` and subscription notification. Subscribers would see incomplete objects (e.g., `{ a: "value", b: "", c: "" }` on first notification).

The `setSuppressAutoCommit()` mechanism is reentrant-safe - it tracks whether suppression was already active to avoid double-restoring.

### Infer<> vs InferRaw<> and Type Boundaries

The `@loro-extended/change` package provides two type inference utilities:

| Type | Behavior | Use Case |
|------|----------|----------|
| `Infer<Shape>` | Uses `ExpandDeep` for IDE hover display | Public API types, documentation |
| `InferRaw<Shape>` | Direct extraction, preserves type identity | Internal types, generic constraints |

**The Problem**: `ExpandDeep` transforms `A["_plain"]` into a structurally equivalent but nominally different type. This breaks type identity when generic classes need to match types across boundaries.

**The Solution - Type Boundary Pattern**:

When building generic classes that use Loro shapes, define plain types using the generic parameters directly:

```typescript
// ❌ Breaks type identity - Infer<> uses ExpandDeep
type PlainEntry<A extends ValueShape> = Infer<EntryShape<A>>

// ✅ Preserves type identity - uses A["_plain"] directly
interface PlainEntry<A extends ValueShape> {
  data: A["_plain"]
  timestamp: number
}
```

Then create a **single documented type boundary** where Loro's types meet application types:

```typescript
private getEntry(id: string): PlainEntry<A> | undefined {
  const entry = this.recordRef.get(id)
  if (!entry) return undefined
  // TYPE BOUNDARY: Bridge from Infer<> (ExpandDeep) to our PlainEntry type
  return entry.toJSON() as unknown as PlainEntry<A>
}
```

All downstream code flows naturally from this boundary without casts.

## Naming Conventions

### Internal Method Naming

Methods that get params for **child** refs are named `getChildTypedRefParams()` to avoid shadowing the base class `getTypedRefParams()` which returns params for the ref itself.

This distinction is important:
- `getTypedRefParams()` - "How do I recreate myself?"
- `getChildTypedRefParams(key, shape)` - "How do I create a child at this key?"

## Adapter Architecture

### Async Message Delivery

All adapters deliver messages **asynchronously** to simulate real network behavior:

| Adapter | Delivery Mechanism |
|---------|-------------------|
| `BridgeAdapter` | `queueMicrotask()` |
| `WebSocket` | Network I/O |
| `SSE` | HTTP + EventSource |
| `Storage` | Async I/O |

This ensures tests using `BridgeAdapter` exercise the same async codepaths as production adapters, catching race conditions and async state management bugs early.

**Important**: Tests should use `waitForSync()` or `waitUntilReady()` to await synchronization:

```typescript
// Correct pattern
handleA.change(draft => { draft.text.insert(0, "hello") })
await handleB.waitForSync()
expect(handleB.doc.toJSON().text).toBe("hello")
```

### WorkQueue and Recursion Prevention

The Synchronizer uses a `WorkQueue` to prevent infinite recursion when adapters deliver messages. Messages are queued and processed iteratively, not recursively. However, this doesn't change timing - with `BridgeAdapter`, messages are still delivered in a different microtask.

## Testing Patterns

### Investigating Loro Behavior

When investigating Loro's behavior, use frontiers and oplog info rather than version vectors:

```typescript
// Frontiers show the latest operation IDs
const frontiers = doc.frontiers()

// getAllChanges() shows operation counts
const changes = doc.getAllChanges()
```

Version vectors from `doc.version().toJSON()` may return empty objects in some cases.

### Testing with BridgeAdapter

`BridgeAdapter` is the recommended adapter for unit and integration tests. It delivers messages asynchronously via `queueMicrotask()` to match production adapter behavior.

```typescript
const bridge = new Bridge()
const repoA = new Repo({
  adapters: [new BridgeAdapter({ adapterType: "peer-a", bridge })],
})
const repoB = new Repo({
  adapters: [new BridgeAdapter({ adapterType: "peer-b", bridge })],
})

// Make changes on A
const handleA = repoA.get("doc", DocSchema)
handleA.change(draft => { draft.text.insert(0, "hello") })

// Wait for sync on B
const handleB = repoB.get("doc", DocSchema)
await handleB.waitForSync()
expect(handleB.doc.toJSON().text).toBe("hello")
```

For low-level synchronizer tests that need fine-grained control, use `flushMicrotasks()`:

```typescript
import { flushMicrotasks } from "@loro-extended/repo/test-utils"

channel.onReceive(syncRequest)
await flushMicrotasks()
expect(mockAdapter.sentMessages.length).toBeGreaterThan(0)
```
