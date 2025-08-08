# Loro Todo App Example

A real-time collaborative todo application demonstrating the power of [Loro](https://github.com/loro-dev/loro) CRDTs with React, using the `@loro-extended/change` and `@loro-extended/repo` packages.

## What is Loro?

Loro is a high-performance CRDT (Conflict-free Replicated Data Type) library that enables automatic synchronization and conflict resolution for collaborative applications. CRDTs allow multiple users to edit the same data simultaneously without conflicts - changes merge automatically and consistently across all peers.

## How This Example Works

This todo app showcases:

- **Real-time collaboration** - Multiple users can add, edit, and delete todos simultaneously
- **Offline-first** - Works offline and syncs when reconnected
- **Automatic conflict resolution** - No merge conflicts, ever
- **React integration** - Seamless reactive updates using the `useLoroDoc` hook

## Architecture

The app uses two key packages from this monorepo:

### `@loro-extended/change`

Provides an Immer-style API for mutating Loro documents. Instead of using Loro's low-level operations, you can write natural JavaScript:

```typescript
changeDoc((d) => {
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

### Run the development server

```bash
pnpm dev
```

This starts:

- React app on http://localhost:5173
- Express sync server on http://localhost:3001

Open multiple browser windows to see real-time collaboration in action!

## Core Example

The heart of the integration is the `useLoroDoc` hook:

```typescript
const [doc, changeDoc, state] = useLoroDoc<TodoDoc>(TODO_DOC_ID);

const addTodo = (text: string) => {
  changeDoc((d) => {
    if (!d.todos) {
      d.todos = [];
    }
    d.todos.push({
      id: crypto.randomUUID(),
      text,
      completed: false,
    });
  });
};
```

### Hook Returns

- `doc` - The current document state (reactive - updates automatically)
- `changeDoc` - Function to mutate the document using natural JavaScript syntax
- `state` - Loading state (`'loading'` | `'ready'` | `'unavailable'`)

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
