# Loro Extended Utilities

This monorepo contains a collection of packages that extend the functionality of the [Loro](https://github.com/loro-dev/loro) CRDT library.

## What is Loro?

[Loro](https://github.com/loro-dev/loro) is a high-performance CRDT (Conflict-free Replicated Data Type) library that enables real-time collaboration without conflicts. CRDTs allow multiple users to edit the same data simultaneously - changes automatically merge in a consistent way across all peers, even when they're offline.

## Why These Extensions?

While Loro provides powerful low-level CRDT operations, building collaborative applications requires additional abstractions:

- **Simpler APIs**: Writing `doc.getMap("root").setContainer("todos", new LoroList())` is verbose. With our extensions, you can write `d.todos = []`.
- **Document Management**: Syncing CRDTs across peers requires handling network protocols, storage, and peer discovery.
- **Framework Integration**: React and other frameworks need reactive bindings to automatically update UI when documents change.

These packages provide production-ready solutions to these common needs.

## Packages

-   **`packages/change`**: A utility that provides a simple, Immer-style `change()` method for mutating Loro documents.
    -   [View Package README](./packages/change/README.md)

-   **`packages/repo`**: A peer-to-peer document syncing repository, with plugable storage and network adapters.
    -   [View Package README](./packages/repo/README.md)

-   **`packages/network-sse`**: Server-Sent Events network adapter for real-time synchronization between clients and servers.
    -   [View Package README](./packages/network-sse/README.md)

-   **`packages/react`**: React hooks and utilities for using Loro in React applications. (TODO)
    -   [View Package README](./packages/react/README.md)

-   **`examples/todo-app`**: An example implementation of a React + Vite + ExpressJS app using `@loro-extended/change` and `@loro-extended/repo`.
    -   [View Package README](./examples/todo-app/README.md)
