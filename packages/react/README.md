# @loro-extended/react

React hooks for building real-time collaborative applications with [Loro CRDT](https://github.com/loro-dev/loro) documents. Offers both **simple untyped** and **schema-based typed** APIs.

## What This Package Does

This package provides React-specific bindings for Loro CRDT documents with two approaches:

- **Simple API**: Direct LoroDoc access without schema dependencies
- **Typed API**: Schema-based documents with type safety and empty state management

### Key Features

- **Document Lifecycle**: Automatic loading, creation, and synchronization of documents
- **React Integration**: Reactive hooks that re-render when documents change
- **Flexible APIs**: Choose between simple or typed approaches based on your needs
- **Type Safety**: Full TypeScript support (optional schema-driven type inference)
- **Loading States**: Handle sync status separately from data availability

## Installation

### For Simple API (no schema dependencies)

```bash
npm install @loro-extended/react @loro-extended/repo loro-crdt
# or
pnpm add @loro-extended/react @loro-extended/repo loro-crdt
```

### For Typed API (with schema support)

```bash
npm install @loro-extended/react @loro-extended/change @loro-extended/repo loro-crdt
# or
pnpm add @loro-extended/react @loro-extended/change @loro-extended/repo loro-crdt
```

## Quick Start

### Simple API (Untyped)

For direct LoroDoc access without schema dependencies:

```tsx
import { useUntypedDocument } from "@loro-extended/react";

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

      <button
        onClick={() =>
          changeDoc((doc) => {
            const todosList = doc.getList("todos");
            todosList.push({
              id: Date.now().toString(),
              text: "New Todo",
              completed: false,
            });
          })
        }
      >
        Add Todo
      </button>
    </div>
  );
}
```

### Typed API (Schema-based)

For schema-aware documents with type safety and empty state management:

```tsx
import { useDocument, Shape } from "@loro-extended/react";

// Define your document schema (see @loro-extended/change for details)
const todoSchema = Shape.doc({
  title: Shape.text().placeholder("My Todo List"),
  todos: Shape.list(
    Shape.plain.object({
      id: Shape.plain.string(),
      text: Shape.plain.string(),
      completed: Shape.plain.boolean(),
    })
  ),
});

function TypedTodoApp() {
  const [doc, changeDoc, handle] = useDocument("todo-doc", todoSchema);

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
                // Update the specific todo item
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

      <button
        onClick={() =>
          changeDoc((draft) => {
            draft.todos.push({
              id: Date.now().toString(),
              text: "New Todo",
              completed: false,
            });
          })
        }
      >
        Add Todo
      </button>
    </div>
  );
}
```

## Core Hooks

### `useUntypedDocument` - Simple API

For direct LoroDoc access without schema dependencies.

#### Signature

```typescript
function useUntypedDocument<T = any>(
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
  schema: T
): [
  doc: InferPlainType<T>,
  changeDoc: (fn: ChangeFn<T>) => void,
  handle: DocHandle | null
];
```

#### Parameters

- **`documentId`**: Unique identifier for the document
- **`schema`**: Document schema (see [`@loro-extended/change`](../change/README.md) for schema documentation)

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

## Choosing Between APIs

### Use Simple API When:

- You want minimal dependencies (no schema package required)
- You prefer direct control over LoroDoc operations
- You're building a simple application or prototype
- You want to integrate with existing Loro code

### Use Typed API When:

- You want full type safety and IntelliSense support
- You prefer declarative schema definitions
- You want empty state management (no loading checks needed)
- You're building a complex application with structured data

## Key Benefits

### Simple API Benefits

- **Minimal Dependencies**: Only requires `@loro-extended/react` and `loro-crdt`
- **Direct Control**: Full access to LoroDoc methods and operations
- **Flexibility**: No schema constraints, work with any document structure
- **Performance**: No schema transformation overhead

### Typed API Benefits

- **🚀 No Loading States for Data**: `doc` is **always defined** due to empty state overlay
- **🔄 Immediate Rendering**: Components render immediately with empty state
- **🎯 Type Safety**: Full TypeScript support with compile-time validation
- **🛡️ Schema Validation**: Ensures data consistency across your application

#### Example: No Loading States

```tsx
// Simple API - requires loading check
const [doc, changeDoc] = useUntypedDocument("doc-id");
if (!doc) return <div>Loading...</div>;

// Typed API - always available
const [doc, changeDoc] = useDocument("doc-id", schema);
return <h1>{doc.title}</h1>; // Always works!
```

## Setting Up the Repo Context

Wrap your app with `RepoProvider` to provide document synchronization:

```tsx
import { RepoProvider } from "@loro-extended/react";
import { Repo } from "@loro-extended/repo";

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

## React-Specific Patterns

### Multiple Documents

```tsx
// Simple API
function MultiDocApp() {
  const [todos, changeTodos] = useUntypedDocument<TodoDoc>("todos");
  const [notes, changeNotes] = useUntypedDocument<NoteDoc>("notes");

  return (
    <div>
      {todos && <TodoList doc={todos.toJSON()} onChange={changeTodos} />}
      {notes && <NoteEditor doc={notes.toJSON()} onChange={changeNotes} />}
    </div>
  );
}

// Typed API
function MultiDocApp() {
  const [todos, changeTodos] = useDocument("todos", todoSchema);
  const [notes, changeNotes] = useDocument("notes", noteSchema);

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
// Simple API
function ConditionalDoc({ documentId }: { documentId: string | null }) {
  const [doc, changeDoc] = useUntypedDocument(documentId || "default");

  if (!documentId) {
    return <div>Select a document</div>;
  }

  if (!doc) {
    return <div>Loading...</div>;
  }

  return <DocumentEditor doc={doc.toJSON()} onChange={changeDoc} />;
}

// Typed API
function ConditionalDoc({ documentId }: { documentId: string | null }) {
  const [doc, changeDoc] = useDocument(documentId || "default", schema);

  if (!documentId) {
    return <div>Select a document</div>;
  }

  return <DocumentEditor doc={doc} onChange={changeDoc} />;
}
```

### Custom Loading UI

```tsx
function DocumentWithStatus() {
  const [doc, changeDoc, handle] = useDocument(id, schema);

  // Check readyStates to determine sync status
  const isSyncing = handle?.readyStates.some(
    (s) => s.loading.state === "requesting"
  );

  return (
    <div>
      {isSyncing && <div className="status-bar">Syncing...</div>}
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
const [doc, changeDoc] = useDocument(documentId, schema);
// doc: { title: string; todos: Array<{id: string; text: string; completed: boolean}> }
// changeDoc: (fn: (draft: DraftType) => void) => void
```

## Complete Example

For a full collaborative React application, see the [Todo SSE Example](../../examples/todo-sse/README.md) which demonstrates:

- Setting up the Repo with network and storage adapters
- Using `useDocument` for reactive document state
- Building collaborative UI components
- Handling offline scenarios

## Advanced Usage

For advanced use cases, you can access the underlying building blocks:

```tsx
import {
  useDocHandleState,
  useRawLoroDoc,
  useUntypedDocChanger,
  useTypedDocState,
  useTypedDocChanger,
} from "@loro-extended/react";

// Custom hook combining base components
function useCustomDocument(documentId: string) {
  const { handle } = useDocHandleState(documentId);
  const changeDoc = useUntypedDocChanger(handle);

  // Your custom logic here

  return [
    /* your custom return */
  ];
}
```

## Requirements

- React 18+
- TypeScript 5+ (recommended)
- A Repo instance from `@loro-extended/repo`

### Optional Dependencies

- `@loro-extended/change` - Required only for typed API (`useDocument`)

## Related Packages

- [`@loro-extended/change`](../change/README.md) - Schema-based CRDT operations (optional)
- [`@loro-extended/repo`](../repo/README.md) - Document synchronization and storage
- Network adapters: `@loro-extended/adapter-sse`, `@loro-extended/adapter-websocket`, `@loro-extended/adapter-webrtc`, `@loro-extended/adapter-http-polling`
- Storage adapters: `@loro-extended/adapter-indexeddb`, `@loro-extended/adapter-leveldb`, `@loro-extended/adapter-postgres`

## License

MIT
