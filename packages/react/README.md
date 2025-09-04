# @loro-extended/react

React hooks for building real-time collaborative applications with schema-based [Loro CRDT](https://github.com/loro-dev/loro) documents.

## What This Package Does

This package provides React-specific bindings for the schema-based `@loro-extended/change` system, making it easy to build collaborative React applications. It handles:

- **Document Lifecycle**: Automatic loading, creation, and synchronization of documents
- **React Integration**: Reactive hooks that re-render when documents change
- **Empty State Management**: Documents are always available, showing defaults before sync
- **Type Safety**: Full TypeScript support with schema-driven type inference
- **Loading States**: Handle sync status separately from data availability

## Installation

```bash
npm install @loro-extended/react @loro-extended/change loro-crdt zod
# or
pnpm add @loro-extended/react @loro-extended/change loro-crdt zod
```

## Quick Start

```tsx
import { useDocument, LoroShape } from "@loro-extended/react";
import { z } from "zod";

// Define your document schema (see @loro-extended/change for details)
const todoSchema = LoroShape.doc({
  title: LoroShape.text(),
  todos: LoroShape.list(z.object({
    id: z.string(),
    text: z.string(),
    completed: z.boolean()
  }))
});

// Define empty state (default values)
const emptyState = {
  title: "My Todo List",
  todos: []
};

function TodoApp() {
  const [doc, changeDoc, handle] = useDocument("todo-doc", todoSchema, emptyState);

  // doc is ALWAYS defined - no loading check needed!
  return (
    <div>
      {handle?.state === "loading" && <div>Syncing...</div>}
      
      <h1>{doc.title}</h1>
      
      <button onClick={() => changeDoc(draft => {
        draft.title.insert(0, "📝 ");
      })}>
        Add Emoji
      </button>

      {doc.todos.map((todo, index) => (
        <div key={todo.id}>
          <input
            type="checkbox"
            checked={todo.completed}
            onChange={() => changeDoc(draft => {
              // Update the specific todo item
              const todoItem = draft.todos.get(index);
              if (todoItem) {
                todoItem.completed = !todo.completed;
              }
            })}
          />
          {todo.text}
        </div>
      ))}

      <button onClick={() => changeDoc(draft => {
        draft.todos.push({
          id: Date.now().toString(),
          text: "New Todo",
          completed: false
        });
      })}>
        Add Todo
      </button>
    </div>
  );
}
```

## Core Hook: `useDocument`

The main hook for working with collaborative documents in React.

### Signature

```typescript
function useDocument<T extends LoroDocSchema>(
  documentId: string,
  schema: T,
  emptyState: InferEmptyType<T>
): [doc, changeDoc, handle]
```

### Parameters

- **`documentId`**: Unique identifier for the document
- **`schema`**: Document schema (see [`@loro-extended/change`](../change/README.md) for schema documentation)
- **`emptyState`**: Default values shown before/during sync

### Returns

A tuple with three elements:

1. **`doc: InferEmptyType<T>`** - The current document state
   - **Always defined** due to empty state overlay
   - Shows empty state initially, then overlays CRDT data when available
   - Automatically re-renders when local or remote changes occur

2. **`changeDoc: (fn: ChangeFn<T>) => void`** - Function to modify the document
   - Uses schema-aware draft operations
   - All changes are automatically committed and synchronized
   - See [`@loro-extended/change`](../change/README.md) for operation details

3. **`handle: DocHandle | null`** - The document handle
   - Provides access to sync state: `"loading" | "ready" | "unavailable"`
   - Emits events for state changes and document updates
   - `null` initially, then becomes available

## Key Benefits

### 🚀 No Loading States for Data

Unlike traditional approaches, `doc` is **always defined**:

```tsx
// ❌ Old pattern - not needed!
if (!doc) {
  return <div>Loading...</div>;
}

// ✅ New pattern - doc is always available
return (
  <div>
    {handle?.state === "loading" && <div>Syncing...</div>}
    <h1>{doc.title}</h1> {/* Always works! */}
  </div>
);
```

### 🔄 Immediate Rendering

Components render immediately with empty state, then seamlessly update when CRDT data arrives:

```tsx
// Empty state shows immediately: { title: "My Todos", todos: [] }
// After sync: { title: "📝 My Todos", todos: [{ id: "1", text: "Learn Loro", completed: false }] }
```

### 🎯 Separate Sync Status

Handle loading/sync status independently from data availability:

```tsx
const [doc, changeDoc, handle] = useDocument(id, schema, emptyState);

return (
  <div>
    {/* Show sync status */}
    {handle?.state === "loading" && <div>Connecting...</div>}
    {handle?.state === "unavailable" && <div>Offline</div>}
    
    {/* Always render content */}
    <h1>{doc.title}</h1>
    <TodoList todos={doc.todos} onChange={changeDoc} />
  </div>
);
```

## Setting Up the Repo Context

Wrap your app with `RepoProvider` to provide document synchronization:

```tsx
import { RepoProvider } from "@loro-extended/react";
import { Repo } from "@loro-extended/repo";

// Configure your adapters (see @loro-extended/repo docs)
const repo = new Repo({
  network: [networkAdapter],
  storage: storageAdapter,
});

function App() {
  return (
    <RepoProvider config={{ network: [networkAdapter], storage: storageAdapter }}>
      <YourComponents />
    </RepoProvider>
  );
}
```

## React-Specific Patterns

### Multiple Documents

```tsx
function MultiDocApp() {
  const [todos, changeTodos] = useDocument("todos", todoSchema, todoEmptyState);
  const [notes, changeNotes] = useDocument("notes", noteSchema, noteEmptyState);
  
  return (
    <div>
      <TodoList doc={todos} onChange={changeTodos} />
      <NoteEditor doc={notes} onChange={changeNotes} />
    </div>
  );
}
```

### Conditional Document Loading

```tsx
function ConditionalDoc({ documentId }: { documentId: string | null }) {
  const [doc, changeDoc] = useDocument(
    documentId || "default", 
    schema, 
    emptyState
  );
  
  if (!documentId) {
    return <div>Select a document</div>;
  }
  
  return <DocumentEditor doc={doc} onChange={changeDoc} />;
}
```

### Custom Loading UI

```tsx
function DocumentWithStatus() {
  const [doc, changeDoc, handle] = useDocument(id, schema, emptyState);
  
  const syncStatus = {
    loading: "Connecting to server...",
    ready: "Connected",
    unavailable: "Working offline"
  }[handle?.state || "loading"];
  
  return (
    <div>
      <div className="status-bar">{syncStatus}</div>
      <DocumentContent doc={doc} onChange={changeDoc} />
    </div>
  );
}
```

## Performance

The hook uses React's `useSyncExternalStore` for optimal performance:

- Only re-renders when the document actually changes
- Efficient subscription management
- Stable function references to prevent unnecessary re-renders

## Type Safety

Full TypeScript support with automatic type inference:

```typescript
// Types are automatically inferred from your schema
const [doc, changeDoc] = useDocument(documentId, schema, emptyState);
// doc: { title: string; todos: Array<{id: string; text: string; completed: boolean}> }
// changeDoc: (fn: (draft: DraftType) => void) => void
```

## Complete Example

For a full collaborative React application, see the [Todo App Example](../../examples/todo-app/README.md) which demonstrates:

- Setting up the Repo with network and storage adapters
- Using `useDocument` for reactive document state
- Building collaborative UI components
- Handling offline scenarios

## Requirements

- React 18+
- TypeScript 5+ (recommended)
- A Repo instance from `@loro-extended/repo`

## Related Packages

- [`@loro-extended/change`](../change/README.md) - Schema-based CRDT operations
- [`@loro-extended/repo`](../repo/README.md) - Document synchronization and storage
- [`@loro-extended/adapters`](../adapters/README.md) - Network and storage adapters

## License

MIT
