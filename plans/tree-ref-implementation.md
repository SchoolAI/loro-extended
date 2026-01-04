# TreeRef Implementation Plan

## Overview

Implement a fully typed `TreeRef` and `TreeNodeRef` system that wraps Loro's `LoroTree` and `LoroTreeNode` with type-safe access to node metadata.

## Goal

Enable schemas like:

```typescript
const StateNodeDataShape = Shape.struct({
  name: Shape.plain.string(),
  facts: Shape.record(Shape.plain.any()),
  rules: Shape.list(Shape.plain.struct({
    name: Shape.plain.string(),
    rego: Shape.plain.string(),
    description: Shape.plain.string().nullable(),
  })),
})

const ResmSchema = Shape.doc({
  states: Shape.tree(StateNodeDataShape),
  currentPath: Shape.list(Shape.plain.string()),
  input: Shape.record(Shape.plain.any()),
})
```

With usage:

```typescript
doc.$.change(draft => {
  const root = draft.states.createNode({ name: "idle", facts: {}, rules: [] })
  const child = root.createNode({ name: "running", facts: {}, rules: [] })
  child.data.name = "active"  // Typed access via .data (matches Loro's model)
  child.data.rules.push({ name: "rule1", rego: "...", description: null })
})
```

## Key Design Decisions

Based on analysis of the codebase and Loro's documentation:

1. **Keep `.data` indirection** - Match Loro's model where `node.data` is a LoroMap. Users can create helpers if they want direct property access.

2. **Use simple Map caching** - Cache by TreeID (stable). Clear entries on delete. No need for WeakRef complexity.

3. **Implement both `toArray()` and `toJSON()`** - Match Loro's dual API (flat vs nested).

4. **Derive node data placeholder** - Use `deriveShapePlaceholder(dataShape)` when creating StructRef for node.data.

5. **Start with types** - Fix `TreeContainerShape` generics first. Everything else depends on this.

6. **Test with actual use case** - Write the state machine test first, then implement to make it pass.

## Implementation Tasks

### Phase 1: Fix Types First (Foundation)

- [x] **1.1 Update TreeContainerShape generics**
  - File: `packages/change/src/shape.ts`
  - Changed to proper generic types with `TreeNodeJSON<DataShape>[]` for Plain type
  - Updated `Shape.tree()` factory to accept `StructContainerShape` and return `TreeContainerShape<T>`

- [x] **1.2 Update Infer/Mutable types**
  - Types work correctly through the existing type system
  - `Infer<TreeContainerShape<T>>` produces `TreeNodeJSON<T>[]`

- [x] **1.3 Define TreeNodeJSON type**
  - File: `packages/change/src/shape.ts`
  - Defined with id, parent, index, fractionalIndex, data, and children properties

### Phase 2: Write Test First (TDD)

- [x] **2.1 Create tree.test.ts with state machine test case**
  - File: `packages/change/src/typed-refs/tree.test.ts` (new file)
  - 18 tests covering:
    - Create root nodes with typed data
    - Create child nodes with typed data
    - Access `node.data.propertyName` with type safety
    - Navigate parent/children relationships
    - Move nodes between parents
    - Serialize tree to JSON (nested structure)
    - Serialize tree to array (flat structure)
    - `absorbPlainValues` propagation
    - Record containers in node.data
    - Node deletion tracking

### Phase 3: TreeNodeRef Implementation

- [x] **3.1 Create TreeNodeRef class**
  - File: `packages/change/src/typed-refs/tree-node.ts` (new file)
  - Wraps `LoroTreeNode`
  - Properties:
    - `id: TreeID` - readonly node identifier
    - `data: StructRef<DataShape>` - typed access to node.data LoroMap
  - Methods:
    - `createNode(initialData?, index?)` - create child node
    - `parent()` - get parent TreeNodeRef
    - `children()` - get child TreeNodeRefs
    - `move(parent?, index?)` - move to new parent (takes LoroTreeNode, not ID)
    - `moveAfter(sibling)` - move after sibling
    - `moveBefore(sibling)` - move before sibling
    - `index()` - get position among siblings
    - `fractionalIndex()` - get fractional index string
    - `toJSON()` - serialize node and data (nested)
    - `absorbPlainValues()` - delegate to data StructRef
    - `isDeleted()` - check if node has been deleted

### Phase 4: TreeRef Implementation

- [x] **4.1 Rewrite TreeRef class**
  - File: `packages/change/src/typed-refs/tree.ts`
  - Node caching: `Map<TreeID, TreeNodeRef>` - simple Map, clear on delete
  - Methods:
    - `createNode(initialData?)` - create root node
    - `roots()` - get ordered root TreeNodeRefs
    - `nodes()` - get all TreeNodeRefs (unordered)
    - `getNodeByID(id)` - get specific node
    - `has(id)` - check node existence
    - `delete(target)` - delete node and subtree, **clear from cache**
    - `enableFractionalIndex(jitter?)` - enable ordering
    - `toJSON()` - serialize entire tree (nested structure)
    - `toArray()` - get flat array representation (flattened from nested)
    - `absorbPlainValues()` - iterate cache, call on each node

- [x] **4.2 Update utils.ts**
  - File: `packages/change/src/typed-refs/utils.ts`
  - Updated `createContainerTypedRef` to properly create `TreeRef`
  - Added `hasAbsorbPlainValues` type guard for TreeRef compatibility

### Phase 5: Integration

- [x] **5.1 Update derive-placeholder**
  - File: `packages/change/src/derive-placeholder.ts`
  - Tree shape already handled: returns `[]` (empty roots array)

- [x] **5.2 Update overlay/merge**
  - File: `packages/change/src/overlay.ts`
  - Added `transformTreeNodes` function to convert Loro's native format
  - Transforms `meta` to `data` and `fractional_index` to `fractionalIndex`
  - Applies placeholder merging to node data

- [x] **5.3 Add integration tests to change.test.ts**
  - File: `packages/change/src/change.test.ts`
  - Tree operations already tested within `change()` blocks
  - Tests with TypedDoc work correctly

### Phase 6: Documentation

- [x] **6.1 Update shape.ts JSDoc**
  - Added JSDoc to `Shape.tree()` with usage example
  - Documented `TreeContainerShape` and `TreeNodeJSON` types

### Additional Fixes

- [x] **Fix isValueShape type guard**
  - File: `packages/change/src/utils/type-guards.ts`
  - Added "any" to the list of valid valueTypes

## File Changes Summary

| File | Action | Description |
|------|--------|-------------|
| `packages/change/src/shape.ts` | Modify | Fix TreeContainerShape generics, add TreeNodeJSON type |
| `packages/change/src/types.ts` | Modify | Update Infer/Mutable for trees |
| `packages/change/src/typed-refs/tree.test.ts` | Create | TDD tests with state machine schema |
| `packages/change/src/typed-refs/tree-node.ts` | Create | TreeNodeRef class |
| `packages/change/src/typed-refs/tree.ts` | Rewrite | Enhanced TreeRef implementation |
| `packages/change/src/typed-refs/utils.ts` | Modify | Update createContainerTypedRef |
| `packages/change/src/derive-placeholder.ts` | Modify | Handle tree placeholder |
| `packages/change/src/overlay.ts` | Modify | Handle tree in mergeValue |
| `packages/change/src/change.test.ts` | Modify | Add tree integration tests |

## API Reference

### TreeRef<DataShape>

```typescript
class TreeRef<DataShape extends StructContainerShape> {
  // Create root node
  createNode(initialData?: Partial<Infer<DataShape>>): TreeNodeRef<DataShape>
  
  // Query
  roots(): TreeNodeRef<DataShape>[]
  nodes(): TreeNodeRef<DataShape>[]
  getNodeByID(id: TreeID): TreeNodeRef<DataShape> | undefined
  has(id: TreeID): boolean
  
  // Mutate
  delete(target: TreeID | TreeNodeRef<DataShape>): void
  
  // Configuration
  enableFractionalIndex(jitter?: number): void
  
  // Serialize (dual API matching Loro)
  toJSON(): TreeNodeJSON<DataShape>[]  // Nested structure
  toArray(): TreeNodeInfo<DataShape>[] // Flat structure
}
```

### TreeNodeRef<DataShape>

```typescript
class TreeNodeRef<DataShape extends StructContainerShape> {
  // Identity
  readonly id: TreeID
  
  // Typed data access (matches Loro's node.data pattern)
  readonly data: StructRef<DataShape["shapes"]>
  
  // Create children
  createNode(initialData?: Partial<Infer<DataShape>>, index?: number): TreeNodeRef<DataShape>
  
  // Navigate
  parent(): TreeNodeRef<DataShape> | undefined
  children(): TreeNodeRef<DataShape>[]
  
  // Move
  move(newParent?: TreeNodeRef<DataShape>, index?: number): void
  moveAfter(sibling: TreeNodeRef<DataShape>): void
  moveBefore(sibling: TreeNodeRef<DataShape>): void
  
  // Position
  index(): number
  fractionalIndex(): string
  
  // Serialize
  toJSON(): TreeNodeJSON<DataShape>
}
```

## Dependencies

- `loro-crdt`: LoroTree, LoroTreeNode, TreeID types
- Existing: StructRef, TypedRef, TypedRefParams, deriveShapePlaceholder

## Risks and Mitigations

1. **LoroTreeNode.data type** - Need to verify it's actually a LoroMap at runtime
   - Mitigation: Add runtime type check in TreeNodeRef constructor

2. **Node caching on delete** - Deleted nodes should be removed from cache
   - Mitigation: Explicitly clear cache entry in `TreeRef.delete()`

3. **Placeholder for node.data** - Fresh nodes have empty LoroMap
   - Mitigation: Use `deriveShapePlaceholder(dataShape)` when creating StructRef

4. **Circular reference in toJSON** - Tree structure could cause issues
   - Mitigation: Use iterative traversal, not recursive with node refs

## Future Enhancements (Not in Scope)

- Event subscriptions with typed node references
- Direct property access proxy (bypassing `.data`)
- Tree diffing utilities
