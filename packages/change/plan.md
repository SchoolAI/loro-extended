# Plan: TypedDoc Live Read-Only Accessor

## Objective
Make `TypedDoc.value` a high-performance, live, type-safe accessor by default, and move the heavy full serialization to `TypedDoc.toJSON()`.

## Problem
- `TypedDoc.value` currently performs a full `O(N)` serialization, which is misleadingly expensive for a property getter.
- We need a way to read specific fields efficiently (lazy access) without stale caching.

## Solution
1.  **Rename** the current `value` getter to `toJSON()`.
2.  **Repurpose** `value` to return a "Live Read-Only Draft".
3.  **Implement** `readonly` mode in `DraftNode` that disables primitive value caching.

## Tasks

### 1. Update `DraftNode` Architecture
- [ ] Modify `DraftNodeParams` to include a `readonly?: boolean` flag.
- [ ] Update `DraftNode` base class to store this flag.

### 2. Implement Live Reading in Nodes
- [ ] **MapDraftNode / RecordDraftNode**: 
    - Update `getOrCreateNode`: If `readonly` is true, **do not cache primitive values**. Always read from `this.container.get(key)`.
    - Update `set/delete`: Throw error if `readonly` is true.
- [ ] **ListDraftNode / MovableListDraftNode**:
    - Update `get`: If `readonly` is true, do not cache primitives.
    - Update `insert/delete`: Throw error if `readonly` is true.

### 3. Update `TypedDoc` API
- [ ] Rename `get value()` -> `toJSON()`.
- [ ] Implement `get value()` to return `new DraftDoc({ ..., readonly: true })`.
- [ ] Ensure `DraftDoc` passes the `readonly` flag down to its children.

### 4. Verification
- [ ] Add test: `doc.value` reflects updates immediately (no staleness).
- [ ] Add test: `doc.value` throws on mutation.
- [ ] Add test: `doc.toJSON()` returns the full plain object.