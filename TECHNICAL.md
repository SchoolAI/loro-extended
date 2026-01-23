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

### Nested Container Materialization

**Problem**: CRDTs require deterministic container IDs across peers. When a struct is created with an empty nested container (e.g., `{ answers: {} }`), the nested `LoroMap` must be created immediately—not lazily on first access. Otherwise, each peer creates its own container with a different ID, causing sync failures.

**Solution**: Eager materialization for statically-known structures:

| Container Type | Materialization Strategy |
|----------------|-------------------------|
| `Struct` | **Eager** - all nested containers created on initialization |
| `Doc` | **Eager** - all root containers created on initialization |
| `Record` | **Lazy** until `set()`, then eager for item's nested struct |
| `List` | **Lazy** until `push()`/`insert()`, then eager for item's nested struct |
| `Tree` | **Lazy** until `createNode()`, then eager for node's data struct |

**Implementation**:

1. `StructRefInternals.materialize()` recursively creates all nested containers defined in the schema
2. `assignPlainValueToTypedRef()` calls `materialize()` before assigning values
3. `convertStructInput()` iterates over **schema keys** (not just value keys) to create containers for missing fields

**Key Insight**: The creator of a data structure is responsible for materializing all its nested containers. This ensures container IDs are deterministic and consistent across peers.

```typescript
// ❌ Bug: Empty nested container may not materialize
recordRef.set("item-1", { id: "item-1", metadata: {} })

// ✅ Fixed: materialize() is called automatically, creating the nested LoroMap
// Container ID is now deterministic across all peers
```

See `packages/change/NESTED_CONTAINER_MATERIALIZATION_BUG.md` for the full bug report and resolution.

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

## Permissions and Document Architecture

### Server-Authoritative Data with Client-Writable RPC

When building RPC-style patterns (like Asks), you often need:
- **Client-writable data**: RPC queue for questions/requests
- **Server-authoritative data**: Results, state, or records that only the server should modify

**Problem**: Permissions operate at the document level, not field level. You can't make one field writable and another read-only within the same document.

**Solution**: Split into separate documents with different permissions:

```typescript
// Server configuration
const repo = new Repo({
  permissions: {
    mutability: (doc, peer) => {
      if (doc.id === "authoritative-data") {
        return peer.channelKind === "storage"; // Server-only
      }
      return true; // RPC doc is client-writable
    },
  },
});

const rpcHandle = repo.get("rpc-queue", RpcDocSchema);
const dataHandle = repo.get("authoritative-data", DataDocSchema);
```

**Benefits**:
- Server restart = clean authoritative state (clients can't sync stale data)
- Clear separation of concerns
- Clients can still use RPC for requests

**Caveat**: CRDT sync is bidirectional by default. Without permissions, a client with old data will sync it to a freshly restarted server. Always use `mutability` permissions for server-authoritative documents.

See `examples/username-claimer` for a complete implementation and `docs/permissions.md` for the full permissions API.

## LEA (Loro Extended Architecture)

### Fork-and-Merge Update Pattern

When building state machine transitions with LEA, use the **fork-and-merge** pattern to avoid confusion between read state and write draft:

```typescript
const update = createUpdate<Schema, Msg>((doc, msg, timestamp) => {
  // Single object for both reading and writing
  if (doc.status !== "idle") return     // Guard: read from doc
  change(doc, d => d.status = "running") // Mutate: via change()
})
```

**Critical**: Forks get new peer IDs by default. You must copy the main doc's peer ID to the fork:

```typescript
const workingDoc = doc.forkAt(frontier)
loro(workingDoc).doc.setPeerId(loro(doc).doc.peerId)  // Required!
```

Without this, each update creates operations from a different peer, causing the frontier to not advance correctly (each peer starts at counter 0).

See `examples/task-card/TECHNICAL.md` for the full implementation and `docs/lea.md` for the LEA architecture specification.

### UndoManager for Navigation History

Browser back/forward navigation is conceptually equivalent to undo/redo of navigation operations. Instead of maintaining manual history stacks (`past`/`future` arrays), use Loro's UndoManager:

```typescript
const undoManager = new UndoManager(loro(viewDoc).doc, {
  maxUndoSteps: 100,
  mergeInterval: 0, // Each navigation is a separate step
})
```

**Key patterns:**

1. **Two-step NAVIGATE for proper undo**: To restore both scroll position AND route on undo, the NAVIGATE handler must use two separate `change()` calls:

```typescript
case "NAVIGATE": {
  // Step 1: Save scroll to current route
  change(doc, draft => {
    draft.navigation.route.scrollY = msg.currentScrollY
  })
  // Step 2: Replace with new route
  change(doc, draft => {
    draft.navigation.route = { ...msg.route, scrollY: 0 }
  })
  break
}
```

2. **Browser history position tracking**: Store position in `pushState` to determine undo/redo count on popstate:

```typescript
window.history.pushState({ position: historyPosition }, "", url)
// On popstate: delta = newPosition - currentPosition
// delta < 0 → call undo() |delta| times
// delta > 0 → call redo() delta times
```

3. **Scroll position on route, not in separate map**: Store `scrollY` directly on each route variant for automatic restoration on undo.

4. **NAVIGATE_BACK/FORWARD messages are unnecessary**: The browser history reactor calls `undoManager.undo()/redo()` directly on popstate events.

See `examples/quiz-challenge/src/client/browser-history-reactor.ts` for the implementation and `plans/view-doc-undo-refactor.md` for the full design.
