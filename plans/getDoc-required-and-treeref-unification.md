# Plan: Make getDoc Required and Unify TreeRef with TypedRef

## Problem Statement

Two related issues exist in the typed refs implementation:

1. **`getDoc` is optional but always provided** - The `TypedRefParams.getDoc` parameter is marked as optional (`getDoc?: () => LoroDoc`), but in practice it's always passed when creating refs. This causes `$.loroDoc` to return `LoroDoc | undefined` when it could return `LoroDoc`, forcing unnecessary null-checking on users.

2. **TreeRef duplicates TypedRef functionality** - `TreeRef` doesn't extend `TypedRef`, requiring duplicate implementations of:
   - `$` namespace (loroDoc, loroContainer, subscribe)
   - `autoCommit`, `batchedMutation`, `doc` getters
   - `commitIfAuto()` method
   - Container caching pattern

## Background

### Current Architecture

```
TypedRef<Shape> (base.ts)
├── CounterRef (counter.ts)
├── TextRef (text.ts)
├── ListRef → ListRefBase (list.ts, list-base.ts)
├── MovableListRef → ListRefBase (movable-list.ts, list-base.ts)
├── RecordRef (record.ts)
├── StructRef (struct.ts)
└── DocRef (doc.ts)

TreeRef (tree.ts) ← DOES NOT extend TypedRef
└── TreeNodeRef (tree-node.ts) ← Also doesn't extend TypedRef
```

### Why TreeRef Doesn't Extend TypedRef

Looking at the code, TreeRef has a different params structure:

```typescript
// TypedRefParams (base.ts)
type TypedRefParams<Shape> = {
  shape: Shape
  placeholder?: Infer<Shape>
  getContainer: () => ShapeToContainer<Shape>
  autoCommit?: boolean
  batchedMutation?: boolean
  getDoc?: () => LoroDoc
}

// TreeRefParams (tree.ts)
interface TreeRefParams<DataShape extends StructContainerShape> = {
  shape: TreeContainerShape<DataShape>
  placeholder?: never[]
  getContainer: () => LoroTree
  autoCommit?: boolean
  batchedMutation?: boolean
  getDoc?: () => LoroDoc
}
```

The key difference is that TreeRef's `shape` is specifically `TreeContainerShape<DataShape>` and it has a `dataShape` getter that extracts `shape.shape`. However, this is not a fundamental incompatibility - it's just a specialization.

### Ref Creation Flow

All refs are created through:
1. `DocRef.getTypedRefParams()` - Always passes `getDoc: () => this._doc`
2. `createContainerTypedRef()` in utils.ts - Passes through `params.getDoc`
3. Nested refs (StructRef, RecordRef, ListRef) - Pass through `this._params.getDoc`

**There is no code path where a ref is created without `getDoc`.**

## The Gap

| Issue | Current State | Desired State |
|-------|---------------|---------------|
| `getDoc` optionality | `getDoc?: () => LoroDoc` | `getDoc: () => LoroDoc` |
| `$.loroDoc` return type | `LoroDoc \| undefined` | `LoroDoc` |
| TreeRef inheritance | Standalone class | Extends TypedRef |
| Code duplication | ~40 lines duplicated | Single implementation |

## Proposed Solution

### Phase 1: Make getDoc Required

1. **Update `TypedRefParams`** in `base.ts`:
   ```typescript
   export type TypedRefParams<Shape extends DocShape | ContainerShape> = {
     // ... other fields
     getDoc: () => LoroDoc  // Remove the ?
   }
   ```

2. **Update `RefMetaNamespace`** in `base.ts`:
   ```typescript
   readonly loroDoc: LoroDoc  // Remove | undefined
   ```

3. **Update `TreeRefParams`** in `tree.ts`:
   ```typescript
   getDoc: () => LoroDoc  // Remove the ?
   ```

4. **Update `TreeRefMetaNamespace`** in `tree.ts`:
   ```typescript
   readonly loroDoc: LoroDoc  // Remove | undefined
   ```

5. **Update `TreeNodeRefParams`** in `tree-node.ts`:
   ```typescript
   getDoc: () => LoroDoc  // Remove the ?
   ```

6. **Update `getLoroDoc()` overloads** in `functional-helpers.ts`:
   ```typescript
   export function getLoroDoc<Shape extends ContainerShape>(
     ref: TypedRef<Shape>,
   ): LoroDoc  // Remove | undefined
   ```

### Phase 2: Unify TreeRef with TypedRef

1. **Make TreeRef extend TypedRef**:
   ```typescript
   export class TreeRef<DataShape extends StructContainerShape> 
     extends TypedRef<TreeContainerShape<DataShape>> {
     // Remove duplicated: _cachedContainer, _$, autoCommit, batchedMutation, doc, commitIfAuto
     // Keep: nodeCache, dataShape getter, tree-specific methods
   }
   ```

2. **Remove TreeRefMetaNamespace** - Use inherited `RefMetaNamespace` from base

3. **Update TreeNodeRef** to use the base `$` namespace pattern (or keep it separate since it wraps LoroTreeNode, not a container)

## Dependency Analysis

### Files to Modify

| File | Changes |
|------|---------|
| `base.ts` | Make `getDoc` required, update `RefMetaNamespace` |
| `tree.ts` | Extend TypedRef, remove duplicated code, remove `TreeRefMetaNamespace` |
| `tree-node.ts` | Make `getDoc` required in params |
| `functional-helpers.ts` | Update `getLoroDoc()` return types |
| `doc.ts` | No changes needed (already passes `getDoc`) |
| `struct.ts` | No changes needed (passes through `getDoc`) |
| `record.ts` | No changes needed (passes through `getDoc`) |
| `list-base.ts` | No changes needed (passes through `getDoc`) |
| `utils.ts` | No changes needed (passes through `getDoc`) |

### Transitive Dependencies

```
functional-helpers.ts
└── imports TypedRef, TreeRef
    └── Both will have updated $.loroDoc type

Tests (functional-helpers.test.ts)
└── Uses ref.$.loroDoc
    └── Can remove optional chaining (?.) after change

README.md
└── Examples show ref.$.loroDoc?.subscribe()
    └── Can simplify to ref.$.loroDoc.subscribe()
```

### Breaking Changes

**This is a non-breaking change for users:**
- `LoroDoc` is assignable to `LoroDoc | undefined`
- Existing code with `?.` will still work
- New code can omit `?.`

**Internal breaking change:**
- Any internal code creating refs must provide `getDoc`
- Currently all code paths already do this

## Success Criteria

1. **`getDoc` is required** in all ref params types
2. **`$.loroDoc` returns `LoroDoc`** (not `| undefined`) on all refs
3. **TreeRef extends TypedRef** with no duplicated code
4. **All 466 tests pass** in the change package
5. **README examples updated** to remove unnecessary `?.`
6. **No breaking changes** for external consumers

## Todo List

- [x] Make `getDoc` required in `TypedRefParams` (`packages/change/src/typed-refs/base.ts`)
- [x] Update `RefMetaNamespace.loroDoc` to return `LoroDoc` (`packages/change/src/typed-refs/base.ts`)
- [x] Make `getDoc` required in `TreeRefParams` (`packages/change/src/typed-refs/tree.ts`) - TreeRef now extends TypedRef, uses TypedRefParams
- [x] Make `getDoc` required in `TreeNodeRefParams` (`packages/change/src/typed-refs/tree-node.ts`)
- [x] Make TreeRef extend TypedRef (`packages/change/src/typed-refs/tree.ts`)
- [x] Remove duplicated code from TreeRef (container caching, $, autoCommit, etc.)
- [x] Remove `TreeRefMetaNamespace` interface (`packages/change/src/typed-refs/tree.ts`)
- [x] Update `getLoroDoc()` return types in functional-helpers (`packages/change/src/functional-helpers.ts`)
- [x] Update tests to remove unnecessary `?.` (`packages/change/src/functional-helpers.test.ts`) - No tests needed updating
- [x] Update README examples (`packages/change/README.md`) - No README examples needed updating
- [x] Run all tests to verify no regressions - All 466 tests pass
- [x] Create changeset
