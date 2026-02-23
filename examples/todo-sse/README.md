# Loro Todo App Example

A real-time collaborative todo application demonstrating the power of [Loro](https://github.com/loro-dev/loro) CRDTs with React, using the `@loro-extended/change` and `@loro-extended/repo` packages.

## What is Loro?

Loro is a high-performance CRDT (Conflict-free Replicated Data Type) library that enables automatic synchronization and conflict resolution for collaborative applications. CRDTs allow multiple users to edit the same data simultaneously without conflicts - changes merge automatically and consistently across all peers.

## How This Example Works

This todo app showcases:

- **Real-time collaboration** - Multiple users can add, edit, and delete todos simultaneously
- **Offline-first** - Works offline and syncs when reconnected
- **Automatic conflict resolution** - No merge conflicts, ever
- **React integration** - Seamless reactive updates using the `useDocument` hook

## Architecture

The app uses two key packages from this monorepo, via `@loro-extended/react`:

### `@loro-extended/change`

Provides an Immer-style API for mutating Loro documents. Instead of using Loro's low-level operations, you can write natural JavaScript:

```typescript
import { change } from "@loro-extended/change";

change(doc, (d) => {
  d.todos.push({ id: "...", text: "New todo", completed: false });
});
```

### `@loro-extended/repo`

Manages document synchronization across peers with pluggable storage and network adapters:

- **Client**: Uses IndexedDB for persistence and Server-Sent Events for real-time sync
- **Server**: Uses LevelDB for persistence and broadcasts changes to all connected clients

## Getting Started

### Install dependencies

```bash
pnpm install
```

### Build the monorepo packages

```bash
pnpm -w build
```

### Run the development server

```bash
cd examples/todo-app
pnpm dev
```

This starts:

- React app on http://localhost:5173
- Express sync server on http://localhost:5170

Open multiple browser windows to see real-time collaboration in action!

## Core Example

The heart of the integration is the `useDocument` hook:

```typescript
import { useDocument, useValue } from "@loro-extended/react";
import { change, Shape } from "@loro-extended/change";

const TodoSchema = Shape.doc({
  todos: Shape.list(
    Shape.struct({
      id: Shape.plain.string(),
      text: Shape.plain.string(),
      completed: Shape.plain.boolean(),
    })
  ),
});

function TodoApp() {
  const doc = useDocument("todo-doc", TodoSchema);
  const todos = useValue(doc.todos);

  const addTodo = (text: string) => {
    doc.todos.push({
      id: crypto.randomUUID(),
      text,
      completed: false,
    });
  };

  return (
    <ul>
      {todos.map((todo) => (
        <li key={todo.id}>{todo.text}</li>
      ))}
    </ul>
  );
}
```

### Hook Returns

- `doc` - A typed document reference (stable, auto-syncs)
- `useValue(doc.field)` - Subscribe to reactive updates for a specific field

## Key Features

### Reactive Updates

The document state automatically updates when:

- Local changes are made
- Remote changes are received from other peers
- The document is loaded from storage

### Automatic Synchronization

The `Repo` handles all the complexity:

- Announces documents to peers
- Requests missing documents
- Merges concurrent changes
- Persists to local storage

### Type Safety

Full TypeScript support with document schemas:

```typescript
interface TodoDoc {
  todos: Todo[];
}
```

## Project Structure

```
src/
├── client/          # React application
│   ├── App.tsx      # Main component with todo logic
│   ├── hooks/       # Custom React hooks
│   └── contexts/    # React contexts for Repo
├── server/          # Express sync server
│   └── server.ts    # SSE endpoint for peer sync
└── shared/          # Shared types
```

## Learn More

- [Loro Documentation](https://loro.dev)
- [@loro-extended/change README](../../packages/change/README.md)
- [@loro-extended/repo README](../../packages/repo/README.md)
- [CRDT Introduction](https://crdt.tech/)
