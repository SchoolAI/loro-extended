# Recommended hooks-core API

## Problems with Current API

### 1. Unnecessary Null States → Flickering
```typescript
// Current: useState(null) + useEffect causes two renders
const [handle, setHandle] = useState<UntypedDocHandle | null>(null)
useEffect(() => {
  setHandle(repo.getUntyped(documentId))  // Synchronous!
}, [])
```
**Solution:** Initialize synchronously with `useState(() => repo.get(...))`

### 2. Wrong Return Type → Lost Type Safety
```typescript
// Current: Pass schema, get untyped handle back
const [doc, changeDoc, handle] = useDocument(docId, schema)
// handle is UntypedDocHandle | null 😢
```
**Solution:** Return `TypedDocHandle<D, P>` that matches the schema

### 3. Redundant Wrappers → Unnecessary Code
```typescript
// Current: Hooks create changeDoc and setSelf wrappers
const changeDoc = useTypedDocChanger(handle, schema)
```
**Solution:** `TypedDocHandle` already has `handle.change()` and `handle.presence.set()`

### 4. Separate Document + Presence → Two Hooks for One Thing
```typescript
// Current: Need two hooks
const [doc, changeDoc, handle] = useDocument(docId, schema)
const { self, setSelf } = usePresence(docId, presenceSchema)
```
**Solution:** Single handle provides both via `handle.presence`

### 5. Selector Repetition → Verbose for Multiple Values
```typescript
// Hypothetical bad API: Repeat docId/schema for each selector
const title = useDocValue(docId, schema, d => d.title)
const count = useDocValue(docId, schema, d => d.count)
```
**Solution:** Get handle once, then select from it

### 6. Too Many Exports → Confusing API Surface
```typescript
// Current: 12 exports, unclear which to use
useDocHandleState, useDocChanger, useTypedDocState, useTypedDocChanger,
useRawLoroDoc, useUntypedDocChanger, useUntypedPresence, ...
```
**Solution:** 5 focused exports with clear purposes

### 7. Presence Selectors → Don't Make Sense
```typescript
// Presence is shallow and has dynamic keys - peer IDs
// Cannot use hooks in loops for iterating peers
const peer = usePresence(handle, p => p.peers.get('peer-123'))  // Anti-pattern
```
**Solution:** Return full presence object, no selectors needed

---

## Recommended API

### Exports

```typescript
export {
  RepoContext,      // React context for Repo
  useRepo,          // Access Repo from context
  useHandle,        // Get typed handle - stable, never re-renders
  useDoc,           // Select document values - reactive
  usePresence,      // Get presence state - reactive
}
```

### Type Signatures

```typescript
// Get handle without presence
function useHandle<D extends DocShape>(
  docId: DocId,
  schema: D
): TypedDocHandle<D>

// Get handle with presence
function useHandle<D extends DocShape, P extends ValueShape>(
  docId: DocId,
  schema: D,
  presenceSchema: P
): TypedDocHandle<D, P>

// Select document value - fine-grained re-renders
function useDoc<D extends DocShape, R>(
  handle: TypedDocHandle<D>,
  selector: (doc: DeepReadonly<Infer<D>>) => R
): R

// Get full document - coarse re-renders
function useDoc<D extends DocShape>(
  handle: TypedDocHandle<D>
): DeepReadonly<Infer<D>>

// Get presence - only works with handles that have presence schema
function usePresence<D extends DocShape, P extends ValueShape>(
  handle: TypedDocHandle<D, P>
): { self: Infer<P>; peers: Map<string, Infer<P>> }
```

### Usage Examples

```typescript
// ============================================
// Basic Document
// ============================================

function Editor({ docId }) {
  const handle = useHandle(docId, DocSchema)
  
  // Fine-grained selectors - only re-render when value changes
  const title = useDoc(handle, d => d.title)
  const count = useDoc(handle, d => d.count)
  
  // Or get full doc - re-renders on any change
  const doc = useDoc(handle)
  
  return (
    <div>
      <h1>{title}</h1>
      <button onClick={() => handle.change(d => { d.count++ })}>
        Count: {count}
      </button>
    </div>
  )
}

// ============================================
// Document + Presence
// ============================================

function CollaborativeEditor({ docId }) {
  const handle = useHandle(docId, DocSchema, PresenceSchema)
  
  const content = useDoc(handle, d => d.content)
  const { self, peers } = usePresence(handle)
  
  return (
    <div>
      <textarea 
        value={content}
        onChange={e => handle.change(d => { d.content = e.target.value })}
        onMouseMove={e => handle.presence.set({ cursor: { x: e.clientX, y: e.clientY } })}
      />
      <CursorOverlay self={self.cursor} peers={[...peers.values()]} />
    </div>
  )
}

// ============================================
// Advanced: Handle Methods
// ============================================

async function loadDocument(docId) {
  const handle = useHandle(docId, DocSchema)
  
  // Wait for network sync
  await handle.waitForNetwork()
  
  // Check ready states
  console.log(handle.readyStates)
  
  // Access raw LoroDoc if needed
  handle.untyped.doc.subscribe(...)
}
```

---

## Rationale

| Decision | Rationale |
|----------|-----------|
| **Handle-first pattern** | Specify docId/schema once, then select multiple values without repetition |
| **Stable handle** | `useHandle` never causes re-renders; use for writes and advanced operations |
| **Reactive selectors** | `useDoc(handle, selector)` enables fine-grained re-renders |
| **No presence selectors** | Presence is shallow with dynamic keys; selectors don't add value |
| **TypeScript enforcement** | `usePresence` only accepts handles created with presence schema |
| **5 exports** | Clear, focused API vs. 12 confusing exports |
| **Synchronous init** | No null states, no flickering |

---

## Migration Guide

```typescript
// ============================================
// BEFORE - Current API
// ============================================

const [doc, changeDoc, handle] = useDocument(docId, schema)
doc.title
changeDoc(d => { d.title = "New" })

const { self, setSelf } = usePresence(docId, presenceSchema)
self.cursor
setSelf({ cursor: { x: 10, y: 20 } })

// ============================================
// AFTER - New API
// ============================================

const handle = useHandle(docId, schema, presenceSchema)

const title = useDoc(handle, d => d.title)
handle.change(d => { d.title = "New" })

const { self } = usePresence(handle)
self.cursor
handle.presence.set({ cursor: { x: 10, y: 20 } })
```

---

## Summary

| Aspect | Before | After |
|--------|--------|-------|
| Exports | 12 | 5 |
| Handle type | `UntypedDocHandle \| null` | `TypedDocHandle<D, P>` |
| Initial state | `null` - flickers | Synchronous - no flicker |
| Document + Presence | 2 hooks | 1 handle |
| Selector repetition | N/A | None - handle-first |
| Write methods | Wrapper functions | Built-in on handle |
| Type safety | Partial | Full |
