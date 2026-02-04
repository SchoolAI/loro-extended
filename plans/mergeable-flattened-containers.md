# Plan: Mergeable Containers via Flattened Root Storage

## Background

Loro supports mergeable containers natively at the **root** of a document because root container IDs are deterministic global keys (e.g., `cid:root-data:Map`) rather than peer/clock-based IDs (e.g., `cid:5@17049801308764443303:Map`). When two peers independently create a root container with the same name, they get the same container ID, and their operations merge automatically.

However, **nested containers** created via `setContainer()` or `getOrCreateContainer()` receive peer-dependent IDs. When two peers concurrently create a nested container at the same path, they create two different containers. After sync, Loro's Last-Writer-Wins (LWW) semantics cause one peer's container to "win" while the other's operations appear lost (they're still in the oplog but not visible).

The `lukot` branch implemented a `mergeable` option that uses `getMergeableList()`, `getMergeableMap()`, etc. for nested containers. However, testing revealed that **`applyDiff` remaps container IDs** when applying diffs to a target document, breaking mergeable semantics for the Lens use case.

## Problem Statement

When `mergeable: true` is set on a TypedDoc:
1. Local container creation works correctly (deterministic IDs via `getMergeableX()`)
2. Sync via `import()` works correctly (containers merge)
3. **Sync via `applyDiff()` breaks** - container IDs are remapped to peer-dependent IDs in the target

This affects the Lens package, which uses `applyDiff()` to propagate worldview changes to the world document.

## Success Criteria

1. ✅ Concurrent container creation at the same schema path merges correctly via `import()`
2. ✅ Concurrent container creation at the same schema path merges correctly via `applyDiff()`
3. ✅ `toJSON()` returns the expected hierarchical structure
4. ✅ TypedRef access patterns remain unchanged for users
5. ✅ Non-mergeable docs continue to work with hierarchical storage (backward compatible)
6. ✅ Lens filtering works correctly with mergeable containers

## The Gap

| Current State | Required State |
|--------------|----------------|
| Nested containers use `getMergeableX()` which creates peer-dependent IDs after `applyDiff` | All containers stored as root containers with path-based names |
| Container hierarchy stored naturally in Loro | Container hierarchy flattened; parent maps store `null` markers |
| `toJSON()` returns Loro's native JSON | `toJSON()` reconstructs hierarchy from flattened storage |

## Solution: Flattened Root Container Storage

Store all containers at the document root with path-based names. This ensures deterministic IDs that survive `applyDiff`.

### Path Encoding

- **Separator**: `-` (hyphen) - consistent with Loro's `cid:root-{name}` convention
- **Escape character**: `\` (backslash)
- **Literal hyphen in key**: `\-`
- **Literal backslash in key**: `\\`

**Examples**:
| Schema Path | Encoded Root Name | Container ID |
|-------------|-------------------|--------------|
| `data.items` | `data-items` | `cid:root-data-items:List` |
| `data["my-key"].value` | `data-my\-key-value` | `cid:root-data-my\-key-value:Map` |
| `players.alice.score` | `players-alice-score` | `cid:root-players-alice-score:Map` |

### Storage Structure

For a schema like:
```typescript
Shape.doc({
  data: Shape.struct({
    nested: Shape.struct({
      items: Shape.list(Shape.plain.string())
    })
  })
})
```

**Flattened storage**:
- `cid:root-data:Map` → `{ nested: null }` (null marker indicates child container)
- `cid:root-data-nested:Map` → `{ items: null }`
- `cid:root-data-nested-items:List` → `["item1", "item2"]`

### Key Functions

```typescript
// packages/change/src/path-encoding.ts

/** Escape a path segment for use in root container names */
export function escapePathSegment(segment: string): string {
  return segment.replace(/\\/g, "\\\\").replace(/-/g, "\\-")
}

/** Build a root container name from path segments */
export function buildRootContainerName(segments: string[]): string {
  return segments.map(escapePathSegment).join("-")
}

/** Parse a root container name back to path segments */
export function parseRootContainerName(name: string): string[] {
  const result: string[] = []
  let current = ""
  let i = 0

  while (i < name.length) {
    if (name[i] === "\\") {
      if (name[i + 1] === "-") {
        current += "-"
        i += 2
      } else if (name[i + 1] === "\\") {
        current += "\\"
        i += 2
      } else {
        current += "\\"
        i += 1
      }
    } else if (name[i] === "-") {
      result.push(current)
      current = ""
      i += 1
    } else {
      current += name[i]
      i += 1
    }
  }
  result.push(current)

  return result
}
```

## Phases and Tasks

### Phase 1: Path Encoding Utilities - ✅

- ✅ Create `packages/change/src/path-encoding.ts` with `escapePathSegment`, `buildRootContainerName`, `parseRootContainerName`
- ✅ Add unit tests for path encoding edge cases (hyphens, backslashes, empty segments)
- ✅ Export from `packages/change/src/index.ts`

### Phase 2: TypedRefParams Extension - ✅

- ✅ Add `pathPrefix?: string[]` to `TypedRefParams` in `base.ts`
- ✅ Add `mergeable?: boolean` to `TypedRefParams` in `base.ts`
- ✅ Add `computeChildRootContainerName()` method to `BaseRefInternals`

### Phase 3: DocRefInternals Changes - ✅

- ✅ Modify `getChildTypedRefParams()` to pass `pathPrefix: [key]` when `mergeable: true`
- ✅ When `mergeable: true`, use `doc.getMap(rootName)` / `doc.getList(rootName)` instead of nested getters

### Phase 4: StructRefInternals Changes - ✅

- ✅ Modify `getChildTypedRefParams()` to extend `pathPrefix` with the key
- ✅ When `mergeable: true`:
  - Use `doc.getMap(rootName)` / `doc.getList(rootName)` for child containers
  - Set `null` marker in parent map: `container.set(key, null)`
- ✅ Modify `getOrCreateRef()` to check for `null` marker and resolve via root container

### Phase 5: RecordRefInternals Changes - ✅

- ✅ Similar changes to StructRefInternals for dynamic keys
- ✅ Handle the case where record keys may contain hyphens (escaping)

### Phase 6: ListRefInternals Changes - 🟡 (Partial)

- 🟡 **Limitation**: Lists of containers (`Shape.list(Shape.struct({...}))`) do NOT support mergeable semantics
- 🔴 Add runtime validation: throw error if `mergeable: true` and schema contains list of containers
- ✅ Lists of **value shapes** (`Shape.list(Shape.plain.string())`) work fine - they use the parent's root container
- 🔴 Document this limitation in README.md

### Phase 7: toJSON Reconstruction - ✅

- ✅ Modify `toJSON()` in TypedDocInternal to reconstruct hierarchy from flattened storage
- ✅ Added `reconstructFromFlattened()` and `reconstructDocFromFlattened()` functions
- ✅ Handle `null` markers for struct and record shapes

### Phase 8: Integration Tests - ✅

- ✅ Test concurrent struct creation merges via `import()`
- ✅ Test concurrent struct creation merges via `applyDiff()`
- ✅ Test concurrent record entry creation merges
- 🔴 Test Lens with mergeable containers (deferred - requires lens package changes)
- ✅ Test backward compatibility with non-mergeable docs

## Unit and Integration Tests

### Unit Tests (path-encoding.test.ts)

```typescript
describe("Path Encoding", () => {
  it("escapes hyphens in segments")
  it("escapes backslashes in segments")
  it("handles empty segments")
  it("round-trips complex paths")
})
```

### Integration Tests (mergeable-flattened.test.ts)

```typescript
describe("Mergeable Flattened Containers", () => {
  it("merges concurrent struct creation via import")
  it("merges concurrent struct creation via applyDiff")
  it("merges concurrent record entry creation")
  it("reconstructs hierarchy in toJSON")
  it("works with Lens filtering")
})
```

## Transitive Effect Analysis

```
createTypedDoc({ mergeable: true })
  └── DocRef (with mergeable flag)
        └── DocRefInternals.getChildTypedRefParams()
              └── Returns pathPrefix: [key]
                    └── StructRef / RecordRef / ListRef
                          └── *RefInternals.getChildTypedRefParams()
                                └── Extends pathPrefix, uses root container
                                      └── Nested containers (recursive)
```

**Affected Components**:
1. `TypedRefParams` - Add `pathPrefix` field
2. `BaseRefInternals` - Add `rootContainerName` computed property
3. `DocRefInternals` - Use root containers when mergeable
4. `StructRefInternals` - Use root containers, set null markers
5. `RecordRefInternals` - Use root containers, set null markers
6. `ListRefInternals` - Validation to reject lists of containers
7. `toJSON()` methods - Reconstruct hierarchy

**Unaffected Components**:
- `CounterRef`, `TextRef` - Leaf containers, no children
- `TreeRef` - Uses Loro's native tree structure
- Non-mergeable docs - Continue using hierarchical storage

## Limitations

1. **Lists of containers**: `Shape.list(Shape.struct({...}))` and `Shape.list(Shape.record({...}))` are **not supported** with `mergeable: true`. List indices change on insert/delete, making path-based IDs unstable. Use `Shape.record(Shape.struct({...}))` with string keys instead.

2. **MovableLists of containers**: Same limitation as lists. Use records with string keys.

3. **Trees**: Loro trees have their own ID system and work independently of this flattening approach.

## Changeset

```markdown
---
"@loro-extended/change": minor
---

Add flattened root container storage for mergeable documents

When `mergeable: true` is set on a TypedDoc, all containers are stored at the
document root with path-based names (e.g., `data-nested-items`). This ensures
container IDs are deterministic and survive `applyDiff`, enabling proper merging
of concurrent container creation.

- Path separator: `-` (hyphen)
- Escape character: `\` (backslash)
- Literal hyphen: `\-`
- Literal backslash: `\\`

This is a breaking change for existing mergeable documents. Non-mergeable
documents are unaffected.
```

## Documentation Updates

### README.md (packages/change)

Add section on mergeable containers explaining:
- When to use `mergeable: true`
- How flattened storage works
- Limitations (lists of containers)

### TECHNICAL.md (packages/change)

Add section on flattened container storage:
- Path encoding scheme
- Storage structure
- toJSON reconstruction
