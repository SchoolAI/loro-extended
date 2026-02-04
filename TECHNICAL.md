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

### Symbol-Based Escape Hatches

The library uses well-known symbols to provide clean separation between different access patterns:

| Symbol | Function | Purpose |
|--------|----------|---------|
| `INTERNAL_SYMBOL` | (internal) | Private implementation details |
| `LORO_SYMBOL` | `loro()` | Access native Loro types directly |
| `EXT_SYMBOL` | `ext()` | Access loro-extended-specific features |

**Design Rationale**: TypedDoc and TypedRef are Proxy objects where property names map to schema fields. Symbols provide a clean namespace for library functionality without polluting the user's schema namespace.

### The `loro()` and `ext()` Functions

```typescript
// loro() returns native Loro types directly
const loroDoc: LoroDoc = loro(typedDoc)
const loroText: LoroText = loro(textRef)
const loroList: LoroList = loro(listRef)

// ext() provides loro-extended-specific features
ext(doc).change(fn)        // Mutate with auto-commit
ext(doc).fork()            // Fork the document
ext(doc).forkAt(frontiers) // Fork at specific version
ext(doc).initialize()      // Write metadata
ext(doc).mergeable         // Check if using flattened storage
ext(doc).docShape          // Get the schema
ext(doc).applyPatch(patch) // Apply JSON patch
ext(doc).rawValue          // Get raw value without toJSON

// For refs, ext() provides doc access
ext(ref).doc               // Get LoroDoc from any ref
ext(ref).change(fn)        // Mutate via the ref's doc
ext(listRef).pushContainer(shape)    // Push nested container
ext(structRef).setContainer(key, shape) // Set nested container
```

**Migration from old API**:
- `loro(doc).doc` → `loro(doc)`
- `loro(ref).container` → `loro(ref)`
- `loro(ref).doc` → `ext(ref).doc`
- `doc.change(fn)` → `change(doc, fn)`
- `doc.forkAt(f)` → `ext(doc).forkAt(f)`

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

### TypedDoc Diff Overlay (Before/After Without Checkout)

TypedDoc now supports a **read-only diff overlay** that lets you compute a
"before" view without copying or checking out the document. This is used when a
subscription provides a `LoroEventBatch` and you want to read `{ before, after }`
from the **same** `LoroDoc`.

**Key APIs:**

```ts
export type CreateTypedDocOptions = {
  doc?: LoroDoc
  overlay?: DiffOverlay
}

export function createTypedDoc<Shape extends DocShape>(
  shape: Shape,
  options: CreateTypedDocOptions = {},
): TypedDoc<Shape>
```

```ts
export type DiffOverlay = ReadonlyMap<ContainerID, Diff>

export function createDiffOverlay(
  doc: LoroDoc,
  batch: LoroEventBatch,
): DiffOverlay {
  return new Map(doc.diff(batch.to, batch.from, false))
}
```

**How it works:**

1. Build a `DiffOverlay` from the **reverse diff** (`doc.diff(to, from)`).
2. Pass `{ overlay }` into `createTypedDoc` for the "before" view.
3. All ref read paths check the overlay to synthesize the old value:
   - **Counters**: add reverse `increment`.
   - **Struct/Record**: use `updated[key]` from map diffs.
   - **List/Text**: apply reverse deltas to current values.

**Design constraints:**

- Overlay is **read-only** and does not mutate Loro containers.
- Unsupported types (e.g., tree) are currently ignored.
- The overlay is stored in ref params and propagated through `getChildTypedRefParams()`.
 - The overlay is stored in ref params and propagated through `getChildTypedRefParams()`.

### `getTransition()` Helper (Strict Checkout Guard)

The `getTransition(doc, event)` helper builds `{ before, after }` from a
`LoroEventBatch` using the diff overlay, and **throws** on checkout events to
avoid interpreting time-travel as a state transition. This is intentionally
strict so callers must handle checkout events explicitly if they want them.

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

### Mergeable Containers via Flattened Root Storage

**Problem**: When two peers concurrently create a nested container at the same schema path, they create containers with different peer-dependent IDs. After sync, Loro's LWW semantics cause one peer's container to "win" while the other's operations appear lost. This is especially problematic with `applyDiff()` which remaps container IDs.

**Solution**: When `mergeable: true` is set on a TypedDoc, all containers are stored at the document root with path-based names. This ensures deterministic IDs that survive `applyDiff`.

```typescript
const doc = createTypedDoc(schema, { mergeable: true });
```

**Path Encoding**:
- Separator: `-` (hyphen)
- Escape character: `\` (backslash)
- Literal hyphen in key: `\-`
- Literal backslash in key: `\\`

| Schema Path | Encoded Root Name | Container ID |
|-------------|-------------------|--------------|
| `data.items` | `data-items` | `cid:root-data-items:List` |
| `data["my-key"].value` | `data-my\-key-value` | `cid:root-data-my\-key-value:Map` |

**Storage Structure**:

For a schema with nested structs, flattened storage uses `null` markers to indicate child containers:

```typescript
// Schema: { data: { nested: { value: string } } }
// Flattened storage:
// - cid:root-data:Map → { nested: null }  // null marker
// - cid:root-data-nested:Map → { value: "hello" }
```

**toJSON Reconstruction**: The `toJSON()` method automatically reconstructs the hierarchical structure from flattened storage when `mergeable: true`.

**Limitations**:
- Lists of containers (`Shape.list(Shape.struct({...}))`) are NOT supported with `mergeable: true`
- MovableLists of containers have the same limitation
- Use `Shape.record(Shape.struct({...}))` with string keys instead

**Implementation Details**:
- `pathPrefix` is passed through `TypedRefParams` to track the current path
- `computeChildRootContainerName()` builds the root container name from path segments
- `reconstructFromFlattened()` and `reconstructDocFromFlattened()` handle toJSON reconstruction

### Document Metadata and Reserved Keys

Loro Extended reserves all root container keys starting with `_loro_extended` for internal use. These keys are:

- Automatically excluded from `toJSON()` and `rawValue` output
- Used for document metadata and future internal features
- Synced between peers like any other container

**Metadata Container**: `_loro_extended_meta_` stores document metadata:
- `mergeable`: Whether the document uses flattened root container storage
- `schemaVersion`: (Future) Schema version for migration support

**Schema-Level Configuration**:

```typescript
// Declare mergeable in the schema
const schema = Shape.doc({
  players: Shape.record(Shape.struct({ score: Shape.plain.number() })),
}, { mergeable: true })

// Metadata is automatically written on creation (default)
const doc = createTypedDoc(schema)
```

**Initialization Control**: By default, `createTypedDoc()` writes metadata immediately. Use `skipInitialize: true` to defer:

```typescript
// Skip auto-initialization for advanced use cases
const doc = createTypedDoc(schema, { skipInitialize: true })

// Later, when ready to write metadata:
doc.initialize()
```

Use `skipInitialize: true` when:
- Receiving a synced document (it already has metadata)
- You need to control when the metadata commit happens (e.g., for signing)
- Testing scenarios where you need an empty document

**Peer Agreement**: When a peer receives a document, it reads the metadata and uses it (metadata takes precedence over schema). This ensures all peers use consistent settings.

**Priority Order**: `options.mergeable` > `schema.mergeable` > existing metadata > `false`

**Backward Compatibility**: Documents without metadata are assumed to have `mergeable: false`.

**Reserved Prefix**: Do not use `_loro_extended` as a prefix for your own root container keys.

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
const workingDoc = ext(doc).forkAt(frontier)
loro(workingDoc).setPeerId(loro(doc).peerId)  // Required!
```

Without this, each update creates operations from a different peer, causing the frontier to not advance correctly (each peer starts at counter 0).

See `examples/task-card/TECHNICAL.md` for the full implementation and `docs/lea.md` for the LEA architecture specification.

### UndoManager for Navigation History

Browser back/forward navigation is conceptually equivalent to undo/redo of navigation operations. Instead of maintaining manual history stacks (`past`/`future` arrays), use Loro's UndoManager:

```typescript
const undoManager = new UndoManager(loro(viewDoc), {
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

### Lens + Transition Shell (Runtime Alternative)

Use [`useLens()`](packages/hooks-core/src/create-hooks.ts:162) in React/Hono integrations to manage lens lifecycle and snapshot caching when you need a lens-based worldview. The hook mirrors [`useDoc()`](packages/hooks-core/src/create-hooks.ts:99) behavior by caching snapshots based on opCount + frontiers, preventing infinite update loops when using `useSyncExternalStore`.

For lightweight runtimes, the World/Worldview pattern can be implemented directly with:

- `createLens(world, { filter })` for commit-level filtering into a worldview
- `subscribe()` + `getTransition()` for reactors (before/after snapshots without checkout)

This yields a minimal imperative shell:

1. Subscribe to `lens.worldview` changes
2. Build `{ before, after }` via `getTransition()`
3. Invoke reactors with `change(lens, fn, options?)` as the write path

Role-specific filters should be isolated (e.g., server vs client) with shared helpers to prevent policy drift. Tests should assert that client filters enforce player sovereignty and server filters enforce authoritative fields.

### Unified `change()` API

The `change()` function from `@loro-extended/change` is the unified mutation API for all changeable types:

```typescript
import { change } from "@loro-extended/change"

// TypedDoc
change(doc, draft => draft.counter.increment(1))

// TypedRef
change(ref, draft => draft.push({ name: "item" }))

// Lens (with commit message for identity-based filtering)
change(lens, draft => draft.counter.increment(1), { commitMessage: { userId: "alice" } })
```

**ChangeOptions**: The optional third parameter supports:
- `commitMessage?: string | object` - Attached to the commit for identity-based filtering

**Detection mechanism**: The `change()` function detects Lens (and any future changeable types) via `[EXT_SYMBOL].change()`. This allows packages to implement the changeable protocol without circular dependencies.

**Re-exports**: For convenience, `@loro-extended/lens` re-exports `change` and `ChangeOptions` from `@loro-extended/change`, enabling single-import usage:

```typescript
import { createLens, change } from "@loro-extended/lens"
```
