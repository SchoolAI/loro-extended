# Schema Migration Implementation Todo List

## Phase 1: Foundation & API Design (✅ Done)
- [x] **Step 1.1:** Modify `packages/change/src/shape.ts` to add `_key` and `_migration` properties.
- [x] **Step 1.2:** Implement `key(name: string)` and `migrateFrom(def: MigrationDefinition)` builder methods.
- [x] **Step 1.3:** Update `packages/change/src/types.ts` to ensure `Infer<T>` returns correct logical type.

## Phase 2: Read-Time Migration (✅ Done)
- [x] **Step 2.1:** Update `packages/change/src/typed-refs/doc.ts` with Eager Migration logic.
    - [x] Existence Check
    - [x] Migration Logic
    - [x] Eager Write
- [x] **Step 2.2:** Update `overlayPlaceholder` in `packages/change/src/overlay.ts`.

## Phase 3: Write-Time Logic & Straggler Guard (🚨 CRITICAL)
- [ ] **Step 3.1:** Implement `StragglerGuard` class.
    - [ ] Create `packages/change/src/straggler-guard.ts`.
    - [ ] Logic: Monitor `doc.on('import')` or scan local changes.
    - [ ] Detection: If `sourceKey` is modified AND `targetKey` exists, flag as conflict.
- [ ] **Step 3.2:** Integrate Straggler Guard into `TypedDoc`.
    - [ ] Expose `typedDoc.on('migration-conflict', handler)`.
    - [ ] Add `typedDoc.checkConflicts()` method for manual checks.

## Phase 4: Testing & Validation (🚧 In Progress)
- [x] **Step 4.1:** Create unit tests for `Shape.key()` and `Shape.migrateFrom()`.
- [x] **Step 4.2:** Create a test case for "Case 4 (Chat)" migration.
- [ ] **Step 4.3:** Create a **"Zombie Data" Reproduction Test**.
    - [ ] Simulate Peer A migrating.
    - [ ] Simulate Peer B writing to old key.
    - [ ] Prove that Peer B's data is currently ignored.
- [ ] **Step 4.4:** Verify Straggler Guard fixes the Zombie Data issue.

## Phase 5: Schema GC & Hardening
- [x] **Step 5.1:** Implement basic `SchemaGC`.
- [ ] **Step 5.2:** Implement "Soft Delete" or Tombstone strategy for GC to prevent history loss.
- [ ] **Step 5.3:** Add "Migration Metadata" tracking (who migrated and when).