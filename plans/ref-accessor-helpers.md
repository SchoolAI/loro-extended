# Plan: Ref Accessor Helpers (getLoroDoc, getLoroContainer, $ namespace)

## Todo List

- [x] Add `$` namespace to `TypedRef` base class with `loroDoc`, `loroContainer`, `subscribe()` (`packages/change/src/typed-refs/base.ts`)
- [x] Add `$` namespace to `TreeRef` (doesn't extend TypedRef) (`packages/change/src/typed-refs/tree.ts`)
- [x] Extend `getLoroDoc()` to accept refs (`packages/change/src/functional-helpers.ts`)
- [x] Add new `getLoroContainer()` helper (`packages/change/src/functional-helpers.ts`)
- [x] Export `getLoroContainer` from index (`packages/change/src/index.ts`)
- [x] Add tests for `ref.$.loroDoc` on all ref types (`packages/change/src/functional-helpers.test.ts`)
- [x] Add tests for `ref.$.loroContainer` on all ref types (`packages/change/src/functional-helpers.test.ts`)
- [x] Add tests for `ref.$.subscribe()` on all ref types (`packages/change/src/functional-helpers.test.ts`)
- [x] Add tests for `getLoroDoc()` on all ref types (`packages/change/src/functional-helpers.test.ts`)
- [x] Add tests for `getLoroContainer()` on all ref types (`packages/change/src/functional-helpers.test.ts`)
- [x] Update README with new helper documentation (`packages/change/README.md`)
- [x] Create changeset for the new feature

## Problem Statement

Developers using `@loro-extended/change` cannot easily access the underlying LoroDoc or Loro container from a typed ref (e.g., `TextRef`, `CounterRef`, `ListRef`). This limits the ability to:

1. Pass refs around as standalone handles and still access the document for subscriptions
2. Access the raw Loro container for advanced operations not exposed by the typed API
3. Use refs in contexts where the original TypedDoc is not available

## Background

The library currently provides:

- **`getLoroDoc(doc)`** - A functional helper that extracts the LoroDoc from a TypedDoc
- **`doc.$.loroDoc`** - Direct access on TypedDoc via the `$` namespace

However, individual refs (`TextRef`, `CounterRef`, `ListRef`, `RecordRef`, `StructRef`, `MovableListRef`, `TreeRef`) have:

- **`protected get doc()`** - Access to LoroDoc exists but is not public
- **`protected get container()`** - Access to the Loro container exists but is not public

The infrastructure is already in place internally; it just needs to be exposed.

## The Gap

| Current API | Works On | Gap |
|-------------|----------|-----|
| `getLoroDoc(doc)` | TypedDoc only | ❌ Doesn't work on refs |
| `doc.$.loroDoc` | TypedDoc only | ❌ Refs don't have `$` namespace |
| `ref.container` | N/A (protected) | ❌ No public access to container |
| Container subscriptions | N/A | ❌ No way to subscribe to a specific ref |

## Proposed Solution

### 1. Add `$` namespace to refs (Primary API)

Just as `doc.$` provides meta-operations on TypedDoc, refs will have a `$` namespace:

```typescript
// Access the underlying LoroDoc
textRef.$.loroDoc         // LoroDoc | undefined

// Access the underlying Loro container (correctly typed)
textRef.$.loroContainer   // LoroText
countRef.$.loroContainer  // LoroCounter
listRef.$.loroContainer   // LoroList

// Subscribe to container-level changes
textRef.$.subscribe((event) => console.log("Text changed"))
```

### 2. Extend `getLoroDoc()` to accept refs (Functional API)

```typescript
// Current signature
function getLoroDoc<Shape extends DocShape>(doc: TypedDoc<Shape>): LoroDoc

// New signature (overloaded)
function getLoroDoc<Shape extends DocShape>(doc: TypedDoc<Shape>): LoroDoc
function getLoroDoc(ref: TypedRef<any>): LoroDoc | undefined
```

The ref version returns `LoroDoc | undefined` because refs created outside of a doc context (edge case) may not have a doc reference.

### 3. Add new `getLoroContainer()` helper (Functional API)

```typescript
function getLoroContainer<T extends ContainerShape>(ref: TypedRef<T>): ShapeToContainer<T>
```

This returns the appropriately typed Loro container:
- `TextRef` → `LoroText`
- `CounterRef` → `LoroCounter`
- `ListRef` → `LoroList`
- `RecordRef` → `LoroMap`
- `StructRef` → `LoroMap`
- `MovableListRef` → `LoroMovableList`
- `TreeRef` → `LoroTree`

## Implementation Details

### Files to Modify

1. **`packages/change/src/typed-refs/base.ts`**
   - Add `$` namespace object with:
     - `loroDoc` getter → returns `this._params.getDoc?.()`
     - `loroContainer` getter → returns `this.container` (the protected getter)
     - `subscribe(callback)` method → delegates to `this.container.subscribe(callback)`
   - Keep existing protected properties for internal use

2. **`packages/change/src/typed-refs/tree.ts`**
   - Add `$` namespace (TreeRef doesn't extend TypedRef)
   - Same interface: `loroDoc`, `loroContainer`, `subscribe()`

3. **`packages/change/src/functional-helpers.ts`**
   - Extend `getLoroDoc()` with overload for refs (uses `ref.$.loroDoc`)
   - Add new `getLoroContainer()` function (uses `ref.$.loroContainer`)

4. **`packages/change/src/index.ts`**
   - Export `getLoroContainer`
   - No change needed for `getLoroDoc` (already exported)

5. **`packages/change/src/functional-helpers.test.ts`**
   - Add tests for `ref.$.loroDoc` on all ref types
   - Add tests for `ref.$.loroContainer` on all ref types
   - Add tests for `ref.$.subscribe()` on all ref types
   - Add tests for `getLoroDoc()` on refs
   - Add tests for `getLoroContainer()`

### Dependency Analysis

```
TypedRef (base.ts)
  ├── CounterRef (counter.ts) - extends TypedRef
  ├── TextRef (text.ts) - extends TypedRef
  ├── ListRef (list.ts) - extends ListRefBase → TypedRef
  ├── MovableListRef (movable-list.ts) - extends ListRefBase → TypedRef
  ├── RecordRef (record.ts) - extends TypedRef
  ├── StructRef (struct.ts) - extends TypedRef
  ├── TreeRef (tree.ts) - has own params, doesn't extend TypedRef directly
  └── DocRef (doc.ts) - extends TypedRef (but throws on getContainer)

functional-helpers.ts
  └── imports TypedDoc, uses doc.$.loroDoc

index.ts
  └── exports from functional-helpers.ts
```

**Key Observations:**

1. **TreeRef is special** - It doesn't extend `TypedRef` directly; it has its own `_params` structure with `getDoc`. Need to handle this case.

2. **DocRef throws on container access** - `DocRef.getContainer()` throws because docs don't have a single container. The `getLoroContainer()` helper should either:
   - Not accept DocRef (type-level exclusion)
   - Throw a clear error at runtime

3. **ListRefBase** - Both `ListRef` and `MovableListRef` extend this, which extends `TypedRef`. The base class approach works here.

### Type Safety Considerations

The `getLoroContainer()` function needs proper typing to return the correct container type:

```typescript
import type { ShapeToContainer, ContainerShape } from "./shape.js"

// Type-safe overloads
function getLoroContainer(ref: TextRef): LoroText
function getLoroContainer(ref: CounterRef): LoroCounter
function getLoroContainer(ref: ListRef<any>): LoroList
function getLoroContainer(ref: MovableListRef<any>): LoroMovableList
function getLoroContainer(ref: RecordRef<any>): LoroMap
function getLoroContainer(ref: StructRef<any>): LoroMap
function getLoroContainer(ref: TreeRef<any>): LoroTree
// Generic fallback
function getLoroContainer<T extends ContainerShape>(ref: TypedRef<T>): ShapeToContainer<T>
```

## Success Criteria

1. **`ref.$.loroDoc`** returns the LoroDoc from any typed ref
2. **`ref.$.loroContainer`** returns the correctly-typed Loro container
3. **`ref.$.subscribe()`** subscribes to container-level changes
4. **`getLoroDoc(ref)`** returns the LoroDoc from any typed ref (functional API)
5. **`getLoroContainer(ref)`** returns the correctly-typed Loro container (functional API)
6. **Type safety** - TypeScript correctly infers return types
7. **No breaking changes** - Existing code continues to work
8. **Tests pass** - New tests cover all ref types
9. **Documentation** - JSDoc comments and README explain usage

## Example Usage After Implementation

```typescript
import { createTypedDoc, getLoroDoc, getLoroContainer, Shape } from "@loro-extended/change"

const schema = Shape.doc({
  title: Shape.text(),
  count: Shape.counter(),
  items: Shape.list(Shape.plain.string()),
})

const doc = createTypedDoc(schema)
const titleRef = doc.title
const countRef = doc.count
const itemsRef = doc.items

// ═══════════════════════════════════════════════════════════════
// Primary API: $ namespace on refs
// ═══════════════════════════════════════════════════════════════

// Access LoroDoc from ref
titleRef.$.loroDoc?.subscribe((event) => console.log("Doc changed"))

// Access typed container from ref
titleRef.$.loroContainer  // LoroText
countRef.$.loroContainer  // LoroCounter
itemsRef.$.loroContainer  // LoroList

// Subscribe to container-level changes (most common use case)
const unsubscribe = titleRef.$.subscribe((event) => {
  console.log("Text changed:", event)
})

// ═══════════════════════════════════════════════════════════════
// Functional API: getLoroDoc() and getLoroContainer()
// ═══════════════════════════════════════════════════════════════

// Get LoroDoc from ref (functional style)
const loroDoc = getLoroDoc(titleRef)
loroDoc?.subscribe((event) => console.log("Doc changed"))

// Get typed container from ref (functional style)
const loroText = getLoroContainer(titleRef)  // LoroText
const loroCounter = getLoroContainer(countRef)  // LoroCounter
const loroList = getLoroContainer(itemsRef)  // LoroList

// ═══════════════════════════════════════════════════════════════
// "Pass around a ref" pattern
// ═══════════════════════════════════════════════════════════════

function TextEditor({ textRef }: { textRef: TextRef }) {
  // Subscribe to changes on just this text
  useEffect(() => {
    return textRef.$.subscribe((event) => {
      // Handle text changes
    })
  }, [textRef])
  
  // Access the container for advanced operations
  const loroText = textRef.$.loroContainer
  
  return <div>...</div>
}
```

## Documentation Updates

### Files to Update

6. **`packages/change/README.md`**
   - Add new section for "Ref Meta-Operations ($ namespace)"
   - Update `getLoroDoc()` documentation to mention it works on refs too
   - Add `getLoroContainer()` documentation
   - Add examples showing the "pass around a ref" pattern

### README Changes

Add a new section **Ref Meta-Operations ($ namespace)** after the existing API sections:

```markdown
### Ref Meta-Operations ($ namespace)

Just as `doc.$` provides meta-operations on TypedDoc, all typed refs have a `$` namespace
for accessing the underlying Loro primitives:

#### `ref.$.loroDoc`

Access the underlying LoroDoc from any ref.

\`\`\`typescript
const titleRef = doc.title;
const loroDoc = titleRef.$.loroDoc;

loroDoc?.subscribe((event) => console.log("Doc changed:", event));
\`\`\`

#### `ref.$.loroContainer`

Access the underlying Loro container. Returns the correctly-typed container.

\`\`\`typescript
const titleRef = doc.title;
titleRef.$.loroContainer  // LoroText

const countRef = doc.count;
countRef.$.loroContainer  // LoroCounter

const itemsRef = doc.items;
itemsRef.$.loroContainer  // LoroList
\`\`\`

#### `ref.$.subscribe(callback)`

Subscribe to changes on this specific container.

\`\`\`typescript
const titleRef = doc.title;

const unsubscribe = titleRef.$.subscribe((event) => {
  console.log("Text changed:", event);
});

// Later: unsubscribe()
\`\`\`

This enables the "pass around a ref" pattern where components can receive
a ref and subscribe to its changes without needing the full document:

\`\`\`typescript
function TextEditor({ textRef }: { textRef: TextRef }) {
  useEffect(() => {
    return textRef.$.subscribe((event) => {
      // Handle text changes
    });
  }, [textRef]);
  
  return <div>...</div>;
}
\`\`\`
```

Also update the **Functional Helpers** section:

```markdown
#### `getLoroDoc(doc)` / `getLoroDoc(ref)`

Access the underlying LoroDoc from a TypedDoc or any typed ref.

\`\`\`typescript
import { getLoroDoc } from "@loro-extended/change";

// From TypedDoc
const loroDoc = getLoroDoc(doc);

// From any ref (TextRef, CounterRef, ListRef, etc.)
const titleRef = doc.title;
const loroDoc = getLoroDoc(titleRef);

loroDoc?.subscribe((event) => console.log("Changed:", event));
\`\`\`

#### `getLoroContainer(ref)`

Access the underlying Loro container from a typed ref. Returns the correctly-typed container.

\`\`\`typescript
import { getLoroContainer } from "@loro-extended/change";

const titleRef = doc.title;
const loroText = getLoroContainer(titleRef);  // LoroText

const countRef = doc.count;
const loroCounter = getLoroContainer(countRef);  // LoroCounter

const itemsRef = doc.items;
const loroList = getLoroContainer(itemsRef);  // LoroList

// Subscribe to container-level changes
loroText.subscribe((event) => console.log("Text changed:", event));
\`\`\`
```

## Open Questions

1. **Should `ref.$.loroDoc` return `LoroDoc | undefined` or throw if doc is unavailable?**
   - Recommendation: Return `undefined` for consistency with optional access patterns

2. **Should TreeRef be handled specially or unified with TypedRef?**
   - For this PR: Add `$` namespace to TreeRef separately (it doesn't extend TypedRef)
   - Future: Consider unifying TreeRef to extend TypedRef

3. **What should `ref.$.subscribe()` return type be?**
   - Recommendation: Return `() => void` (unsubscribe function), matching Loro's API
