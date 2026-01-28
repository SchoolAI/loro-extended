# Lens Technical Documentation

## Overview

A Lens creates a **worldview** (`lens.doc`) from a **world** (`lens.source`). The worldview is your filtered perspective on the shared world--you see only the changes you've chosen to accept. This document explains the technical implementation details and design decisions.

## Architecture

### Core Concepts

1. **World** (`lens.source`): The shared, converging TypedDoc containing all data from all participants
2. **Worldview** (`lens.doc`): Your filtered perspective on the world
3. **Filter**: A function that determines which commits pass through to the worldview

### Data Flow

```
┌─────────────────────────────────────────────────────────────┐
│                   lens.source (World)                       │
│                                                             │
│  - Contains all commits from all peers                      │
│  - Receives external imports                                │
│  - Receives propagated changes from worldview via applyDiff │
└─────────────────────────────────────────────────────────────┘
                    ^                    │
                    │                    │
         applyDiff  │                    │  filtered import
         (state)    │                    │  (commit-level)
                    │                    v
┌─────────────────────────────────────────────────────────────┐
│                    lens.doc (Worldview)                     │
│                                                             │
│  - Contains only commits that pass the filter               │
│  - Local changes via lens.change()                          │
│  - Receives filtered commits from world                     │
└─────────────────────────────────────────────────────────────┘
```

## Key Design Decisions

### 1. TypedDoc as Input

The lens takes a TypedDoc as input rather than a Handle. This enables:

- **Composability**: Lenses can be chained (lens of a lens)
- **Flexibility**: Works with any TypedDoc, not just repo-managed docs
- **Separation of concerns**: Lens doesn't need to know about Repo

### 2. Fork with Preserved Peer ID

```typescript
// Internally, the worldview is created as a fork of the world
const worldviewLoroDoc = worldLoroDoc.fork();
worldviewLoroDoc.setPeerId(worldLoroDoc.peerId);
```

The worldview is created as a fork of the world with the same peer ID. This:

- Keeps the version vector small
- Ensures local writes appear as the same peer in both documents
- Maintains consistency when propagating changes

### 3. Bidirectional Sync Strategy

#### World → Worldview: Commit-Level Filtered Import

When the world receives external imports:

1. Find ID spans between old and new frontiers
2. For each span, export JSON changes via `exportJsonInIdSpan`
3. Apply filter to each change (commit)
4. Track accepted changes with their counter ranges
5. Create sub-spans for accepted portions
6. Export valid sub-spans as binary and import to worldview

**Important**: `findIdSpansBetween` combines consecutive commits from the same peer into a single span, even when they have different commit messages. However, `exportJsonInIdSpan` returns individual changes with their messages, enabling per-commit filtering.

This preserves causal consistency--if a commit is rejected, all subsequent commits from that peer in the same batch are also rejected.

#### Worldview → World: State-Based applyDiff

When the worldview changes (via `lens.change()` or chained lens):

1. Capture frontiers before and after the change
2. Compute diff between the two states
3. Apply diff to world via `applyDiff()`
4. Commit the changes

Using `applyDiff` instead of op-based import avoids causal history issues. Local changes "win" regardless of concurrent peer changes that were filtered out.

### 4. Subscription Strategy

The lens subscribes to both world and worldview:

```typescript
// World subscription: external imports + parent lens changes
worldLoroDoc.subscribe((event) => {
  if (event.by === "import" || event.by === "local") {
    processWorldChange();
  }
});

// Worldview subscription: chained lens changes
worldviewLoroDoc.subscribe((event) => {
  if (event.by === "local") {
    processWorldviewChange();
  }
});
```

- **World "import"**: External peer data arriving
- **World "local"**: Parent lens's `change()` method (for chained lenses)
- **Worldview "local"**: Chained lens applying changes via `applyDiff`

### 5. Processing State

The lens uses an explicit `ProcessingState` string union to track what operation is in progress:

```typescript
type ProcessingState =
  | "idle"
  | "filtering-world-to-worldview"
  | "propagating-worldview-to-world"
  | "applying-local-change";

let processingState: ProcessingState = "idle";

function processWorldChange(): void {
  if (isDisposed || processingState !== "idle") return;
  // ...
}
```

This explicit state machine:

- Makes control flow self-documenting
- Prevents infinite loops between subscriptions
- Allows fine-grained control over which operations block which

### 6. Centralized Frontier Tracking

Frontier updates are centralized in a single `syncFrontiers()` function:

```typescript
function syncFrontiers(): void {
  lastKnownWorldFrontiers = worldLoroDoc.frontiers();
  lastKnownWorldviewFrontiers = worldviewLoroDoc.frontiers();
}
```

This is called at the end of every operation that modifies either document, ensuring frontier tracking stays synchronized and eliminating the risk of missed updates.

## Lens Chaining

Lenses can be chained to create nested filtered views:

```typescript
const lens1 = createLens(world, { filter: filterA });
const lens2 = createLens(lens1.doc, { filter: filterB });
const lens3 = createLens(lens2.doc, { filter: filterC });
```

### Propagation Flow

**Outward (lens3 → world):**

1. `lens3.change()` modifies `lens3.doc` (lens3's worldview)
2. `lens3` applies diff to `lens2.doc` (lens3's world, which is lens2's worldview)
3. `lens2`'s worldview subscription fires, propagates to `lens1.doc`
4. `lens1`'s worldview subscription fires, propagates to `world`

**Inward (world → lens3):**

1. External import arrives at `world`
2. `lens1`'s world subscription fires, filters to `lens1.doc`
3. `lens2`'s world subscription fires, filters to `lens2.doc`
4. `lens3`'s world subscription fires, filters to `lens3.doc`

### Frontier Tracking

Each lens tracks two sets of frontiers:

- `lastKnownWorldFrontiers`: For detecting world changes
- `lastKnownWorldviewFrontiers`: For detecting chained lens changes

This enables delta-based propagation--only new changes are processed, not the entire state.

## Filter Function

### LensFilter API

```typescript
type LensFilter = (info: CommitInfo) => boolean;
```

The filter receives a `CommitInfo` object with pre-parsed commit metadata:

```typescript
interface CommitInfo {
  raw: JsonChange; // Original JsonChange for advanced use
  peerId: string; // Extracted from commit.id
  counter: number; // Extracted from commit.id
  timestamp: number; // Unix timestamp
  message: unknown; // Parsed JSON message, or null
}
```

Usage:

```typescript
const lens = createLens(world, {
  filter: (info) => {
    // Pre-parsed metadata - no manual parsing needed
    return info.peerId === "12345" && info.message?.role === "admin";
  },
});
```

### parseCommitInfo Helper

The `parseCommitInfo` function is exported for users who want to build custom utilities:

```typescript
import { parseCommitInfo } from "@loro-extended/lens";

const info = parseCommitInfo(commit);
console.log(info.peerId, info.message);
```

### Causal Consistency

If a commit from peer P is rejected, all subsequent commits from P in the same batch are also rejected. This maintains causal consistency - you can't accept commit N+1 if you rejected commit N.

```typescript
const rejectedPeers = new Set<string>();

for (const jsonChange of changes) {
  if (rejectedPeers.has(changePeer)) {
    continue; // Skip subsequent commits from rejected peer
  }

  if (!filter(jsonChange)) {
    rejectedPeers.add(changePeer);
  }
}
```

### Why Causal Consistency is Required

Loro's text operations are position-based. Consider this sequence:

```
Commit 1: insert "First" at position 0     → text = "First" (5 chars)
Commit 2: insert " Second" at position 5   → text = "First Second" (12 chars)
Commit 3: insert " Third" at position 12   → text = "First Second Third"
```

If we accept commit 1, reject commit 2, and try to accept commit 3:

- After commit 1: text = "First" (5 characters)
- Commit 3 tries to insert at position 12, which doesn't exist!

Loro silently ignores operations that can't be applied (non-contiguous imports), so commit 3 would be lost. The lens enforces causal consistency to prevent this data loss.

### Partial Acceptance (Sub-Spans)

When commits have messages, `findIdSpansBetween` combines them into a single span, but `exportJsonInIdSpan` returns individual changes. The lens handles this by:

1. Filtering each change individually
2. Creating sub-spans for accepted portions (using counter ranges)
3. Stopping at the first rejection (causal consistency)

Example:

```
Span: peer=222, counter=0, length=18 (contains 3 commits)

Commit 1: counter=0, msg={allowed:true}  → ACCEPTED, sub-span counter=0, len=5
Commit 2: counter=5, msg={allowed:false} → REJECTED, peer marked as rejected
Commit 3: counter=12, msg={allowed:true} → SKIPPED (causal consistency)

Result: Only sub-span (counter=0, len=5) is imported → worldview = "First"
```

### Commits With vs Without Messages

- **Without messages**: Loro batches consecutive commits into a single change. Filter is called once for the entire batch.
- **With messages**: Each commit is a separate change within the span. Filter is called for each, enabling partial acceptance.

In filtering scenarios, commits typically have messages (via `subscribePreCommit` or `setNextCommitMessage`), so partial acceptance is the common case.

## Built-in Filters

### Basic Filters

- `filterNone`: Accept all commits
- `filterAll`: Reject all commits

### Peer-Based Filtering

```typescript
filterByPeers(["111", "222"]); // Accept only from these peers
```

### Message-Based Filtering

```typescript
filterByMessage((msg) => msg.role === "admin");
```

### Composition

```typescript
composeFilters(filter1, filter2); // AND
anyFilter(filter1, filter2); // OR
notFilter(filter1); // NOT
```

## Performance Considerations

1. **Frontier comparison**: O(n) where n is frontier length (typically small)
2. **Commit filtering**: O(commits) per import batch
3. **applyDiff**: Efficient state-based diff, no history traversal
4. **Memory**: Worldview is a fork, shares structure with world

## Error Handling

- Disposed lenses ignore all operations
- Filter errors should be caught by the filter function
- Invalid commits are silently skipped (logged in debug mode)

## Capabilities and Limitations

This section documents empirically verified behavior from the lens investigation tests.

### Divergence Behavior (Most Important)

**Local changes ADD to world state, not overwrite.**

When you make changes through the lens, those changes are applied as a delta to the world. Filtered peer changes are PRESERVED in the world:

```typescript
// World has counter=100 from filtered peer
// Worldview (lens.doc) has counter=0 (filtered)
lens.change((d) => d.counter.increment(5));

// Result:
// - lens.doc.counter = 5 (worldview)
// - lens.source.counter = 105 (world: 100 + 5, NOT 5!)
```

This is GOOD behavior:

- World maintains complete history from all peers
- Worldview provides a filtered _perspective_ without destroying data
- No information loss when writing through the lens

The mechanism: `diff(before, after)` captures only the delta, which is then applied to the world.

### Peer ID Behavior

- `lens.doc` (worldview) uses the world's peer ID (as bigint)
- Writes via lens appear with the world's peer ID
- Multiple participants each see their own peer ID in their lens
- This is correct--each participant's world has their own peer ID

### Container Creation

| Operation              | Status     | Notes                                  |
| ---------------------- | ---------- | -------------------------------------- |
| Simple list push/pop   | ✅ Works   |                                        |
| Map key with primitive | ✅ Works   |                                        |
| Delete map key         | ⚠️ Partial | Results in empty string, not undefined |
| Nested containers      | ⚠️ Limited | typed-refs limitation, not lens        |

**Workaround for nested containers**: Create complex nested structures on the world first, then use lens for modifications.

### Filter Lifecycle

- **New lens starts from current state**: Cannot re-filter historical commits
- **Filter exceptions are caught**: If filter throws, commit is rejected (not propagated to worldview)
- **Non-boolean returns are coerced**: Truthy values → true, falsy values → false

### Nested Lenses

| Direction                    | Behavior                       |
| ---------------------------- | ------------------------------ |
| Inbound (world → worldview)  | Filters compose with AND logic |
| Outbound (worldview → world) | Filters are BYPASSED           |

**Important**: Outbound writes always reach the world regardless of filters. This is inherent to a CRDT convergent world with worldviews--you can't "unsee" data that's already converged.

### Undo/Redo

- Undo is not enabled by default in LoroDoc
- `lens.doc` (worldview) and `lens.source` (world) are separate documents with independent undo stacks
- Changes via `applyDiff` create new commits, not replayed operations

## Testing Strategy

1. **Core tests**: Basic lens operations, filtering, change propagation
2. **Composition tests**: Chained lenses, multi-level propagation
3. **Edge cases**: Dispose handling, concurrent changes, empty filters
4. **Investigation tests**: Empirical verification of capabilities and limitations
