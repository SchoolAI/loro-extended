# Worldview Simplification Plan

## Background

The `@loro-extended/lens` package provides bidirectional filtered synchronization between a "world" (shared CRDT document) and a "worldview" (filtered perspective). The current implementation requires users to:

1. Call `createLens(world, options)` to get a `Lens<D>` object
2. Use `change(lens, fn, options)` to make changes (a special function that propagates to world)
3. Read from `lens.worldview` (the filtered TypedDoc)

This design was necessary because:
- Changes to the worldview must propagate to the world via `applyDiff`
- Commit messages must be preserved during propagation
- Chained lenses need message passing between levels

## Problem Statement

The current API requires a special `change(lens, fn)` function instead of the standard `change(doc, fn)` from `@loro-extended/change`. This creates cognitive overhead and API inconsistency.

**Key Insight**: Loro's `subscribePreCommit` API allows intercepting commits before they're applied, capturing the commit message. Combined with a regular `subscribe` callback, we can automatically propagate worldview changes to the world without requiring a special `change()` function.

## Success Criteria

1. ✅ Users can call `change(worldview, fn, { commitMessage })` directly on the worldview TypedDoc
2. ✅ Changes automatically propagate to the world via `applyDiff`
3. ✅ Commit messages are preserved during propagation
4. ✅ Chained worldviews work correctly
5. ✅ All existing lens tests pass (rewritten for new API)
6. ✅ Filters work correctly (causal consistency maintained)
7. ✅ No WeakMap needed for message passing
8. ✅ Simpler mental model for users

## The Gap

| Current | Target |
|---------|--------|
| `Lens<D>` type with `worldview`, `world`, `dispose` | `{ worldview: TypedDoc<D>, dispose: () => void }` |
| `change(lens, fn, opts)` special function | `change(worldview, fn, opts)` standard function |
| WeakMap for inter-lens message passing | `subscribePreCommit` for message capture |
| 2 subscriptions (world + worldview) | 3 subscriptions (world + worldview + preCommit) |
| Re-export `change` from lens package | No re-export needed |
| `createLens` function | `createWorldview` function (clean break) |

## Architecture

### Core Design

```typescript
function createWorldview<D extends DocShape>(
  world: TypedDoc<D>,
  options?: { filter?: LensFilter; debug?: DebugFn }
): { worldview: TypedDoc<D>; dispose: () => void }
```

### Data Flow

```
┌─────────────────────────────────────────────────────────────┐
│                         WORLD                               │
│  - Receives all commits (CRDT convergence)                  │
│  - Synced externally (Repo, etc.)                           │
└─────────────────────────────────────────────────────────────┘
        │                                    ▲
        │ subscribe()                        │ applyDiff()
        │ → filter commits                   │ + setNextCommitMessage()
        │ → import accepted                  │
        ▼                                    │
┌─────────────────────────────────────────────────────────────┐
│                       WORLDVIEW                             │
│  - Contains filtered commits                                │
│  - UI reads from here                                       │
│  - change(worldview, fn) writes here                        │
│  - subscribePreCommit captures message                      │
│  - subscribe propagates to world                            │
└─────────────────────────────────────────────────────────────┘
```

### Implementation Pattern

```typescript
function createWorldview<D extends DocShape>(
  world: TypedDoc<D>,
  options?: { filter?: LensFilter; debug?: DebugFn }
): { worldview: TypedDoc<D>; dispose: () => void } {
  const filter = options?.filter ?? (() => true)
  const debug = options?.debug
  
  const worldLoroDoc = loro(world)
  const worldviewLoroDoc = worldLoroDoc.fork()
  worldviewLoroDoc.setPeerId(worldLoroDoc.peerId)
  const worldviewDoc = createTypedDoc(ext(world).docShape, { doc: worldviewLoroDoc })
  
  let isProcessing = false
  let lastWorldFrontiers = worldLoroDoc.frontiers()
  let lastWorldviewFrontiers = worldviewLoroDoc.frontiers()
  let pendingMessage: string | undefined
  
  // 1. Capture commit message before commit is applied
  const unsubPreCommit = worldviewLoroDoc.subscribePreCommit((e) => {
    if (!isProcessing) {
      pendingMessage = e.changeMeta.message
      debug?.(`preCommit: captured message=${pendingMessage}`)
    }
  })
  
  // 2. World → Worldview: Filter external imports
  const unsubWorld = worldLoroDoc.subscribe((event) => {
    if (isProcessing) return
    if (event.by !== 'import') return  // Only external imports
    
    debug?.(`world subscription: event.by=${event.by}`)
    isProcessing = true
    try {
      const newFrontiers = worldLoroDoc.frontiers()
      filterAndImport(worldLoroDoc, worldviewLoroDoc, lastWorldFrontiers, newFrontiers, filter)
      lastWorldFrontiers = newFrontiers
      lastWorldviewFrontiers = worldviewLoroDoc.frontiers()
    } finally {
      isProcessing = false
    }
  })
  
  // 3. Worldview → World: Propagate local changes
  const unsubWorldview = worldviewLoroDoc.subscribe((event) => {
    if (isProcessing) return
    if (event.by !== 'local') return
    
    debug?.(`worldview subscription: event.by=${event.by}`)
    isProcessing = true
    try {
      const newWorldviewFrontiers = worldviewLoroDoc.frontiers()
      const diff = worldviewLoroDoc.diff(lastWorldviewFrontiers, newWorldviewFrontiers, false)
      
      worldLoroDoc.applyDiff(diff)
      if (pendingMessage) {
        worldLoroDoc.setNextCommitMessage(pendingMessage)
        debug?.(`propagating message=${pendingMessage}`)
        pendingMessage = undefined
      }
      worldLoroDoc.commit()
      
      lastWorldFrontiers = worldLoroDoc.frontiers()
      lastWorldviewFrontiers = newWorldviewFrontiers
    } finally {
      isProcessing = false
    }
  })
  
  return {
    worldview: worldviewDoc,
    dispose: () => {
      unsubPreCommit()
      unsubWorld()
      unsubWorldview()
    }
  }
}
```

### Chained Worldviews

For chained worldviews, the pattern works naturally:

```typescript
const { worldview: wv1, dispose: d1 } = createWorldview(world, { filter: filterA })
const { worldview: wv2, dispose: d2 } = createWorldview(wv1, { filter: filterB })

// User calls change(wv2, fn, { commitMessage })
// 1. wv2's subscribePreCommit captures the message
// 2. wv2's subscribe propagates to wv1 with the message
// 3. wv1's subscribePreCommit captures the message (from wv2's commit)
// 4. wv1's subscribe propagates to world with the message
```

The commit message flows through because each level:
1. Captures the message via `subscribePreCommit` before the commit
2. Propagates via `subscribe` after the commit, using `setNextCommitMessage`

## Phases and Tasks

### Phase 1: Implement createWorldview 🔴

- 🔴 **Task 1.1**: Replace `lens.ts` with `worldview.ts` containing `createWorldview` function
- 🔴 **Task 1.2**: Implement `subscribePreCommit` for message capture
- 🔴 **Task 1.3**: Implement world subscription for filtered import (preserve filter logic)
- 🔴 **Task 1.4**: Implement worldview subscription for propagation
- 🔴 **Task 1.5**: Handle `isProcessing` flag to prevent loops
- 🔴 **Task 1.6**: Update `types.ts` - remove `Lens<D>` type, add `Worldview<D>` type
- 🔴 **Task 1.7**: Update `index.ts` exports

### Phase 2: Rewrite Tests 🔴

- 🔴 **Task 2.1**: Rewrite `lens.test.ts` as `worldview.test.ts` with new API
- 🔴 **Task 2.2**: Test `createWorldview` basic functionality
- 🔴 **Task 2.3**: Test `change(worldview, fn)` propagation to world
- 🔴 **Task 2.4**: Test commit message preservation
- 🔴 **Task 2.5**: Test chained worldviews with message propagation
- 🔴 **Task 2.6**: Test filtering (causal consistency)
- 🔴 **Task 2.7**: Test re-entrancy (change in subscription callback)

### Phase 3: Verify Tests 🔴

- 🔴 **Task 3.1**: Run all worldview tests
- 🔴 **Task 3.2**: Run composition tests
- 🔴 **Task 3.3**: Run sovereign tests

### Phase 4: Update Documentation 🔴

- 🔴 **Task 4.1**: Rewrite README.md with new API
- 🔴 **Task 4.2**: Rewrite TECHNICAL.md with new architecture
- 🔴 **Task 4.3**: Create changeset

### Phase 5: Update Dependents 🔴

- 🔴 **Task 5.1**: Update hooks-core to use new API
- 🔴 **Task 5.2**: Run hooks-core tests
- 🔴 **Task 5.3**: Update rps-demo to use new API
- 🔴 **Task 5.4**: Run rps-demo tests

## Tests

### New Tests (Phase 1)

```typescript
describe("createWorldview", () => {
  it("creates a worldview from a world", () => {
    const world = createTypedDoc(TestSchema)
    const { worldview, dispose } = createWorldview(world)
    
    expect(worldview).toBeDefined()
    expect(loro(worldview).peerId).toBe(loro(world).peerId)
    
    dispose()
  })
  
  it("propagates change(worldview, fn) to world", () => {
    const world = createTypedDoc(TestSchema)
    const { worldview, dispose } = createWorldview(world)
    
    change(worldview, d => {
      d.counter.increment(5)
    })
    
    expect(worldview.counter.value).toBe(5)
    expect(world.counter.value).toBe(5)
    
    dispose()
  })
  
  it("preserves commit messages during propagation", () => {
    const world = createTypedDoc(TestSchema)
    const { worldview, dispose } = createWorldview(world)
    
    const worldLoroDoc = loro(world)
    const frontiersBefore = worldLoroDoc.frontiers()
    
    change(worldview, d => {
      d.counter.increment(1)
    }, { commitMessage: "test-message" })
    
    const frontiersAfter = worldLoroDoc.frontiers()
    const spans = worldLoroDoc.findIdSpansBetween(frontiersBefore, frontiersAfter)
    const changes = spans.forward.flatMap(span =>
      worldLoroDoc.exportJsonInIdSpan({
        peer: span.peer,
        counter: span.counter,
        length: span.length,
      })
    )
    
    expect(changes).toHaveLength(1)
    expect(changes[0].msg).toBe("test-message")
    
    dispose()
  })
  
  it("propagates commit messages through chained worldviews", () => {
    const world = createTypedDoc(TestSchema)
    const { worldview: wv1, dispose: d1 } = createWorldview(world)
    const { worldview: wv2, dispose: d2 } = createWorldview(wv1)
    
    const worldLoroDoc = loro(world)
    const frontiersBefore = worldLoroDoc.frontiers()
    
    change(wv2, d => {
      d.counter.increment(1)
    }, { commitMessage: "chained-message" })
    
    const frontiersAfter = worldLoroDoc.frontiers()
    const spans = worldLoroDoc.findIdSpansBetween(frontiersBefore, frontiersAfter)
    const changes = spans.forward.flatMap(span =>
      worldLoroDoc.exportJsonInIdSpan({
        peer: span.peer,
        counter: span.counter,
        length: span.length,
      })
    )
    
    expect(changes).toHaveLength(1)
    expect(changes[0].msg).toBe("chained-message")
    
    // Verify propagation through chain
    expect(world.counter.value).toBe(1)
    expect(wv1.counter.value).toBe(1)
    expect(wv2.counter.value).toBe(1)
    
    d2()
    d1()
  })
})
```

## Transitive Effect Analysis

### Direct Dependencies

| Package | Current Usage | New Usage | Impact |
|---------|---------------|-----------|--------|
| `@loro-extended/hooks-core` | `createLens`, `Lens`, `change` from lens | `createWorldview`, `change` from change | API update required |
| `examples/rps-demo` | `createLens`, `CommitInfo`, `LensFilter` | `createWorldview`, same types | API update required |

### Indirect Dependencies

| Package | Path | Impact |
|---------|------|--------|
| `@loro-extended/react` | → hooks-core → lens | Behavior unchanged after hooks-core update |
| Apps using `useLens` | → react → hooks-core → lens | Behavior unchanged |

### API Surface Changes

```typescript
// Before
import { createLens, change, Lens } from "@loro-extended/lens"
const lens = createLens(world, { filter })
change(lens, fn, { commitMessage })
lens.worldview  // TypedDoc
lens.world      // TypedDoc
lens.dispose()

// After
import { createWorldview } from "@loro-extended/lens"
import { change } from "@loro-extended/change"
const { worldview, dispose } = createWorldview(world, { filter })
change(worldview, fn, { commitMessage })
worldview       // TypedDoc (direct access)
dispose()
```

## Preserved Code

The following will be preserved unchanged:

1. **Filter logic** (`filterWorldToWorldview`): Causal consistency, exception safety
2. **Commit info parsing** (`parseCommitInfo`): Clean ID extraction
3. **Built-in filters** (`filters.ts`): All filter utilities
4. **Type definitions** (`types.ts`): `WorldviewFilter`, `CommitInfo`, `WorldviewOptions`, `DebugFn`

## Changeset

```markdown
---
"@loro-extended/lens": major
---

Simplified worldview API using subscribePreCommit

BREAKING CHANGES:
- `createLens` replaced with `createWorldview` (no alias)
- `Lens<D>` type replaced with `Worldview<D>`
- `change` no longer re-exported (use from `@loro-extended/change`)
- `lens.world` removed (track world reference separately if needed)
- `LensFilter` renamed to `WorldviewFilter`
- `LensOptions` renamed to `WorldviewOptions`

NEW:
- `change(worldview, fn, { commitMessage })` works directly on worldview TypedDoc
- Commit messages automatically propagate to world via `subscribePreCommit`
- Simpler mental model: worldview is just a TypedDoc with automatic propagation

INTERNAL:
- Uses `subscribePreCommit` to capture commit messages before commit
- Uses `subscribe` to propagate changes after commit
- Eliminates WeakMap for inter-lens message passing
- 3 subscriptions instead of 2 (preCommit + world + worldview)
```

## Documentation Updates

### README.md

Complete rewrite with new API:
1. Show `createWorldview` as the primary function
2. Show `change(worldview, fn)` from `@loro-extended/change`
3. Update all examples
4. Remove all references to `Lens`, `createLens`, `lens.world`

### TECHNICAL.md

Complete rewrite with new architecture:
1. Update architecture diagram to show `subscribePreCommit`
2. Explain message capture pattern
3. Update subscription strategy section
4. Remove WeakMap discussion
5. Document the 3-subscription pattern
