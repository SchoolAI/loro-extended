# Learnings: Implementing Lens in Repo

> **Note**: As of the unified `change()` API update, `lens.change()` has been removed. Use `change(lens, fn, options?)` instead. See the "Unified change() API" section below.

> **Update**: The worldview now uses a separate peer ID from the world (the default from `fork()`). This improves safety by avoiding `(peerId, counter)` collisions and aligns with Loro's expectations about peer ID uniqueness. See "Peer ID Separation" section below.

## Architecture Summary

### Bidirectional Flow Between World and Worldview

**World → Worldview (Import Path)**: Commit-level filtering via import

- Peers' changes go to World first (CRDT convergence)
- Filter each commit: `(commit: JsonChange) => boolean`
- Use `findIdSpansBetween()`, `exportJsonInIdSpan()`, `export({ mode: 'updates-in-range', spans })`
- Only accepted commits are imported to Worldview

**Worldview → World (Export Path)**: State-based applyDiff (NOT op-based import)

- Current LEA uses op-based import - this is problematic
- Problem scenario: Bob writes Alice's choice to World. Alice filters it out of Worldview. Alice writes her actual choice. Her op isn't based on "latest" state, so Bob's might win via CRDT resolution.
- Solution: Use `applyDiff()` - take diff between Worldview states, apply to World. Doesn't care about causal history.

### Key Technical Details

1. **Filter signature simplified**: `(commit: JsonChange) => boolean`

   - No worldview parameter (filter doesn't need current state)
   - No source parameter (identity comes from commit.msg)
   - Everything needed is in the commit (id has peer, msg has identity, ops has operations)

2. **LoroDoc.fork() preserves state**: A fork contains all data from the original. The worldview uses its own peer ID (the default from `fork()`) rather than sharing the world's peer ID.

3. **Loro's commit-level filtering API**:

   - [`findIdSpansBetween(frontiersBefore, frontiersAfter)`](packages/lea/src/runtime.ts:261) - finds what changed
   - [`exportJsonInIdSpan({ peer, counter, length })`](packages/lea/src/runtime.ts:280) - gets individual commits as JsonChange
   - `export({ mode: 'updates-in-range', spans })` - exports only selected commits

4. **Causal consistency**: If commit N from a peer is rejected, all subsequent commits (N+1, N+2, etc.) from that peer in the same batch must also be rejected.

### Current LEA Implementation (What to Learn From)

The filtering logic in `filterWorldToWorldview` is well-implemented:

- Tracks rejected peers for causal consistency
- Extracts identity from commit messages
- Builds valid spans and exports only accepted commits

```ts
/**
 * Filter changes from World to Worldview given the frontiers before and after.
 *
 * This is the core filtering logic used by both:
 * - `processPeerImport()` - for manual `runtime.import()` calls
 * - `processExternalImport()` - for Repo-triggered imports
 *
 * @param worldFrontiersBefore - World frontiers before the import
 * @param worldFrontiersAfter - World frontiers after the import
 * @param peerId - The peer ID to attribute the import to (for filter context)
 */
function filterWorldToWorldview(
  worldFrontiersBefore: ReturnType<typeof worldLoroDoc.frontiers>,
  worldFrontiersAfter: ReturnType<typeof worldLoroDoc.frontiers>,
  peerId: string,
): void {
  // Find spans that changed
  const spans = worldLoroDoc.findIdSpansBetween(
    worldFrontiersBefore,
    worldFrontiersAfter,
  );

  // For each span, get changes and filter per-commit
  // Type for OpId peer is `${number}` (a string that looks like a number)
  type OpIdPeer = `${number}`;
  const validSpans: Array<{
    id: { peer: OpIdPeer; counter: number };
    len: number;
  }> = [];

  // Track which peers have had a rejection - we must stop accepting
  // subsequent commits from that peer to maintain causal consistency
  const rejectedPeers = new Set<string>();

  for (const span of spans.forward) {
    // Get all changes (commits) in this span
    const changes = worldLoroDoc.exportJsonInIdSpan({
      peer: span.peer,
      counter: span.counter,
      length: span.length,
    });

    for (const jsonChange of changes) {
      // Parse change.id to get peer and counter (format: "counter@peer")
      const atIndex = jsonChange.id.indexOf("@");
      const counter = parseInt(jsonChange.id.slice(0, atIndex), 10);
      const changePeer = jsonChange.id.slice(atIndex + 1);

      // If this peer has already had a rejection, skip all subsequent commits
      // from them to maintain causal consistency
      if (rejectedPeers.has(changePeer)) {
        continue;
      }

      // Extract identity from commit message if identify function is provided
      // Convert null to undefined for the identify function signature
      const commitIdentity = identify
        ? identify(jsonChange.msg ?? undefined) ?? undefined
        : undefined;

      // Build the source object with peerId and optional commitIdentity
      const source: Source<IdentityContext> = {
        peerId,
        ...(commitIdentity !== undefined && { commitIdentity }),
      };

      // Call filter for each commit
      const isValid = filter(worldview, jsonChange, source);

      if (isValid) {
        // Calculate the end counter for this change
        // It extends to the next change's counter, or to the end of the span
        // NOTE: The old approach of calculating from ops was buggy - ops may have
        // fewer entries than the actual counter range (e.g., "Hello" = 1 op, 5 counters)
        const nextChange = changes[changes.indexOf(jsonChange) + 1];
        let endCounter: number;
        if (nextChange) {
          const nextAtIndex = nextChange.id.indexOf("@");
          endCounter = parseInt(nextChange.id.slice(0, nextAtIndex), 10);
        } else {
          // Last change extends to the end of the span
          endCounter = span.counter + span.length;
        }
        const len = endCounter - counter;

        if (len > 0) {
          validSpans.push({
            id: { peer: changePeer as OpIdPeer, counter },
            len,
          });
        }
      } else {
        // Mark this peer as rejected - all subsequent commits from them
        // in this batch will be skipped
        rejectedPeers.add(changePeer);
      }
    }
  }

  // If all rejected, we're done (world still has the changes)
  if (validSpans.length === 0) {
    return;
  }

  // Capture worldview frontier before applying changes
  const worldviewFrontiersBefore = worldviewLoroDoc.frontiers();

  // Export valid changes and import to worldview
  const validBytes = worldLoroDoc.export({
    mode: "updates-in-range",
    spans: validSpans,
  });
  worldviewLoroDoc.import(validBytes);

  // Capture worldview frontier after import
  const worldviewFrontiersAfter = worldviewLoroDoc.frontiers();

  // Create before/after snapshots for reactors
  const before = forkAt(worldview, worldviewFrontiersBefore);
  const after = forkAt(worldview, worldviewFrontiersAfter);

  // Fire reactors (with depth tracking)
  fireReactors(before, after);
}
```

The local change propagation in [`packages/lea/src/runtime.ts:204-241`](packages/lea/src/runtime.ts:204) uses op-based import:

```typescript
const localUpdate = worldviewLoroDoc.export({
  mode: "update",
  from: worldVersionBefore,
});
worldLoroDoc.import(localUpdate);
```

This should be replaced with applyDiff for Lens:

```typescript
const diff = worldviewLoroDoc.diff(
  worldviewFrontiersBefore,
  worldviewFrontiersAfter,
);
worldLoroDoc.applyDiff(diff);
```

### Architecture Diagram

```
┌───────────────────────────────────────────────────────────────┐
│                           WORLD                               │
│                  (Source.doc, peerId = A)                     │
│                                                               │
│  • Synced via network (Repo)                                  │
│  • Receives local changes via applyDiff() ← STATE-BASED       │
│  • applyDiff + commit creates ops with world's peerId (A)     │
│  • Standard CRDT convergence                                  │
└───────────────────────────────────────────────────────────────┘
          ▲                              │
          │ applyDiff()                  │ import() from peers
          │ (state-based)                │ (op-based)
          │ creates ops with             │ preserves original
          │ world's peerId               │ authors' peerIds
          │                              ▼
          │                    ┌─────────────────────┐
          │                    │   filter commits    │
          │                    │   (commit) => bool  │
          │                    └─────────────────────┘
          │                              │
          │                              │ import() accepted
          │                              ▼
┌───────────────────────────────────────────────────────────────┐
│                         WORLDVIEW                             │
│                  (Lens.doc, peerId = B)                       │
│                                                               │
│  • Created via world.fork() with its OWN unique peer ID       │
│  • All local writes happen here (ops use peerId B)            │
│  • Receives filtered remote changes via import()              │
│  • UI reads from here                                         │
│  • Separate frontier tracking (lastKnownWorldviewFrontiers)   │
└───────────────────────────────────────────────────────────────┘
```

### Peer ID Separation

The worldview uses its own unique peer ID (from `fork()`) rather than sharing the world's peer ID. This is safe because:

- **Outbound (worldview → world)**: `applyDiff()` + `commit()` creates NEW ops with the world's peer ID
- **Inbound (world → worldview)**: `import()` preserves original authors' peer IDs

**Why separate peer IDs**:
1. Avoids potential `(peerId, counter)` collisions between world and worldview
2. Aligns with Loro's expectations about peer ID uniqueness
3. Improves debugging (worldview ops are clearly distinct from world ops)

**Frontier tracking**: Because peer IDs differ, the lens tracks frontiers for both documents separately:
- `lastKnownWorldFrontiers` - for detecting inbound changes to filter
- `lastKnownWorldviewFrontiers` - for computing diffs in chained lens propagation

**Nested containers**: When using lenses with nested containers, use `mergeable: true` on the schema. Without it, container IDs encode the worldview's peer ID, and subsequent modifications via `applyDiff` fail.

### Anti-Patterns to Avoid

1. **Don't use op-based import for Worldview → World** - Use applyDiff instead
2. **Don't add backward compat aliases** - Clean break as decided
3. **Don't leave filtering as TODO** - The filter function must be called
4. **Don't create parallel implementations** - LEA should USE Lens, not duplicate it
5. **Don't treat "tests pass" as "done"** - Write tests that verify filtering works
6. **Don't use `mergeable: false` with nested containers in lenses** - Container IDs will mismatch

### Tests to Write

1. Filter that always returns false → no commits reach Worldview
2. Filter that always returns true → all commits reach Worldview
3. Filter based on commit message identity → only matching commits accepted
4. Rejected peer's subsequent commits also rejected (causal consistency)
5. Local changes bypass filter (trusted local code)
6. **Causal history test**: Bob writes Alice's data, Alice filters it, Alice writes her own data - Alice's data should win in World
7. **Peer ID separation**: World and worldview have different peer IDs
8. **Nested containers with mergeable**: Nested container creation/modification through lens with `mergeable: true`
9. **Chained lens propagation**: Changes through deepest lens propagate all the way to world

## Understanding the Architecture

The user's key insight is about the **bidirectional flow** between World and Worldview:

### World → Worldview (Import Path)

This uses **commit-level filtering via import**:

- When changes arrive from peers, they go to World first (for CRDT convergence)
- Then we filter commits using `findIdSpansBetween()`, `exportJsonInIdSpan()`, and `export({ mode: 'updates-in-range', spans })`
- Only accepted commits are imported to Worldview
- Filter signature: `(commit: JsonChange) => boolean` (simplified - no worldview, no source)

### Worldview → World (Export Path) - THE KEY INSIGHT

The user said this should use **state-based applyDiff**, NOT op-based import.

**Why op-based import fails:**

Looking at the scenario the user described:

1. Bob writes Alice's choice to World (malicious)
2. Alice's filter strips Bob's write from her Worldview (she doesn't see it)
3. Alice writes her actual choice to Worldview
4. **Problem**: Alice's operation is based on a state that doesn't include Bob's write
5. When Alice's op is imported to World, CRDT resolution happens
6. Bob's write might "win" because Alice's op wasn't based on the "latest" state

**Why applyDiff-back is better:**

Instead of importing Alice's operations to World:

1. Take the diff between Worldview states (before and after Alice's change)
2. Apply that diff to World as a state transformation
3. This doesn't care about causal history - it just says "make World look like Worldview for these fields"

### Current LEA Implementation

Looking at [`packages/lea/src/runtime.ts`](packages/lea/src/runtime.ts:204-241), the current `processLocalChangeImpl` does:

```typescript
// 6. Export changes from worldview and import to world (import commits automatically)
const localUpdate = worldviewLoroDoc.export({
  mode: "update",
  from: worldVersionBefore,
});
worldLoroDoc.import(localUpdate);
```

This is **op-based import** - exactly what the user says is problematic!

### The Fix for Lens

For the Lens implementation in Repo, the Worldview → World path should use `applyDiff`:

```typescript
// Instead of:
const localUpdate = worldviewLoroDoc.export({
  mode: "update",
  from: worldVersionBefore,
});
worldLoroDoc.import(localUpdate);

// Use:
const diff = worldviewLoroDoc.diff(
  worldviewFrontiersBefore,
  worldviewFrontiersAfter,
);
worldLoroDoc.applyDiff(diff);
```

This makes the propagation **state-based** rather than **op-based**, avoiding the causal history issues.

### Mergeable Containers for applyDiff Compatibility

**Important**: When using `applyDiff()` to propagate changes from Worldview to World, nested containers created via `setContainer()` or `getOrCreateContainer()` receive peer-dependent IDs. With separate peer IDs for world and worldview, subsequent modifications to these containers via `applyDiff` fail because the world doesn't have containers with those IDs.

**Solution**: Use `mergeable: true` when creating TypedDocs that will be used with Lens:

```typescript
const schema = Shape.doc({
  items: Shape.record(Shape.struct({
    name: Shape.text(),
    tags: Shape.list(Shape.plain.string()),
  })),
}, { mergeable: true });

const world = createTypedDoc(schema);
const lens = createLens(world, { filter: myFilter });
```

This stores all containers at the document root with path-based names (e.g., `items-alice-name`), ensuring deterministic IDs that survive `applyDiff`. See TECHNICAL.md section "Mergeable Containers via Flattened Root Storage" for implementation details.

**Note**: Lists of containers (`Shape.list(Shape.struct({...}))`) are NOT supported with `mergeable: true`. Use `Shape.record(Shape.struct({...}))` with string keys instead.

### Known Limitation: Chained Lens Parent-to-Child Propagation

When making changes through a PARENT lens (lens1), those changes reach the world but do NOT automatically propagate DOWN to a CHILD lens's worldview (lens2). This is because:

1. `lens1.change()` modifies `lens1.worldview` directly
2. `lens1` propagates to world via `applyDiff`
3. `lens2.world === lens1.worldview`, but `lens2` only filters INBOUND changes
4. The direct mutation of `lens1.worldview` is a "local" event, not a filtered import

**Workaround**: Always make changes through the deepest lens in a chain, or accept that parent changes won't reach child worldviews.

**Key differences from current LEA:**

1. **Filter signature simplified**: `(commit: JsonChange) => boolean` - no worldview, no source
2. **Worldview → World uses applyDiff**: State-based, not op-based
3. **World → Worldview uses filtered import**: Op-based, but filtered at commit level

## Unified `change()` API

The Lens implementation uses the unified `change()` function from `@loro-extended/change` instead of a method on the Lens object. This provides a consistent API across all changeable types (TypedDoc, TypedRef, Lens).

### Usage

```typescript
import { createLens, change } from "@loro-extended/lens"
// Or: import { change } from "@loro-extended/change"

const lens = createLens(world, { filter: myFilter })

// Write through the lens with optional commit message
change(lens, draft => {
  draft.counter.increment(5)
}, { commitMessage: { userId: "alice" } })
```

### Implementation

The Lens exposes `[EXT_SYMBOL].change()` which the unified `change()` function detects:

```typescript
// In lens.ts
return {
  worldview,
  world,
  dispose,
  [EXT_SYMBOL]: {
    change: processLocalChange,
  },
}
```

The `change()` function in `@loro-extended/change` uses type inference to extract the draft type from the `[EXT_SYMBOL].change` signature, providing full type safety without circular dependencies.

### Benefits

1. **Consistent API**: Same `change(target, fn, options?)` pattern for docs, refs, and lenses
2. **No circular dependencies**: Lens doesn't need to import from change, change doesn't need to import Lens type
3. **Type-safe**: Draft type is inferred from the Lens's `[EXT_SYMBOL].change` signature
4. **Single import**: `@loro-extended/lens` re-exports `change` for convenience
