# @loro-extended/hooks-core

Framework-agnostic hooks for building real-time collaborative applications with [Loro CRDT](https://github.com/loro-dev/loro) documents. This package provides the core hook implementations that are used by `@loro-extended/react` and `@loro-extended/hono`.

## Overview

This package implements a "handle-first" pattern for working with Loro documents:

1. **`useHandle`** - Get a stable, typed document handle (never re-renders)
2. **`useDoc`** - Subscribe to document changes with optional selectors
3. **`usePresence`** - Subscribe to presence state changes

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
  usePresence,
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

#### `useHandle(docId, docSchema, presenceSchema?)`

Returns a stable `TypedDocHandle` for the given document. The handle is created synchronously and never changes, preventing unnecessary re-renders.

```typescript
// Without presence
const handle = useHandle(docId, docSchema)

// With presence
const handle = useHandle(docId, docSchema, presenceSchema)
```

**Parameters:**
- `docId: DocId` - The document identifier
- `docSchema: DocShape` - The document schema (from `@loro-extended/change`)
- `presenceSchema?: ValueShape` - Optional presence schema

**Returns:** `TypedDocHandle<D, P>` - A typed handle with:
- `handle.value` - Current document value (readonly)
- `handle.change(fn)` - Mutate the document
- `handle.presence` - Typed presence API
- `handle.untyped` - Access to underlying `UntypedDocHandle`

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

#### `usePresence(handle)`

Subscribes to presence changes and returns the current presence state.

```typescript
const { self, peers } = usePresence(handle)

// self: Infer<P> - Your own presence state
// peers: Map<string, Infer<P>> - Other peers' presence states
```

**Parameters:**
- `handle: TypedDocHandle<D, P>` - The document handle with presence schema

**Returns:** `{ self: Infer<P>, peers: Map<string, Infer<P>> }`

## Usage Pattern

```typescript
import { Shape } from "@loro-extended/change"
import { useHandle, useDoc, usePresence } from "@loro-extended/react"

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
  // Get stable handle
  const handle = useHandle(docId, DocSchema, PresenceSchema)
  
  // Subscribe to document
  const doc = useDoc(handle)
  
  // Subscribe to presence
  const { self, peers } = usePresence(handle)
  
  // Mutate document
  const addItem = (text) => {
    handle.change(d => {
      d.items.push(text)
    })
  }
  
  // Update presence
  const updateCursor = (x, y) => {
    handle.presence.set({ cursor: { x, y } })
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