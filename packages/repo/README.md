# Loro Repo

`@loro-extended/repo` is a core component for building distributed local-first applications with [Loro](https://github.com/loro-dev/loro), a fast CRDTs-based state synchronization library.

## What is Loro?

Loro is a library of CRDTs (Conflict-free Replicated Data Types) that enables real-time collaboration and local-first applications. It allows multiple users to concurrently modify a shared JSON-like data structure, merging changes automatically without conflicts. Data is stored locally and can be synced with peers when a network connection is available.

# DocHandle

The `DocHandle` is a stateful wrapper around a single Loro document. It provides a higher-level API to manage the document's lifecycle, state, and mutations, abstracting away the complexities of the underlying CRDT. It is inspired by the `DocHandle` from `automerge-repo`.

## DocHandle Usage

The `DocHandle` provides a robust, event-driven way to interact with a Loro document.

### Key Concepts

- **State Machine**: A handle progresses through a simple lifecycle: `idle` -> `loading` -> `ready`.
- **Loading**: The `load()` method takes an async function that you provide to fetch or create your Loro document. This de-couples the handle from any specific storage or network logic.
- **Mutations**: Changes are made via the `change()` method, which provides a mutable draft of your document.
- **Events**: The handle emits `change`, `sync-message`, and `state-change` events to drive your application's reactivity.

### Example

```typescript
import { LoroDoc } from "loro-crdt";
import { DocHandle } from "@loro-extended/repo";

// Define the shape of your document
type MyDoc = {
  title: string;
  tasks: { description: string; completed: boolean }[];
};

const handle = new DocHandle<MyDoc>("my-document-id");

// Listen for state changes
handle.on("doc-handle-state-transition", ({ newState }) => {
  console.log(`Handle state is now: ${newState}`);
});

// Load the document (e.g., from a database or a new in-memory instance)
await handle.load(async () => {
  // In a real app, you would load from storage here.
  return new LoroDoc();
});

// Now the handle is 'ready'
await handle.whenReady();

// Listen for changes
handle.on("doc-handle-change", ({ doc }) => {
  console.log("Document changed:", doc.toJSON().root);
});

// Mutate the document
handle.change((doc) => {
  doc.title = "My Collaborative Document";
  doc.tasks = [{ description: "Finish the README", completed: true }];
});
```

## Future Work

This package provides the core `DocHandle` class. The next layers to be built on top of this are:

- **Repo**: A collection of `DocHandle`s that orchestrates storage and networking.
- **Storage Adapters**: Pluggable modules for persisting documents (e.g., to IndexedDB).
- **Network Adapters**: Pluggable modules for syncing documents between peers (e.g., via WebSockets or WebRTC).

These pieces will work together to provide a complete, batteries-included solution for local-first state management with Loro.
