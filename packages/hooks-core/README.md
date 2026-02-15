# @loro-extended/hooks-core

Framework-agnostic hooks for building real-time collaborative applications with [Loro CRDT](https://github.com/loro-dev/loro) documents. This package provides the core hook implementations that are used by `@loro-extended/react` and `@loro-extended/hono`.

## Overview

This package implements a "Doc-first" pattern for working with Loro documents:

1. **`useDocument`** - Get a typed document from the repo (stable reference)
2. **`useValue`** - Subscribe to document or ref changes
3. **`usePlaceholder`** - Get placeholder values from schema definitions
4. **`useLens`** - Create a Lens and subscribe to worldview snapshots
5. **`useEphemeral`** - Subscribe to ephemeral store changes (presence, cursors, etc.)

## Installation

This package is typically not installed directly. Instead, use one of the framework-specific packages:

- `@loro-extended/react` - For React applications
- `@loro-extended/hono` - For Hono/JSX applications

If you're building a custom framework integration:

```bash
npm install @loro-extended/hooks-core @loro-extended/repo @loro-extended/change
```

## API

### `createHooks(framework)`

Creates framework-specific hooks from a framework hooks object.

```typescript
import { createHooks } from "@loro-extended/hooks-core"
import * as React from "react"

export const {
  RepoContext,
  useRepo,
  useDocument,
  useValue,
  usePlaceholder,
  useLens,
  useEphemeral,
} = createHooks(React)
```

#### Framework Hooks Interface

The framework object must implement these hooks:

```typescript
interface FrameworkHooks {
  useState: <T>(initialState: T | (() => T)) => [T, (newState: T | ((prevState: T) => T)) => void]
  useEffect: (effect: () => undefined | (() => void), deps?: unknown[]) => void
  useCallback: <T extends Function>(callback: T, deps: unknown[]) => T
  useMemo: <T>(factory: () => T, deps: unknown[]) => T
  useRef: <T>(initialValue: T) => { current: T | null }
  useSyncExternalStore: <Snapshot>(
    subscribe: (onStoreChange: () => void) => () => void,
    getSnapshot: () => Snapshot,
  ) => Snapshot
  useContext: <T>(context: any) => T
  createContext: <T>(defaultValue: T) => any
}
```

### Returned Hooks

#### `RepoContext`

A context for providing the Repo instance to child components.

```tsx
<RepoContext.Provider value={repo}>
  {children}
</RepoContext.Provider>
```

#### `useRepo()`

Returns the Repo instance from context.

```typescript
const repo = useRepo()
```

#### `useDocument(docId, docSchema, ephemeralShapes?)`

Returns a typed `Doc` for the given document. The document reference is stable and never changes, preventing unnecessary re-renders.

```typescript
// Without ephemeral stores
const doc = useDocument(docId, docSchema)

// With ephemeral stores (e.g., presence)
const doc = useDocument(docId, docSchema, { presence: PresenceSchema })
```

**Parameters:**
- `docId: DocId` - The document identifier
- `docSchema: DocShape` - The document schema (from `@loro-extended/change`)
- `ephemeralShapes?: EphemeralDeclarations` - Optional ephemeral store declarations

**Returns:** `Doc<D, E>` - A typed document with:
- Direct field access (e.g., `doc.title`, `doc.todos`)
- Mutation methods on refs (e.g., `doc.title.insert()`, `doc.todos.push()`)

For sync operations, use `sync(doc)`:
- `sync(doc).waitForSync()` - Wait for network sync
- `sync(doc).presence` - Access presence store
- `sync(doc).peerId` - Get the local peer ID

#### `useValue(docOrRef, selector?)`

Subscribes to document or ref changes and returns the current value. Re-renders when the value changes.

```typescript
// Full document snapshot
const snapshot = useValue(doc)

// Single ref value
const title = useValue(doc.title)
const todos = useValue(doc.todos)

// With selector (fine-grained updates)
const todoCount = useValue(doc, d => d.todos.length)
```

**Parameters:**
- `docOrRef: Doc<D> | AnyTypedRef` - The document or typed ref to subscribe to
- `selector?: (value: Infer<D>) => R` - Optional selector function (for documents only)

**Returns:** The current value or selected value

#### `usePlaceholder(ref)`

Returns the placeholder value for a typed ref, as defined in the schema.

```typescript
const placeholder = usePlaceholder(doc.title)
// Returns the value from Shape.text().placeholder("Enter title...")
```

**Parameters:**
- `ref: AnyTypedRef` - A typed ref (`TextRef`, `ListRef`, etc.)

**Returns:** The placeholder value from the schema, or `undefined` if not defined

#### `useLens(world, options?, selector?)`

Creates a Lens from a world `TypedDoc` and returns both the lens and a reactive JSON snapshot
of the lens worldview. Uses the same snapshot caching behavior as `useValue` to avoid
unnecessary renders.

```typescript
const doc = useDocument(docId, DocSchema)
const { lens, worldview } = useLens(doc, {
  filter: info => info.message?.userId === myUserId,
})

// Optional selector form
const { lens, worldview: title } = useLens(doc, undefined, d => d.title)
```

**Parameters:**
- `world: TypedDoc<D>` - The world document (source) for the lens
- `options?: LensOptions` - Optional lens configuration (e.g., filter)
- `selector?: (doc: Infer<D>) => R` - Optional selector for fine-grained updates

**Returns:** `{ lens: Lens<D>; worldview: Infer<D> | R }`

#### `useEphemeral(ephemeral)`

Subscribes to any ephemeral store and returns the current state.

```typescript
const { self, peers } = useEphemeral(sync(doc).presence)
// Or for other ephemeral stores:
const { self, peers } = useEphemeral(sync(doc).cursors)
```

**Parameters:**
- `ephemeral: TypedEphemeral<T>` - A typed ephemeral store

**Returns:** `{ self: T | undefined, peers: Map<string, T> }`

### `createTextHooks(framework)`

Creates hooks for collaborative text editing.

```typescript
import { createTextHooks } from "@loro-extended/hooks-core"
import * as React from "react"

export const { useCollaborativeText } = createTextHooks(React)
```

#### `useCollaborativeText(textRef, options?)`

Binds an HTML input or textarea to a Loro text container with bidirectional sync and cursor preservation.

```tsx
function CollaborativeInput({ textRef }: { textRef: TextRef }) {
  const { inputRef, defaultValue, placeholder } = useCollaborativeText(textRef)
  return (
    <input
      ref={inputRef}
      defaultValue={defaultValue}
      placeholder={placeholder}
    />
  )
}
```

**Cursor Behavior:**
- **Local changes**: Cursor position is calculated based on the input type (insert, delete, etc.)
- **Remote changes**: Uses delta-based adjustment to preserve cursor position relative to content. When a remote peer inserts or deletes text before your cursor, your cursor moves appropriately to stay in the same logical position.
- **IME composition**: Properly handles input method editors for CJK and other languages

**Options:**
- `onBeforeChange?: () => boolean | undefined` - Called before applying a local change. Return `false` to prevent the change.
- `onAfterChange?: () => void` - Called after any change (local or remote) is applied.

### `createUndoHooks(framework)`

Creates hooks for undo/redo management.

```typescript
import { createUndoHooks } from "@loro-extended/hooks-core"
import * as React from "react"

export const { useUndoManager } = createUndoHooks(React)
```

#### `useUndoManager(doc, options?)`

Manages undo/redo with Loro's UndoManager. Automatically sets up keyboard shortcuts.

```tsx
function Editor({ doc }: { doc: Doc<DocSchema> }) {
  const { undo, redo, canUndo, canRedo } = useUndoManager(doc)
  return (
    <div>
      <button onClick={undo} disabled={!canUndo}>Undo</button>
      <button onClick={redo} disabled={!canRedo}>Redo</button>
    </div>
  )
}
```

**Options:**
- `mergeInterval?: number` - Time in ms to merge consecutive changes (default: 500)
- `enableKeyboardShortcuts?: boolean` - Enable Ctrl/Cmd+Z and Ctrl/Cmd+Y (default: true)
- `getCursors?: () => Cursor[]` - Callback to capture cursor positions before undo steps
- `setCursors?: (positions: Array<{ offset: number; side: -1 | 0 | 1 }>) => void` - Callback to restore cursor positions after undo/redo
- `namespace?: string` - Namespace for isolated undo stacks (see Namespace-Based Undo below)

**Namespace-Based Undo:**

When building forms or editors with multiple independent text fields, you may want each field to have its own undo stack. Use the `namespace` option to isolate undo operations:

```tsx
function FormEditor({ doc }: { doc: Doc<FormSchema> }) {
  // Each field gets its own undo stack
  const { undo: undoTitle } = useUndoManager(doc, { namespace: "title" })
  const { undo: undoBody } = useUndoManager(doc, { namespace: "body" })
  
  // Undo in title field won't affect body field
}
```

> **Important:** Register all namespaces before making changes. If you register a namespace after other managers exist, a warning will be logged. This is because `excludeOriginPrefixes` is calculated at manager creation time and cannot be updated afterward.

**Cursor Restoration Example:**

```tsx
function EditorWithCursorRestore({ doc, textRef }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const loroText = loro(textRef).container
  
  const { undo, redo, canUndo, canRedo } = useUndoManager(doc, {
    getCursors: () => {
      const input = inputRef.current
      if (!input) return []
      const pos = input.selectionStart ?? 0
      const cursor = loroText.getCursor(pos)
      return cursor ? [cursor] : []
    },
    setCursors: (positions) => {
      const input = inputRef.current
      if (!input || positions.length === 0) return
      const pos = positions[0].offset
      input.setSelectionRange(pos, pos)
    },
  })
  
  // ... rest of component
}
```

## Usage Pattern

```typescript
import { Shape, change } from "@loro-extended/change"
import { sync } from "@loro-extended/repo"
import { useDocument, useValue, useEphemeral } from "@loro-extended/react"

const DocSchema = Shape.doc({
  title: Shape.text().placeholder("Untitled"),
  items: Shape.list(Shape.plain.string()),
})

const PresenceSchema = Shape.plain.struct({
  cursor: Shape.plain.struct({
    x: Shape.plain.number(),
    y: Shape.plain.number(),
  }),
  name: Shape.plain.string().placeholder("Anonymous"),
})

function MyComponent({ docId }) {
  // Get typed document with ephemeral stores
  const doc = useDocument(docId, DocSchema, { presence: PresenceSchema })
  
  // Subscribe to document snapshot
  const snapshot = useValue(doc)
  
  // Subscribe to presence
  const { self, peers } = useEphemeral(sync(doc).presence)
  
  // Mutate document
  const addItem = (text) => {
    change(doc, d => {
      d.items.push(text)
    })
  }
  
  // Update presence
  const updateCursor = (x, y) => {
    sync(doc).presence.setSelf({ cursor: { x, y } })
  }
  
  return (
    <div>
      <h1>{snapshot.title}</h1>
      <ul>
        {snapshot.items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
      <div>
        {Array.from(peers.values()).map(p => (
          <span key={p.name}>{p.name}</span>
        ))}
      </div>
    </div>
  )
}
```

## Benefits of Doc-First Pattern

1. **Stable References** - The document never changes identity, so you can safely pass it to child components or use it in callbacks without causing re-renders.

2. **Separation of Concerns** - Reading (`useValue`) and writing (`change()` or direct mutation) are clearly separated.

3. **Fine-Grained Reactivity** - Subscribe to specific refs or use selectors to only re-render when specific data changes:
   ```typescript
   // Only re-renders when title changes
   const title = useValue(doc.title)
   
   // Only re-renders when todo count changes
   const count = useValue(doc, d => d.todos.length)
   ```

4. **Unified Sync API** - Use `sync(doc)` for all sync-related operations (presence, waitForSync, etc.).

5. **Type Safety** - Full TypeScript support with proper type inference from schemas.

## Related Packages

- [`@loro-extended/react`](../react/README.md) - React bindings
- [`@loro-extended/hono`](../hono/README.md) - Hono/JSX bindings
- [`@loro-extended/change`](../change/README.md) - Schema definitions
- [`@loro-extended/repo`](../repo/README.md) - Document synchronization

## License

MIT