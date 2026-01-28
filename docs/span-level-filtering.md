# Span-Level Filtering in LEA 4.0

This document captures our learnings about span-level filtering as an alternative to operation-level filtering in LEA 4.0, given Loro's `applyDiff` container creation limitation.

## The Constraint

Loro's `applyDiff` operates at the **state level** and cannot create new containers. When remote peers create containers (lists, maps, text, etc.), `applyDiff` fails with `ContainersNotFound`.

```
applyDiff: State-level → Cannot create containers
import:    Operation-level → Can create containers with proper CRDT metadata
```

This means LEA 4.0's original design (using `applyDiff` for World→Worldview propagation with operation-level filtering) doesn't work when remote changes include container creation.

## The Solution: Span-Level Import Filtering

Instead of filtering at the operation level via `applyDiff`, we filter at the **span/commit level** via `import`:

```typescript
// 1. Import remote changes to a temp doc for inspection
const tempDoc = new LoroDoc();
tempDoc.import(remoteUpdate);

// 2. Find what changed
const spans = tempDoc.findIdSpansBetween(prevFrontiers, tempDoc.frontiers());

// 3. Inspect each span's operations
for (const span of spans.forward) {
  const changes = tempDoc.exportJsonInIdSpan(span);
  
  // 4. Validate operations
  if (validateChanges(changes, peerId)) {
    // 5. Export and import only valid spans
    const validUpdate = tempDoc.export({
      mode: "updates-in-range",
      spans: [{ id: { peer: span.peer, counter: span.counter }, len: span.length }]
    });
    worldview.import(validUpdate);
  }
}
```

## Key APIs

| API | Purpose |
|-----|---------|
| `findIdSpansBetween(from, to)` | Get spans between two frontiers |
| `exportJsonInIdSpan(span)` | Inspect operations in a span as JSON |
| `export({ mode: "updates-in-range", spans })` | Export specific spans as bytes |
| `import(bytes)` | Import with container creation support |

## What Span-Level Filtering CAN Do

### ✅ Inspect every operation before deciding to import

```typescript
const spans = doc.findIdSpansBetween([], doc.frontiers());
const changes = spans.forward.flatMap(span => doc.exportJsonInIdSpan(span));
const allOps = changes.flatMap(c => c.ops);

// See exactly what operations are in the commit
// {
//   container: "cid:root-game:Map",
//   content: { type: "insert", key: "phase", value: "choosing" },
//   counter: 0
// }
```

### ✅ Reject an entire commit if ANY operation is invalid

```typescript
// Bob tries to sneak in a cheat with valid operations
const game = bob.getMap("game");
const players = game.setContainer("players", new LoroMap());
players.set(`${BOB_PEER}:choice`, "rock");  // Valid
game.set("phase", "reveal");                 // INVALID - sneaking in a cheat
bob.commit();

// We can detect the invalid operation and reject the ENTIRE commit
const isValid = validateRPSMove(changes, BOB_PEER);
// false - the phase write invalidates everything
```

### ✅ Accept commits from one peer while rejecting from another

```typescript
// Alice's commit is valid
expect(validateRPSMove(aliceChanges, ALICE_PEER)).toBe(true);

// Bob's commit is invalid
expect(validateRPSMove(bobChanges, BOB_PEER)).toBe(false);

// Import only Alice's changes
```

### ✅ Handle multiple commits independently

```typescript
// Commit 1: Valid
players.set(`${BOB_PEER}:choice`, "rock");
bob.commit();
const afterCommit1 = bob.frontiers();

// Commit 2: Invalid
game.set("phase", "reveal");
bob.commit();

// Validate each commit separately
const commit1Spans = bob.findIdSpansBetween([], afterCommit1);
const commit2Spans = bob.findIdSpansBetween(afterCommit1, bob.frontiers());

validateRPSMove(commit1Changes, BOB_PEER);  // true
validateRPSMove(commit2Changes, BOB_PEER);  // false
```

### ✅ Detect and validate container creation

```typescript
// Find container creation ops (value starts with "🦜:")
const containerCreations = allOps.filter(op => {
  if (op.content.type === "insert" && "value" in op.content) {
    const value = op.content.value;
    return typeof value === "string" && value.startsWith("🦜:");
  }
  return false;
});

// Validate what containers are being created
const createdContainerIds = containerCreations.map(op => 
  op.content.value.replace("🦜:", "")
);
// ["cid:0@2:Map"] - Bob created a Map container
```

### ✅ Validate based on current state AND the diff

```typescript
// Check current state
const currentPhase = server.getMap("game").get("phase");
const isValidPhase = currentPhase === "choosing";

// Check the diff
const isValidDiff = validateRPSMove(changes, BOB_PEER);

// Both must be true
if (isValidPhase && isValidDiff) {
  server.import(bobUpdate);
}
```

## What Span-Level Filtering CANNOT Do

### ❌ Accept some operations from a commit while rejecting others

This is the key limitation. If Bob puts valid and invalid ops in the SAME commit, we must accept or reject the entire commit:

```typescript
// Bob makes ONE commit with mixed valid/invalid ops
players.set(`${BOB_PEER}:choice`, "rock");      // Valid
players.set(`${ALICE_PEER}:choice`, "scissors"); // Invalid - Alice's data!
bob.commit();

// We can SEE both operations
// We can IDENTIFY the invalid one
// But we CANNOT import just the valid ops from this commit
// We must reject the entire commit
```

## Implications for Application Design

### Trust Model Shift

```
Original LEA 4.0:  "Filter validates each operation"
Revised LEA 4.0:   "Filter validates each commit; peers commit responsibly"
```

### Application Conventions

1. **One commit = one logical action** - Peers should commit related changes together
2. **Separate commits for different concerns** - Don't mix player moves with game state changes
3. **Validate at commit boundaries** - Accept/reject entire commits, not individual fields

### Security Model

The security model becomes:

> "I trust or don't trust this peer's commits as a whole"

Rather than:

> "I accept this field but reject that field from the same commit"

For many applications (games, collaborative editing with roles), this is sufficient.

## Example: RPS Validation Rules

```typescript
function validateRPSMove(changes: JsonChange[], peerId: string): boolean {
  for (const change of changes) {
    for (const op of change.ops) {
      // Rule 1: Players cannot write to game root (phase, result)
      if (op.container.includes("root-game")) {
        if (op.content.type === "insert" && "key" in op.content) {
          const key = op.content.key;
          if (key === "phase" || key === "result") {
            return false;  // REJECT
          }
        }
      }

      // Rule 2: Players can only write to their own namespace
      if (op.container.includes("players")) {
        if (op.content.type === "insert" && "key" in op.content) {
          const key = op.content.key;
          if (key.includes(":") && !key.startsWith(`${peerId}:`)) {
            return false;  // REJECT - writing to another player's data
          }
        }
      }
    }
  }
  return true;  // ACCEPT
}
```

## Alignment with Problem Space Scenarios

| Scenario | Needs Filtering? | Span-Level Works? | Notes |
|----------|------------------|-------------------|-------|
| RPC | No | N/A | Document topology |
| P2P Mesh | No | N/A | Document topology |
| Collab Edit (Full Trust) | No | ✅ | No filter needed |
| Role-Based Collab | Yes | ⚠️ | Reduced granularity |
| Hidden Info Game | No | N/A | Needs doc topology + crypto |
| Asymmetric Info | No | N/A | Needs encryption |
| Audit Trail | No | N/A | Uses redaction API |
| Ownership Transfer | Yes | ⚠️ | Works with conventions |
| Federated | No | N/A | Document topology |
| Offline-First | No | ✅ | No filter needed |

## Conclusion

Span-level filtering provides **sufficient control** for most LEA 4.0 use cases:

1. **Full visibility** into what operations a peer is attempting
2. **Accept/reject at commit level** - detect cheating and reject entire commits
3. **Container creation works** - using `import` instead of `applyDiff`
4. **State-aware validation** - check both current state and incoming diff

The main trade-off is filtering granularity: we validate at commit boundaries, not operation boundaries. This aligns with how real distributed systems work—you trust peers to follow protocols and validate at trust boundaries.

---

## Architecture: Temp Doc Pattern

A key pattern that emerged from testing is the **temp doc pattern** for safe inspection:

```typescript
// 1. Import to a temporary doc first (not your worldview)
const tempDoc = new LoroDoc();
tempDoc.import(remoteUpdate);

// 2. Inspect the changes safely
const spans = tempDoc.findIdSpansBetween(prevFrontiers, tempDoc.frontiers());
const changes = spans.forward.flatMap(span => tempDoc.exportJsonInIdSpan(span));

// 3. Validate
const isValid = validateChanges(changes, peerId);

// 4. Only import to worldview if valid
if (isValid) {
  worldview.import(remoteUpdate);
}
```

This pattern ensures you never pollute your worldview with invalid data, even temporarily.

## Revised LEA 4.0 Architecture

Given span-level filtering, the World/Worldview architecture becomes:

```
┌──────────────────────────────────────────────────────────────────┐
│                           WORLD                                  │
│                    (Shared LoroDoc)                              │
│                                                                  │
│  • Synced via network (repo)                                     │
│  • Standard CRDT convergence                                     │
│  • Contains ALL operations from ALL peers                        │
└──────────────────────────────────────────────────────────────────┘
          ▲                              │
          │ export/import                │ import() from peers
          │ (local writes)               │ (remote writes)
          │                              ▼
          │                    ┌─────────────────────┐
          │                    │   TEMP DOC          │
          │                    │   (inspection)      │
          │                    └─────────────────────┘
          │                              │
          │                              │ validate spans
          │                              │ export valid spans
          │                              ▼
┌──────────────────────────────────────────────────────────────────┐
│                         WORLDVIEW                                │
│                    (Forked LoroDoc)                              │
│                                                                  │
│  • All local writes happen here                                  │
│  • Receives VALIDATED remote changes via import()                │
│  • Reactors observe transitions here                             │
│  • UI reads from here                                            │
└──────────────────────────────────────────────────────────────────┘
```

Key changes from original LEA 4.0:
- Uses `import()` instead of `applyDiff()` for World→Worldview
- Adds temp doc for safe inspection before import
- Filtering happens at span/commit level, not operation level

---

*See also: [`packages/lea/src/span-filter.test.ts`](../packages/lea/src/span-filter.test.ts) for working examples.*
