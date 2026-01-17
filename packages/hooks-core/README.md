# @loro-extended/hooks-core

Framework-agnostic hooks for building real-time collaborative applications with [Loro CRDT](https://github.com/loro-dev/loro) documents. This package provides the core hook implementations that are used by `@loro-extended/react` and `@loro-extended/hono`.

## Overview

This package implements a "handle-first" pattern for working with Loro documents:

1. **`useHandle`** - Get a stable, typed document handle (never re-renders)
2. **`useDoc`** - Subscribe to document changes with optional selectors
3. **`useRefValue`** - Subscribe to a single typed ref (fine-grained reactivity)
4. **`useEphemeral`** - Subscribe to ephemeral store changes (presence, cursors, etc.)

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
  useHandle,
  useDoc,
  useEphemeral,
  usePresence, // deprecated
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

#### `useHandle(docId, docSchema, ephemeralShapes?)`

Returns a stable `Handle` for the given document. The handle is created synchronously and never changes, preventing unnecessary re-renders.

```typescript
// Without ephemeral stores
const handle = useHandle(docId, docSchema)

// With ephemeral stores (e.g., presence)
const handle = useHandle(docId, docSchema, { presence: PresenceSchema })
```

**Parameters:**
- `docId: DocId` - The document identifier
- `docSchema: DocShape` - The document schema (from `@loro-extended/change`)
- `ephemeralShapes?: EphemeralDeclarations` - Optional ephemeral store declarations

**Returns:** `Handle<D, E>` - A typed handle with:
- `handle.doc` - The typed document (TypedDoc)
- `handle.change(fn)` - Mutate the document
- `handle.loroDoc` - Raw LoroDoc for untyped access
- `handle.docId` - The document ID
- `handle.readyStates` - Sync status information

#### `useDoc(handle, selector?)`

Subscribes to document changes and returns the current value. Re-renders when the document changes.

```typescript
// Full document
const doc = useDoc(handle)

// With selector (fine-grained updates)
const title = useDoc(handle, d => d.title)
const todoCount = useDoc(handle, d => d.todos.length)
```

**Parameters:**
- `handle: TypedDocHandle<D>` - The document handle from `useHandle`
- `selector?: (doc: DeepReadonly<Infer<D>>) => R` - Optional selector function

**Returns:** The document value or selected value

#### `useRefValue(ref)`

Subscribes to a single typed ref and returns its current value. Provides fine-grained reactivity - only re-renders when this specific container changes.

```typescript
// For TextRef - returns value and placeholder
const { value, placeholder } = useRefValue(handle.doc.title)

// For CounterRef - returns value
const { value } = useRefValue(handle.doc.count)

// For ListRef - returns value array
const { value } = useRefValue(handle.doc.items)
```

**Parameters:**
- `ref: AnyTypedRef` - A typed ref (`TextRef`, `ListRef`, `CounterRef`, `RecordRef`, `StructRef`, `MovableListRef`, or `TreeRef`)

**Returns:** An object with:
- `value` - The current value (type depends on ref type)
- `placeholder` - (TextRef only) The placeholder from `Shape.text().placeholder()`

**Use Cases:**
- Building controlled inputs without prop drilling
- Fine-grained subscriptions to specific containers
- Accessing Shape placeholders automatically

```tsx
// Example: Controlled input without prop drilling
function TitleInput({ textRef }: { textRef: TextRef }) {
  const { value, placeholder } = useRefValue(textRef)
  
  return (
    <input
      value={value}
      placeholder={placeholder}
      onChange={(e) => textRef.update(e.target.value)}
    />
  )
}
```

#### `usePresence(handle)` (Deprecated)

> **Deprecated:** Use `useEphemeral(handle.presence)` instead.

Subscribes to presence changes and returns the current presence state.

```typescript
const { self, peers } = usePresence(handle)

// self: P | undefined - Your own presence state
// peers: Map<string, P> - Other peers' presence states
```

**Parameters:**
- `handle` - A handle with a `presence` ephemeral store

**Returns:** `{ self: P | undefined, peers: Map<string, P> }`

#### `useEphemeral(ephemeral)`

Subscribes to any ephemeral store and returns the current state.

```typescript
const { self, peers } = useEphemeral(handle.presence)
// Or for other ephemeral stores:
const { self, peers } = useEphemeral(handle.cursors)
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

#### `useUndoManager(handle, options?)`

Manages undo/redo with Loro's UndoManager. Automatically sets up keyboard shortcuts.

```tsx
function Editor({ handle }: { handle: Handle<DocSchema> }) {
  const { undo, redo, canUndo, canRedo } = useUndoManager(handle)
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

**Cursor Restoration Example:**

```tsx
function EditorWithCursorRestore({ handle, textRef }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const loroText = loro(textRef).container
  
  const { undo, redo, canUndo, canRedo } = useUndoManager(handle, {
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
import { Shape } from "@loro-extended/change"
import { useHandle, useDoc, useEphemeral } from "@loro-extended/react"

const DocSchema = Shape.doc({
  title: Shape.text().placeholder("Untitled"),
  items: Shape.list(Shape.plain.string()),
})

const PresenceSchema = Shape.plain.object({
  cursor: Shape.plain.object({
    x: Shape.plain.number(),
    y: Shape.plain.number(),
  }),
  name: Shape.plain.string().placeholder("Anonymous"),
})

function MyComponent({ docId }) {
  // Get stable handle with ephemeral stores
  const handle = useHandle(docId, DocSchema, { presence: PresenceSchema })
  
  // Subscribe to document
  const doc = useDoc(handle)
  
  // Subscribe to presence
  const { self, peers } = useEphemeral(handle.presence)
  
  // Mutate document
  const addItem = (text) => {
    handle.change(d => {
      d.items.push(text)
    })
  }
  
  // Update presence
  const updateCursor = (x, y) => {
    handle.presence.setSelf({ cursor: { x, y } })
  }
  
  return (
    <div>
      <h1>{doc.title}</h1>
      <ul>
        {doc.items.map((item, i) => (
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

## Benefits of Handle-First Pattern

1. **Stable References** - The handle never changes, so you can safely pass it to child components or use it in callbacks without causing re-renders.

2. **Separation of Concerns** - Reading (`useDoc`) and writing (`handle.change`) are clearly separated.

3. **Fine-Grained Reactivity** - Use selectors to only re-render when specific data changes:
   ```typescript
   // Only re-renders when title changes
   const title = useDoc(handle, d => d.title)
   ```

4. **Unified Presence** - Presence is tied to the handle, making it easy to manage document and presence together.

5. **Type Safety** - Full TypeScript support with proper type inference from schemas.

## Related Packages

- [`@loro-extended/react`](../react/README.md) - React bindings
- [`@loro-extended/hono`](../hono/README.md) - Hono/JSX bindings
- [`@loro-extended/change`](../change/README.md) - Schema definitions
- [`@loro-extended/repo`](../repo/README.md) - Document synchronization

## License

MIT