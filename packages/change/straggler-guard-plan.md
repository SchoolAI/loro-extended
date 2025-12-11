# Straggler Guard: Protecting Against "Zombie Data" in Schema Migrations

## 1. Problem Statement: The "Zombie Data" Risk

In a local-first, peer-to-peer system, schema migrations are not atomic global events. They propagate asynchronously. This creates a dangerous window where peers are on different schema versions.

**The Scenario:**

1.  **Peer A (V2)** migrates a document. It reads `messages` (V1), transforms it to `_v2_messages` (V2), and writes it.
2.  **Peer B (V1)** is offline or hasn't refreshed. It continues to write to `messages` (V1).
3.  **Sync Happens:** Peer A receives Peer B's new V1 writes.
4.  **The Failure:** Peer A's application logic _only_ looks at `_v2_messages`. Because `_v2_messages` exists, the migration logic assumes migration is complete and ignores `messages`.
5.  **Result:** Peer B's writes are successfully synced to the CRDT but are **invisible** to the application. They become "Zombie Data"—present in the history but dead to the user.

## 2. The Solution: Active Conflict Detection

We cannot prevent Peer B from writing to V1 (we can't lock the world). Instead, we must **detect** when this happens and provide a way to resolve it.

### Core Mechanism: `StragglerGuard`

The `StragglerGuard` will monitor the document for "anachronistic" writes—writes to a deprecated key that occur _causally after_ the migration to the new key.

#### How it works (Algorithm)

1.  **Identify Migrated Fields:** On startup (or schema change), `TypedDoc` registers all fields that have a `migrateFrom` definition.
2.  **Monitor Changes:** We subscribe to `doc.subscribe((event) => ...)` to listen for all local and remote changes.
3.  **Check for Violations:**
    When an update occurs on a `sourceKey` (e.g., `messages`):
    - Check if the `targetKey` (e.g., `_v2_messages`) _already exists_ in the document.
    - If `targetKey` exists, this is a potential conflict.
    - **Causal Check (Crucial):** We need to determine if the write to `sourceKey` happened _after_ `targetKey` was created.
      - We can use `doc.travelChangeAncestors` or compare Lamport timestamps if available.
      - _Simplification:_ If `targetKey` exists and we receive _new_ ops on `sourceKey`, it's a conflict. The only valid writes to `sourceKey` should be _concurrent_ with the migration (which Loro handles via convergence, though we might still want to re-run migration) or _before_ it.
      - _Refined Logic:_ If we see a change to `sourceKey`, and `targetKey` is _already populated_, we flag it.

### 3. Developer Experience (DevX)

We want to make this complex distributed systems problem manageable for application developers.

#### API Vision

```typescript
// 1. Setup (Automatic)
const doc = new TypedDoc(MySchema);

// 2. Listen for Conflicts
doc.on("migration-conflict", (event) => {
  console.warn("Zombie data detected!", event);

  // event details:
  // {
  //   path: ['messages'],
  //   sourceKey: 'messages',
  //   targetKey: '_v2_messages',
  //   value: [...], // The data that is being ignored
  // }

  // 3. Resolution Strategies

  // Option A: Notify User
  alert("New legacy data received. Please refresh to migrate it.");

  // Option B: Auto-Resolve (Re-migrate)
  // This attempts to merge the new V1 data into V2
  event.resolve(async () => {
    // Custom logic to read V1, transform, and merge into V2
    // Or trigger a "Re-Migration" pass
  });
});
```

#### "Re-Migration" Helper

We can provide a default resolution strategy: **Incremental Re-migration**.
If new V1 data arrives, we can:

1.  Read the _current_ V1 state.
2.  Run the `transform` again.
3.  Diff the result against the _current_ V2 state.
4.  Apply the diff to V2.

_Note:_ This requires the `transform` to be idempotent and deterministic.

## 4. Implementation Plan using Loro APIs

Based on `loro_wasm.d.ts`, we have powerful tools:

1.  **`doc.subscribe(listener)`**:

    - Gives us `LoroEventBatch`.
    - Contains `events`, each with `path` and `diff`.
    - We can check if `event.path[0]` matches a `sourceKey`.

2.  **`doc.getChangeAt(id)`**:

    - Allows inspecting the causal history if needed.

3.  **`doc.subscribeLocalUpdates` / `import`**:
    - We hook into the sync pipeline.

### Proposed Class Structure

```typescript
export class StragglerGuard {
  constructor(private doc: LoroDoc, private schema: DocShape) {
    this.startMonitoring();
  }

  private startMonitoring() {
    this.doc.subscribe((eventBatch) => {
      this.checkBatch(eventBatch);
    });
  }

  private checkBatch(batch: LoroEventBatch) {
    // 1. Map schema to find all Source Keys -> Target Keys
    const migrations = this.getActiveMigrations();

    for (const event of batch.events) {
      // 2. Check if event path matches a source key
      const rootKey = event.path[0].toString();
      const migration = migrations.get(rootKey);

      if (migration) {
        // 3. Check if target key exists
        if (
          this.doc.isContainerExists(migration.targetContainerId) ||
          this.doc.getShallowValue()[migration.targetKey]
        ) {
          // 4. CONFLICT DETECTED
          this.emitConflict(migration, event);
        }
      }
    }
  }
}
```

## 5. Integration Steps

1.  **Create `StragglerGuard` class** in `packages/change/src/straggler-guard.ts`.
2.  **Initialize it** inside `TypedDoc` constructor.
3.  **Expose Event Emitter** on `TypedDoc` to bubble up these events.
4.  **Add `reMigrate()` method** to `TypedDoc` to allow manual triggering of the migration logic on specific fields (useful for resolution).
