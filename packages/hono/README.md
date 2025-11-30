# @loro-extended/hono

Hono JSX hooks for building real-time collaborative applications with [Loro CRDT](https://github.com/loro-dev/loro) documents. Offers both **simple untyped** and **schema-based typed** APIs.

## What This Package Does

This package provides Hono JSX-specific bindings for Loro CRDT documents with two approaches:

- **Simple API**: Direct LoroDoc access without schema dependencies
- **Typed API**: Schema-based documents with type safety and empty state management

This package mirrors the API of `@loro-extended/react` but uses Hono's JSX implementation (`hono/jsx`) instead of React.

### Key Features

- **Document Lifecycle**: Automatic loading, creation, and synchronization of documents
- **Hono JSX Integration**: Reactive hooks that re-render when documents change
- **Flexible APIs**: Choose between simple or typed approaches based on your needs
- **Type Safety**: Full TypeScript support (optional schema-driven type inference)
- **Loading States**: Handle sync status separately from data availability

## Installation

### For Simple API (no schema dependencies)

```bash
npm install @loro-extended/hono @loro-extended/repo loro-crdt hono
# or
pnpm add @loro-extended/hono @loro-extended/repo loro-crdt hono
```

### For Typed API (with schema support)

```bash
npm install @loro-extended/hono @loro-extended/change @loro-extended/repo loro-crdt hono
# or
pnpm add @loro-extended/hono @loro-extended/change @loro-extended/repo loro-crdt hono
```

## Quick Start

### Simple API (Untyped)

For direct LoroDoc access without schema dependencies:

```tsx
import { useUntypedDocument } from "@loro-extended/hono";

interface TodoDoc {
  title: string;
  todos: Array<{ id: string; text: string; completed: boolean }>;
}

function SimpleTodoApp() {
  const [doc, changeDoc, handle] = useUntypedDocument("todo-doc");

  // Check if doc is ready before using
  if (!doc) {
    return <div>Loading...</div>;
  }

  const data = doc.toJSON() as TodoDoc;

  return (
    <div>
      <h1>{data.title || "My Todo List"}</h1>

      <button
        onClick={() =>
          changeDoc((doc) => {
            const titleText = doc.getText("title");
            titleText.insert(0, "📝 ");
          })
        }
      >
        Add Emoji
      </button>

      {(data.todos || []).map((todo, index) => (
        <div key={todo.id}>
          <input
            type="checkbox"
            checked={todo.completed}
            onChange={() =>
              changeDoc((doc) => {
                const todosList = doc.getList("todos");
                const todoMap = todosList.get(index);
                if (todoMap) {
                  todoMap.set("completed", !todo.completed);
                }
              })
            }
          />
          {todo.text}
        </div>
      ))}
    </div>
  );
}
```

### Typed API (Schema-based)

For schema-aware documents with type safety and empty state management:

```tsx
import { useDocument, Shape } from "@loro-extended/hono";

// Define your document schema (see @loro-extended/change for details)
const todoSchema = Shape.doc({
  title: Shape.text(),
  todos: Shape.list(
    Shape.plain.object({
      id: Shape.plain.string(),
      text: Shape.plain.string(),
      completed: Shape.plain.boolean(),
    })
  ),
});

// Define empty state (default values)
const emptyState = {
  title: "My Todo List",
  todos: [],
};

function TypedTodoApp() {
  const [doc, changeDoc, handle] = useDocument(
    "todo-doc",
    todoSchema,
    emptyState
  );

  // doc is ALWAYS defined - no loading check needed!
  return (
    <div>
      <h1>{doc.title}</h1>

      <button
        onClick={() =>
          changeDoc((draft) => {
            draft.title.insert(0, "📝 ");
          })
        }
      >
        Add Emoji
      </button>

      {doc.todos.map((todo, index) => (
        <div key={todo.id}>
          <input
            type="checkbox"
            checked={todo.completed}
            onChange={() =>
              changeDoc((draft) => {
                const todoItem = draft.todos.get(index);
                if (todoItem) {
                  todoItem.completed = !todo.completed;
                }
              })
            }
          />
          {todo.text}
        </div>
      ))}
    </div>
  );
}
```

## Core Hooks

### `useUntypedDocument` - Simple API

For direct LoroDoc access without schema dependencies.

#### Signature

```typescript
function useUntypedDocument(
  documentId: string
): [
  doc: LoroDoc | null,
  changeDoc: (fn: SimpleChangeFn) => void,
  handle: DocHandle | null
];
```

#### Parameters

- **`documentId`**: Unique identifier for the document

#### Returns

1. **`doc: LoroDoc | null`** - The raw LoroDoc instance

   - `null` when not ready (requires loading check)
   - Direct access to all LoroDoc methods when available
   - Use `doc.toJSON()` to get plain JavaScript object

2. **`changeDoc: (fn: SimpleChangeFn) => void`** - Function to modify the document

   - Provides direct access to LoroDoc for mutations
   - Example: `changeDoc(doc => doc.getText("title").insert(0, "Hello"))`

3. **`handle: DocHandle | null`** - The document handle
   - Provides access to sync state (via `readyStates`) and events
   - `null` initially, then becomes available

### `useDocument` - Typed API

For schema-aware documents with type safety and empty state management.

#### Signature

```typescript
function useDocument<T extends DocShape>(
  documentId: string,
  schema: T,
  emptyState: InferPlainType<T>
): [
  doc: InferPlainType<T>,
  changeDoc: (fn: ChangeFn<T>) => void,
  handle: DocHandle | null
];
```

#### Parameters

- **`documentId`**: Unique identifier for the document
- **`schema`**: Document schema (see [`@loro-extended/change`](../change/README.md) for schema documentation)
- **`emptyState`**: Default values shown before/during sync

#### Returns

1. **`doc: InferPlainType<T>`** - The current document state

   - **Always defined** due to empty state overlay
   - Shows empty state initially, then overlays CRDT data when available
   - Automatically re-renders when local or remote changes occur

2. **`changeDoc: (fn: ChangeFn<T>) => void`** - Function to modify the document

   - Uses schema-aware draft operations
   - All changes are automatically committed and synchronized
   - See [`@loro-extended/change`](../change/README.md) for operation details

3. **`handle: DocHandle | null`** - The document handle
   - Provides access to sync state (via `readyStates`)
   - Emits events for state changes and document updates
   - `null` initially, then becomes available

### `usePresence` - Typed Presence

For schema-aware presence with type safety and default values.

```typescript
const { self, all, setSelf } = usePresence(
  documentId,
  presenceSchema,
  emptyPresence
);

// self: InferPlainType<PresenceSchema>
// all: Record<string, InferPlainType<PresenceSchema>>
```

### `useUntypedPresence` - Untyped Presence

For presence without schema validation.

```typescript
const { self, all, setSelf } = useUntypedPresence(documentId);

// self: any
// all: Record<string, any>
```

## Setting Up the Repo Context

Wrap your app with `RepoProvider` to provide document synchronization:

```tsx
import { RepoProvider } from "@loro-extended/hono";

// Configure your adapters (see @loro-extended/repo docs)
const config = {
  identity: { name: "user-1", type: "user" },
  adapters: [networkAdapter, storageAdapter],
};

function App() {
  return (
    <RepoProvider config={config}>
      <YourComponents />
    </RepoProvider>
  );
}
```

## Differences from @loro-extended/react

This package is nearly identical to `@loro-extended/react`, with the following differences:

- Uses `hono/jsx` instead of `react` for JSX runtime
- Uses Hono's `useMemo`, `useEffect`, `useSyncExternalStore`, etc. from `hono/jsx`
- Designed for Hono-based applications and edge runtimes (not yet tested)

The API surface is intentionally kept the same to make it easy to switch between React and Hono implementations.

## Complete Example

For a full collaborative Hono application, see the [Hono Counter Example](../../examples/hono-counter/README.md) which demonstrates:

- Setting up the Repo with network adapters
- Using `useDocument` for reactive document state
- Building collaborative UI components with Hono JSX

## Requirements

- Hono 4+
- TypeScript 5+ (recommended)
- A Repo instance from `@loro-extended/repo`

### Optional Dependencies

- `@loro-extended/change` - Required only for typed API (`useDocument`)

## Related Packages

- [`@loro-extended/change`](../change/README.md) - Schema-based CRDT operations (optional)
- [`@loro-extended/repo`](../repo/README.md) - Document synchronization and storage
- [`@loro-extended/react`](../react/README.md) - React version of these hooks
- Network adapters: `@loro-extended/adapter-sse`, `@loro-extended/adapter-websocket`, `@loro-extended/adapter-webrtc`, `@loro-extended/adapter-http-polling`
- Storage adapters: `@loro-extended/adapter-indexeddb`, `@loro-extended/adapter-leveldb`, `@loro-extended/adapter-postgres`

## License

MIT
