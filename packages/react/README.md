# @loro-extended/react

React hooks and utilities for building real-time collaborative applications with [Loro](https://github.com/loro-dev/loro) CRDTs.

## Overview

This package provides React-specific bindings for Loro, making it easy to build collaborative applications where multiple users can edit the same data simultaneously. Changes automatically sync and merge without conflicts, even when users are offline.

## Why Use This?

Building collaborative React apps with raw Loro requires:
- Manual subscription to document changes
- Converting between Loro's internal format and React state
- Managing document lifecycle and synchronization
- Handling loading states and error conditions

This package solves these challenges with a simple, reactive hook that feels natural in React.

## Installation

```bash
npm install @loro-extended/react
# or
pnpm add @loro-extended/react
```

## Core Hook: `useLoroDoc`

The `useLoroDoc` hook provides a reactive interface to Loro documents with automatic synchronization.

### Basic Usage

```tsx
import { useLoroDoc } from "@loro-extended/react"

interface MyDoc {
  title: string
  items: Array<{ id: string; text: string; done: boolean }>
}

function MyComponent() {
  const [doc, changeDoc, state] = useLoroDoc<MyDoc>("document-id")

  if (state !== "ready") {
    return <div>Loading...</div>
  }

  return (
    <div>
      <h1>{doc.title}</h1>
      <button onClick={() => changeDoc(d => d.title = "New Title")}>
        Change Title
      </button>
      
      {doc.items.map(item => (
        <div key={item.id}>
          <input
            type="checkbox"
            checked={item.done}
            onChange={() => changeDoc(d => {
              const found = d.items.find(i => i.id === item.id)
              if (found) found.done = !found.done
            })}
          />
          {item.text}
        </div>
      ))}
    </div>
  )
}
```

### Hook Returns

`useLoroDoc` returns a tuple with three elements:

1. **`doc: T | undefined`** - The current document state
   - Automatically updates when local or remote changes occur
   - `undefined` when loading or unavailable

2. **`changeDoc: (fn: (doc: T) => void) => void`** - Function to modify the document
   - Uses an Immer-style API for natural mutations
   - Changes are automatically converted to CRDT operations
   - Synchronizes with all connected peers

3. **`state: "loading" | "ready" | "unavailable"`** - Current document state
   - `"loading"` - Document is being loaded from storage or network
   - `"ready"` - Document is available and synchronized
   - `"unavailable"` - Document cannot be accessed

## Setting Up the Repo Context

Before using `useLoroDoc`, you need to provide a Repo instance via context:

```tsx
import { RepoProvider } from "@loro-extended/react"
import { Repo } from "@loro-extended/repo"
import { SseClientNetworkAdapter } from "@loro-extended/network-sse/client"

// Create adapters for network and storage
const network = new SseClientNetworkAdapter("/api/sync")
const storage = new IndexedDBStorageAdapter()

// Create the Repo instance
const repo = new Repo({ 
  network: [network], 
  storage 
})

// Wrap your app with the provider
function App() {
  return (
    <RepoProvider value={repo}>
      <YourComponents />
    </RepoProvider>
  )
}
```

## Features

### 🔄 Real-time Synchronization
Changes made by any user are instantly synchronized to all connected clients. The hook automatically re-renders your component when remote changes arrive.

### 🔌 Offline Support
Documents are persisted locally and changes are queued when offline. When reconnected, changes automatically sync and merge.

### 🎯 Type Safety
Full TypeScript support with type inference for your document schema:

```typescript
interface TodoDoc {
  todos: Array<{
    id: string
    text: string
    completed: boolean
  }>
}

const [doc, changeDoc] = useLoroDoc<TodoDoc>("todos")
// doc is typed as TodoDoc | undefined
// changeDoc enforces TodoDoc structure
```

### ⚡ Optimized Re-renders
The hook uses React's `useSyncExternalStore` for optimal performance, only re-rendering when the document actually changes.

### 🛠️ Natural API
Write mutations using familiar JavaScript syntax:

```typescript
changeDoc(d => {
  // Array operations
  d.items.push({ id: "1", text: "New item" })
  d.items.splice(0, 1)
  
  // Object mutations
  d.settings.theme = "dark"
  delete d.settings.oldProp
  
  // Nested updates
  d.users[0].profile.name = "Alice"
})
```

## Complete Example

For a complete example of a collaborative React application using this package, see the [Todo App Example](../../examples/todo-app/README.md) in this repository. It demonstrates:

- Setting up the Repo with network and storage adapters
- Using `useLoroDoc` for reactive document state
- Building a fully collaborative todo list
- Handling loading states and offline scenarios

## How It Works

Under the hood, this package:

1. **Subscribes to document changes** using Loro's event system
2. **Converts Loro documents** to plain JavaScript objects for React
3. **Translates mutations** into CRDT operations using [@loro-extended/change](../change/README.md)
4. **Manages synchronization** through [@loro-extended/repo](../repo/README.md)
5. **Optimizes React updates** using `useSyncExternalStore`

## Requirements

- React 18+
- TypeScript 5+ (recommended for best experience)
- A Repo instance from `@loro-extended/repo`

## License

MIT