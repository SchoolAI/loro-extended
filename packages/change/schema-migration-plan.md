# Schema Migration Implementation Plan

This plan outlines the steps to implement a robust, granular schema migration system for `loro-extended/change` using the "Mapped Schema" approach.

## Core Concept

We will decouple the **Logical Schema** (public API) from the **Physical Storage** (CRDT keys). This allows us to version individual fields independently, enabling non-additive changes without breaking older clients or requiring global document versioning.

### The API Vision

```typescript
const ChatSchema = Shape.doc({
  // Simple field (Logical name == Physical key)
  title: Shape.text(),

  // Versioned field
  messages: Shape.list(Shape.map({ ... }))
    .key("_v2_messages") // Map logical 'messages' to physical '_v2_messages'
    .migrateFrom({
      key: "_v1_messages", // If _v2 is empty, look here
      shape: Shape.list(Shape.text()), // Shape of the old data
      transform: (v1Data) => v1Data.map(text => ({ type: 'text', content: text }))
    })
})
```

---

## Phase 1: Foundation & API Design

**Goal:** Extend the `Shape` type system to support storage keys and migration definitions without breaking existing functionality.

1.  **Extend `Shape` Interface:**

    - Add optional `_key?: string` property to `Shape` interface.
    - Add optional `_migration?: MigrationDefinition` property.
    - Update `Shape` factory methods to support chaining `.key()` and `.migrateFrom()`.

2.  **Define `MigrationDefinition`:**

    - Needs `sourceKey`: string
    - Needs `sourceShape`: Shape (to parse the old data correctly)
    - Needs `transform`: (data: OldType) => NewType

3.  **Update `TypedDoc` Initialization:**
    - `TypedDoc` needs to be aware of these mappings.
    - Currently, `TypedDoc` uses the shape structure directly. We need to ensure it respects the `_key` if present when creating `DocRef` and other proxies.

## Phase 2: Read-Time Migration (Eager Migration)

**Goal:** Implement the logic to read from the new key, and if missing, read-transform-write from the old key.

1.  **Enhance `DocRef` / `MapRef` Accessors:**

    - When accessing a property (e.g., `doc.messages`):
      1.  **Existence Check:** Check if the primary key (`_v2_messages`) _exists_ in the underlying map using `getShallowValue()`.
          - _Crucial:_ Do NOT just check if it's empty. An empty list `[]` is valid V2 data.
      2.  If it exists, return the V2 container.
      3.  If it is MISSING and a migration is defined:
          - Read the source key (`_v1_messages`).
          - If source has data:
            - Run the `transform` function.
            - **Eager Migration:** Initialize the `_v2_messages` container with the transformed data immediately.
            - _Reasoning:_ We cannot easily create a "Read-Only" proxy for a Loro List/Map that reads from V1 but writes to V2. It is safer and more robust to "Copy-on-Write" (or "Copy-on-Access").
          - Return the new V2 container.

2.  **Update `overlayPlaceholder`:**
    - Ensure the overlay logic respects the `_key` mapping so that `toJSON()` produces the correct logical structure from the physical keys.

## Phase 3: Write-Time Logic & Straggler Guard

**Goal:** Ensure writes go to the correct physical key and detect "Zombie" data from old peers.

1.  **Update `Draft` Proxies:**

    - Direct writes to the `_v2_messages` CRDT container.

2.  **Straggler Guard (The "Zombie" Detector):**
    - The `TypedDoc` should monitor the V1 key (`_v1_messages`).
    - If V1 changes _after_ V2 has been created (i.e., a straggler peer is still writing to V1), emit a `MigrationConflict` event.
    - The application can then decide to alert the user ("Legacy data detected - please refresh") or attempt a manual merge.

## Phase 4: Schema Garbage Collection (Lifecycle Management)

**Goal:** Systematize the cleanup of old schema data using Shallow Snapshots.

### The "Schema GC" Lifecycle

We propose a 3-stage lifecycle for schema fields to make this easy for developers:

1.  **Active (V1):** The field is the source of truth.
2.  **Deprecated (V1 -> V2):**
    - V2 is the new source of truth.
    - V1 is kept for migration fallback.
    - _Developer Action:_ Define `migrateFrom` in the schema.
3.  **Garbage Collected (V2 Only):**
    - V1 is deleted from the current state.
    - History is trimmed (Shallow Snapshot).
    - _Developer Action:_ Mark V1 as `Shape.tombstone("v1_key")` (or simply remove the migration definition).

### Developer UX Vision

```typescript
// 1. Define the Schema with Migration
const ChatSchema = Shape.doc({
  messages: Shape.list(Shape.map({ ... }))
    .key("_v2_messages")
    .migrateFrom({ key: "_v1_messages", ... })
})

// 2. The "GC" Utility
// Run this periodically or on app startup
await typedDoc.gc({
  // Strategy: If V2 exists and is older than 30 days, delete V1
  retention: "30d",
  onCleanup: (deletedKeys) => {
    console.log("Cleaned up legacy fields:", deletedKeys);
    // Trigger Shallow Snapshot to purge history
    doc.export({ mode: "shallow-snapshot", since: doc.frontiers() });
  }
})
```

## Phase 5: Testing & Validation

**Goal:** Verify the system against the "Databank" cases.

1.  **Unit Tests:**

    - Test simple key remapping (rename).
    - Test type transformation (string -> object).
    - Test nested migration.
    - **Test "Zombie" State:** Verify V2 takes precedence even if empty.

2.  **Scenario Tests (from Databank):**
    - Implement **Case 4 (Chat)**: Migrate `content: Text` -> `content: Block[]`.
    - Implement **Case 5 (Kanban)**: Migrate `list` -> `movableList`.

## Risks & Mitigations

- **Risk:** Type inference complexity.
  - _Mitigation:_ Keep the `Infer<T>` type simple. It should reflect the _target_ (logical) schema. The migration logic is runtime-only.
- **Risk:** "Ghost Data" (V1 data that reappears).
  - _Mitigation:_ **Strict Existence Check.** Use `doc.getShallowValue()` to check if the key exists in the map. If the key exists (even if value is null/empty), V2 is authoritative.
- **Risk:** Dual Write Conflicts.
  - _Mitigation:_ Loro's CRDT nature handles concurrent creation of containers gracefully. If two peers migrate simultaneously, they will both create the V2 container. The "Last Write Wins" or merge logic will apply. Since the transformation is deterministic, the result should be consistent.

This plan provides a clear path to implementing the "Mapped Schema" feature.

# Additional Notes -- Complex Schema Migration Example

This example demonstrates how the API handles multiple keys and chained migrations (V1 -> V2 -> V3).

## Scenario: Task Management Evolution

We are evolving a "Task" entity through three versions:

1.  **V1 (Legacy):** Simple string task.
    - Key: `task_v1`
    - Type: `string`
2.  **V2 (Structured):** Task becomes an object with a title and a boolean "done" flag.
    - Key: `task_v2`
    - Type: `{ title: string, done: boolean }`
3.  **V3 (Rich):** Task becomes a rich object with a title, status enum, and assignee.
    - Key: `task_v3`
    - Type: `{ title: string, status: 'todo' | 'done' | 'archived', assignee: string }`

## The API Vision

```typescript
import { Shape } from "./shape";

// Define the V1 Shape (for reference in migration)
const TaskV1Shape = Shape.plain.string();

// Define the V2 Shape (for reference in migration)
const TaskV2Shape = Shape.plain.object({
  title: Shape.plain.string(),
  done: Shape.plain.boolean(),
});

// Define the Current (V3) Schema
const TaskSchema = Shape.doc({
  // The logical field is 'task', but it maps to physical storage keys
  task: Shape.plain
    .object({
      title: Shape.plain.string(),
      status: Shape.plain.string("todo", "done", "archived"),
      assignee: Shape.plain.string().placeholder("unassigned"),
    })
    // 1. Define the current physical key
    .key("task_v3")

    // 2. Define migration from V2 -> V3
    .migrateFrom({
      key: "task_v2",
      shape: TaskV2Shape,
      transform: (v2Data) => ({
        title: v2Data.title,
        status: v2Data.done ? "done" : "todo",
        assignee: "unassigned", // New field default
      }),
    })

    // 3. Define migration from V1 -> V2 (Chained fallback)
    // If V3 is missing, AND V2 is missing, look for V1.
    // Note: The system recursively checks migrations.
    // If we find V1, we transform V1 -> V2, then V2 -> V3.
    .migrateFrom({
      key: "task_v1",
      shape: TaskV1Shape,
      transform: (v1Data) => ({
        title: v1Data, // The string becomes the title
        status: "todo",
        assignee: "unassigned",
      }),
    }),
});
```

## How it Works (Runtime Logic)

When `doc.task` is accessed:

1.  **Check V3 (`task_v3`):**

    - Exists? Return it.
    - Missing? Continue.

2.  **Check V2 (`task_v2`):**

    - Exists?
      - Read V2 data.
      - Run V2->V3 transform.
      - **Eager Write:** Save result to `task_v3`.
      - Return result.
    - Missing? Continue.

3.  **Check V1 (`task_v1`):**
    - Exists?
      - Read V1 data.
      - Run V1->V3 transform (direct migration defined above).
      - **Eager Write:** Save result to `task_v3`.
      - Return result.
    - Missing? Return default placeholder for V3.

# Additional Notes -- Overlay Placeholder with Versioned Keys

This example demonstrates how `overlayPlaceholder` (used by `toJSON()`) handles schemas where logical fields map to different physical keys.

## The Problem

`toJSON()` takes the raw CRDT data (which uses physical keys) and overlays it with the schema's structure (which defines logical fields).

If we have:

- Logical Field: `messages`
- Physical Key: `_v2_messages`

The raw CRDT data looks like:

```json
{
  "_v2_messages": ["Hello"]
}
```

But `toJSON()` must return:

```json
{
  "messages": ["Hello"]
}
```

## The Solution

The `overlayPlaceholder` function iterates over the **Schema's Logical Keys**, not the CRDT's keys. It uses the schema definition to look up the correct physical key in the CRDT data.

### Example Scenario

```typescript
const ChatSchema = Shape.doc({
  // Logical field 'messages' maps to physical key '_v2_messages'
  messages: Shape.list(Shape.text())
    .key("_v2_messages")
    .migrateFrom({ key: "_v1_messages", ... })
});
```

### Case 1: V2 Data Exists (Normal Case)

**Raw CRDT Data:**

```json
{
  "_v2_messages": ["Hello from V2"],
  "_v1_messages": ["Old V1 data"] // Ignored because V2 exists
}
```

**Overlay Logic:**

1.  Iterate schema keys. Found `messages`.
2.  Look up physical key for `messages` -> `_v2_messages`.
3.  Get value from CRDT at `_v2_messages`. Found `["Hello from V2"]`.
4.  Result: `messages: ["Hello from V2"]`.

**Resulting JSON:**

```json
{
  "messages": ["Hello from V2"]
}
```

### Case 2: V2 Missing, V1 Exists (Migration Case)

**Raw CRDT Data:**

```json
{
  "_v1_messages": ["Hello from V1"]
  // _v2_messages is missing
}
```

**Overlay Logic:**

1.  Iterate schema keys. Found `messages`.
2.  Look up physical key `_v2_messages`. **Missing.**
3.  Check for migration. Found `migrateFrom: { key: "_v1_messages" }`.
4.  Look up source key `_v1_messages`. Found `["Hello from V1"]`.
5.  Run transform (e.g., identity).
6.  Result: `messages: ["Hello from V1"]`.

**Resulting JSON:**

```json
{
  "messages": ["Hello from V1"]
}
```

### Case 3: Both Missing (Default Case)

**Raw CRDT Data:**

```json
{}
```

**Overlay Logic:**

1.  Iterate schema keys. Found `messages`.
2.  Look up `_v2_messages`. Missing.
3.  Check migration `_v1_messages`. Missing.
4.  Fall back to placeholder default.
5.  Result: `messages: []`.

**Resulting JSON:**

```json
{
  "messages": []
}
```

## Implementation Detail

The `overlayPlaceholder` function needs to be updated to respect the `.key()` property on the Shape.

```typescript
// Pseudocode for updated overlayPlaceholder
for (const [logicalKey, propShape] of Object.entries(shape.shapes)) {
  // 1. Determine the physical key to read from
  const physicalKey = propShape._key ?? logicalKey;

  // 2. Read from CRDT
  let propCrdtValue = crdtValue[physicalKey];

  // 3. Handle Migration Fallback (if propCrdtValue is missing)
  if (propCrdtValue === undefined && propShape._migration) {
    const sourceKey = propShape._migration.sourceKey;
    const sourceValue = crdtValue[sourceKey];
    if (sourceValue !== undefined) {
      propCrdtValue = propShape._migration.transform(sourceValue);
    }
  }

  // 4. Merge with placeholder
  result[logicalKey] = mergeValue(propShape, propCrdtValue, propPlaceholder);
}
```
