# Loro Extended Utilities

This monorepo contains a collection of packages that extend the functionality of the [Loro](https://github.com/loro-dev/loro) CRDT library.

## What is Loro?

[Loro](https://github.com/loro-dev/loro) is a high-performance CRDT (Conflict-free Replicated Data Type) library that enables real-time collaboration without conflicts. CRDTs allow multiple users to edit the same data simultaneously - changes automatically merge in a consistent way across all peers, even when they're offline.

## Why These Extensions?

While Loro provides powerful low-level CRDT operations, building collaborative applications requires additional abstractions:

- **Simpler APIs**: Writing `doc.getMap("root").setContainer("todos", new LoroList())` is verbose. With our extensions, you can write `d.todos = []`.
- **Document Management**: Syncing CRDTs across peers requires handling network protocols, storage, and peer discovery.
- **Framework Integration**: React and other frameworks need reactive bindings to automatically update UI when documents change.

These packages will soon provide production-ready solutions to these common needs.

## 🚀 Quick Start: Building a Collaborative React App

Want to build a real-time collaborative app? With the @loro-extended/react package, it's as simple as:

```tsx
import { useLoroDoc } from '@loro-extended/react'

const [doc, changeDoc, state] = useLoroDoc<TodoDoc>("document-id")

// Make changes with natural JavaScript syntax
changeDoc(d => {
  d.todos.push({ id: "1", text: "Build something amazing", done: false })
})

// Your UI automatically updates when any user makes changes!
// <>{doc.map(...)}</>
```

The `useLoroDoc` hook (and accompanying RepoProvider) handles everything:
- ✅ **Automatic synchronization** across all connected users
- ✅ **Offline support** with automatic reconnection and merge
- ✅ **Type-safe** mutations with TypeScript
- ✅ **React-optimized** re-renders only when data changes

This single hook connects all the pieces: `@loro-extended/change` for natural mutations, `@loro-extended/repo` for document management, and network adapters for real-time sync. Check out the [@loro-extended/react package](./packages/react/README.md) to see how easy collaborative apps can be!

## Packages

-   **`packages/change`**: A utility that provides a simple, Immer-style `change()` method for mutating Loro documents.
    -   [View Package README](./packages/change/README.md)

-   **`packages/repo`**: A peer-to-peer document syncing repository, with plugable storage and network adapters.
    -   [View Package README](./packages/repo/README.md)

-   **`packages/network-sse`**: Server-Sent Events network adapter for real-time synchronization between clients and servers.
    -   [View Package README](./packages/network-sse/README.md)

-   **`packages/react`**: React hooks and utilities for using Loro in React applications.
    -   [View Package README](./packages/react/README.md)

-   **`examples/todo-app`**: An example implementation of a React + Vite + ExpressJS app using `@loro-extended/change` and `@loro-extended/repo`.
    -   [View Package README](./examples/todo-app/README.md)
