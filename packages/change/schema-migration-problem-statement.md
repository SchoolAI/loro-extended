# Schema Migration in CRDTs: Problem Statement

## Executive Summary

Schema migration in CRDT-based systems presents fundamentally different challenges than traditional database migrations. This document articulates the problem space, identifies key trade-offs, and establishes a framework for evaluating potential solutions in the context of `loro-extended/change`.

---

## The Core Problem

**How do we evolve data schemas in a system where there is no single source of truth, peers may be offline for extended periods, and data must remain consistent across all participants?**

Traditional database migrations assume:

1. A single, authoritative database
2. Sequential, coordinated migration execution
3. Downtime or maintenance windows are acceptable
4. Rollback is possible via "down" migrations

CRDT-based systems violate all of these assumptions:

1. **No single authority** - Every peer has equal standing
2. **No coordination** - Peers operate independently
3. **No downtime** - The system must remain available
4. **No rollback** - Operations are append-only and immutable

---

## Problem Dimensions

### Dimension 1: Schema Change Classification

Not all schema changes are equal. We can classify them by their impact on data compatibility:

| Classification    | Description                | P2P Safe   | Example                                              |
| ----------------- | -------------------------- | ---------- | ---------------------------------------------------- |
| **Additive**      | New fields with defaults   | ✅ Yes     | Adding `priority` field to todos (Case 1, V1→V2)     |
| **Widening**      | Expanding allowed values   | ✅ Yes     | `string` → `string \| null`                          |
| **Narrowing**     | Restricting allowed values | ❌ No      | `string \| null` → `string`                          |
| **Renaming**      | Changing field names       | ❌ No      | `content` → `blocks` (Case 2, V2→V3)                 |
| **Restructuring** | Moving/nesting fields      | ❌ No      | Single product → variants (Case 3, V2→V3)            |
| **Type Change**   | Changing field types       | ❌ No      | `Shape.text()` → discriminated union (Case 4, V4→V5) |
| **Removal**       | Deleting fields            | ⚠️ Partial | Removing deprecated fields                           |

### Dimension 2: Deployment Topology

The migration strategy depends heavily on how peers are organized:

```
┌────────────────────────────────────────────────────────────┐
│                     DEPLOYMENT TOPOLOGIES                  │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  Client/Server (Hub-and-Spoke)     Pure P2P (Mesh)         │
│                                                            │
│         ┌───────┐                     ┌───┐                │
│         │Server │                     │ A │                │
│         └───┬───┘                    ╱     ╲               │
│            ╱│╲                    ┌───┐   ┌───┐            │
│           ╱ │ ╲                   │ B │───│ C │            │
│     ┌───┐ ┌───┐ ┌───┐             └───┘   └───┘            │
│     │ A │ │ B │ │ C │                ╲     ╱               │
│     └───┘ └───┘ └───┘                 ┌───┐                │
│                                       │ D │                │
│  Server can coordinate                └───┘                │
│  migrations                        No coordinator          │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

**Client/Server:** The server can act as a migration coordinator, ensuring all clients receive migrated data. This enables breaking changes with proper sequencing.

**Pure P2P:** No coordinator exists. Peers must handle schema mismatches gracefully. Only additive changes are truly safe.

### Dimension 3: Temporal Considerations

```
Timeline of Schema Evolution
────────────────────────────────────────────────────────────────►

Day 1        Day 30       Day 60       Day 90
  │            │            │            │
  ▼            ▼            ▼            ▼
┌────┐      ┌────┐      ┌────┐      ┌────┐
│ V1 │      │ V2 │      │ V3 │      │ V4 │
└────┘      └────┘      └────┘      └────┘
  │            │            │            │
  │            │            │            │
  ▼            ▼            ▼            ▼
All peers   Most peers   Some peers   Peer X returns
at V1       at V2        at V3        from 90-day
            Some at V1   Some at V2   offline with V1
                         Few at V1    data
```

**The Offline Peer Problem:** A peer that goes offline at V1 and returns at V4 must somehow reconcile 90 days of V1 operations with a V4 schema. This is exemplified in:

- Case 1 (Todo): A peer with V1 todos (no IDs) syncing with V4 peers (with IDs, timestamps)
- Case 3 (Catalog): A peer with V1 products syncing with V3 peers (variant structure)

---

## Key Trade-offs

### Trade-off 1: Flexibility vs. Safety

```
                    FLEXIBILITY
                         ▲
                         │
    Breaking Changes ────┼──── Full schema freedom
    (Case 2 V2→V3)       │     Any transformation
                         │     Requires coordination
                         │
                         │
    ─────────────────────┼─────────────────────► SAFETY
                         │
                         │
    Additive Only ───────┼──── Limited evolution
    (Case 1 V1→V3)       │     Always compatible
                         │     No coordination needed
                         │
```

**Additive-only** (high safety, low flexibility):

- Always backward compatible
- No migration code needed
- Schema accumulates "cruft" over time
- Cannot fix design mistakes

**Breaking changes** (low safety, high flexibility):

- Full schema freedom
- Can fix design mistakes
- Requires coordination mechanism
- Risk of data loss or corruption

### Trade-off 2: Data Fidelity vs. Simplicity

When migrating data, we often face lossy transformations:

| Migration                                | Data Loss     | Example                                            |
| ---------------------------------------- | ------------- | -------------------------------------------------- |
| `inStock: boolean` → `inventory: number` | Precision     | Case 3, V2→V3: `true` → `1` (actual count unknown) |
| `content: LoroText` → `blocks: List`     | Edit history  | Case 2, V2→V3: CRDT operations lost                |
| Flatten structure                        | Relationships | Case 3, V3→V4: Implicit groupings lost             |

**High fidelity** approach:

- Preserve all data, even if schema doesn't need it
- Store original values alongside migrated values
- Increases storage and complexity

**Simple** approach:

- Transform data to fit new schema exactly
- Accept data loss as migration cost
- Cleaner schema, potential information loss

### Trade-off 3: Eager vs. Lazy Migration

**Eager migration:**

```typescript
// On document load, migrate everything
const doc = await loadDocument(docId);
const migratedDoc = migrateToLatest(doc);
await saveDocument(docId, migratedDoc);
```

Pros:

- Data is always in latest format
- Simpler read path
- Clear migration boundaries

Cons:

- Expensive for large documents
- Must handle concurrent access during migration
- All-or-nothing (can't partially migrate)

**Lazy migration:**

```typescript
// Migrate on access
class LazyMigratingDoc {
  get(path) {
    const value = this.raw.get(path);
    return migrateValue(value, this.schemaVersion, LATEST_VERSION);
  }
}
```

Pros:

- Amortized migration cost
- Can handle partial data
- No blocking migration step

Cons:

- Complex read path
- Must maintain migration logic indefinitely
- Inconsistent internal state

### Trade-off 4: Version Awareness vs. Transparency

**Version-aware sync:**

```typescript
// Peers negotiate schema version
interface SyncMessage {
  schemaVersion: number
  operations: Operation[]
}

onReceive(msg) {
  if (msg.schemaVersion !== this.version) {
    // Transform or reject
  }
}
```

Pros:

- Explicit handling of version mismatches
- Can reject incompatible data
- Clear upgrade path

Cons:

- Protocol complexity
- Must maintain version compatibility matrix
- Breaks "transparent sync" abstraction

**Transparent sync:**

```typescript
// Sync is schema-agnostic
// Schema is applied at read time
onReceive(msg) {
  this.crdt.merge(msg.operations)  // Always merge
}

read() {
  return applySchema(this.crdt.value, this.schema)  // Interpret at read
}
```

Pros:

- Simple sync protocol
- No version negotiation
- Graceful degradation

Cons:

- Unknown fields accumulate
- Type mismatches cause runtime errors
- Hard to enforce schema constraints

---

## Specific Challenges from Examples

### Challenge 1: ID Generation Conflicts

**From Case 1 (Todo V3→V4) and Case 4 (Chat V1→V2):**

When adding required unique IDs to existing data, different peers will generate different IDs for the same logical entity.

```
Peer A migrates:                    Peer B migrates:
┌─────────────────────┐            ┌─────────────────────┐
│ { text: "Buy milk"} │            │ { text: "Buy milk"} │
│         ↓           │            │         ↓           │
│ { id: "abc-123",    │            │ { id: "xyz-789",    │
│   text: "Buy milk"} │            │   text: "Buy milk"} │
└─────────────────────┘            └─────────────────────┘
                    ↘            ↙
                      Sync conflict!
                    Same item, different IDs
```

**Potential solutions:**

1. Deterministic ID generation based on content hash
2. Server-coordinated migration (client/server only)
3. ID reconciliation protocol (complex)

### Challenge 2: Container Type Changes

**From Case 5 (Kanban V1→V2):**

Changing from `Shape.list()` to `Shape.movableList()` changes the underlying CRDT type from `LoroList` to `LoroMovableList`.

```typescript
// V1: LoroList
cards: Shape.list(Shape.map({ ... }))

// V2: LoroMovableList
cards: Shape.movableList(Shape.map({ ... }))
```

These are different CRDT types with different operation semantics. A `LoroList` operation cannot be applied to a `LoroMovableList`.

**Potential solutions:**

1. Prohibit container type changes (additive-only)
2. Create new container, copy data, tombstone old (breaking)
3. Maintain both containers during transition period (complex)

### Challenge 3: Structural Flattening/Nesting

**From Case 2 (Document V2→V3) and Case 3 (Catalog V3→V4):**

When structure changes, CRDT operation paths become invalid:

```
V2 path: "content"           →  V3 path: "blocks[0].content"
V3 path: "products[0].name"  →  V4 path: "products[0].localizations.en.name"
```

Historical operations targeting old paths cannot be replayed against new structure.

**Potential solutions:**

1. Path translation layer (complex, error-prone)
2. Snapshot-based migration (loses operation history)
3. Dual-write during transition (temporary complexity)

### Challenge 4: CRDT to Value Conversion

**From Case 4 (Chat V4→V5):**

Converting a CRDT container to a plain value loses collaborative editing capability:

```typescript
// V4: Collaborative text editing
content: Shape.text()  // LoroText CRDT

// V5: Plain value (last-write-wins)
content: Shape.plain.discriminatedUnion("type", { ... })
```

Any concurrent edits to `content` during migration will conflict at the structural level, not the text level.

**Potential solutions:**

1. Prohibit CRDT→Value conversions (additive-only)
2. Freeze CRDT, snapshot to value (loses concurrent edits)
3. Maintain CRDT for legacy, value for new (dual storage)

---

## Requirements for a Solution

Based on this analysis, any schema migration solution for `loro-extended/change` should address:

### Must Have

1. **Clear classification** of safe vs. unsafe changes
2. **Additive evolution support** with minimal ceremony
3. **Placeholder integration** for new fields
4. **Version tracking** in documents or metadata

### Should Have

5. **Migration function API** for breaking changes
6. **Client/server coordination** support
7. **Validation** of migration safety
8. **Deprecation markers** for phased removal

### Nice to Have

9. **Automatic migration** for simple cases
10. **Version negotiation protocol** for P2P
11. **Migration dry-run/preview**
12. **Rollback support** where possible

---

## Open Questions

1. **Where should version information live?**

   - In the document itself (syncs with data)
   - In metadata/headers (separate from data)
   - Derived from schema hash (implicit)

2. **How do we handle the "long offline" scenario?**

   - Reject stale data?
   - Force migration on reconnect?
   - Maintain indefinite backward compatibility?

3. **Should migrations be reversible?**

   - "Down" migrations enable rollback but may lose data
   - One-way migrations are simpler but riskier

4. **How do we test migrations?**

   - Property-based testing of round-trips?
   - Snapshot testing of known data?
   - Fuzzing with random schema combinations?

5. **What's the upgrade path for existing loro-extended users?**
   - How do we introduce versioning to unversioned documents?
   - Can we auto-detect schema from data shape?

---

## Next Steps

1. **Define the additive-only API** - `Shape.evolve()` or similar
2. **Prototype version tracking** - Embed in DocShape or separate
3. **Design migration function interface** - For breaking changes
4. **Create test suite** - Based on examples in schema-evolution-examples.md
5. **Document best practices** - Guide users toward safe patterns

---

## References

- [schema-evolution-examples.md](./schema-evolution-examples.md) - Detailed migration case studies
- [shape.ts](./src/shape.ts) - Current schema definition API
- [overlay.ts](./src/overlay.ts) - Placeholder merging logic
- [derive-placeholder.ts](./src/derive-placeholder.ts) - Default value derivation
