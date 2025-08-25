# @loro-extended/change

This package provides utilities for working with [Loro](https://github.com/loro-dev/loro) CRDT documents using natural JavaScript syntax. It includes the `ExtendedLoroDoc` wrapper class and `change()` function for intuitive document manipulation.

## Overview

Loro is a powerful CRDT library for building local-first applications. However, working with Loro documents directly can involve verbose operations and internal implementation details. This package provides:

- **`ExtendedLoroDoc`**: A wrapper class that hides Loro's internal "root" map structure
- **`change()`**: An Immer-style function for making transactional mutations
- **`from()`**: Easy document creation from plain JavaScript objects

## Key Features

- 🎯 **Clean API**: `doc.toJSON()` returns data directly without internal wrappers
- 🔄 **Natural Mutations**: Write `doc.title = "New Title"` instead of verbose CRDT operations
- 🛡️ **Type Safety**: Full TypeScript support with compile-time validation
- ⚡ **Transactional**: All changes within a `change()` block are atomic
- 🔗 **Interoperable**: Works seamlessly with existing Loro code

## Installation

```bash
npm install @loro-extended/change
# or
pnpm add @loro-extended/change
```

## Quick Start

```typescript
import { from, change } from "@loro-extended/change";

// Create a document from plain JavaScript
const doc = from({
  title: "My Document",
  items: [{ id: 1, text: "First item", done: false }],
});

// Make changes with natural syntax
change(doc, (d) => {
  d.title = "Updated Document";
  d.items.push({ id: 2, text: "Second item", done: true });
  d.items[0].done = true;
});

// Get clean JSON output (no internal "root" wrapper)
console.log(doc.toJSON());
// Output: { title: "Updated Document", items: [...] }
```

## Core Components

### `ExtendedLoroDoc<T>`

A wrapper around `LoroDoc` that provides a cleaner API:

```typescript
import { ExtendedLoroDoc } from "@loro-extended/change";
import { LoroDoc } from "loro-crdt";

// Create from existing LoroDoc
const loroDoc = new LoroDoc();
const extendedDoc = ExtendedLoroDoc.wrap<MyType>(loroDoc);

// Or create new
const doc = new ExtendedLoroDoc<MyType>();

// Clean JSON output (no .root required)
const data = doc.toJSON(); // Returns MyType directly

// Access underlying LoroDoc when needed
const underlying = doc.doc;
```

### `change(doc, mutator)`

The `change` function provides transactional mutations with a proxied draft:

```typescript
import { change } from "@loro-extended/change";

change(doc, (draft) => {
  // All changes are queued and applied atomically
  draft.title = "New Title";
  draft.items.push({ id: 3, text: "New item", done: false });
  draft.metadata = { lastModified: Date.now() };
});

// Document is automatically committed after the function completes
```

**Key Benefits:**

- All mutations are transactional and atomic
- Natural JavaScript syntax for complex operations
- Automatic conversion to appropriate CRDT operations
- Type-safe mutations with TypeScript

### `from<T>(initialState)`

Creates a new `ExtendedLoroDoc` from a plain JavaScript object:

```typescript
import { from, CRDT } from "@loro-extended/change";

interface MyDoc {
  title: string;
  description: string | null;
  items: Array<{ id: number; text: string; done: boolean }>;
  metadata: { created: number };
}

const doc = from<MyDoc>({
  title: "My Document",
  description: null,
  items: [],
  metadata: { created: Date.now() },
});
```

## Working with Rich CRDT Types

For advanced use cases, you can use Loro's rich CRDT types like `LoroText` and `LoroCounter`:

```typescript
import { from, change, CRDT } from "@loro-extended/change";
import type { LoroText, LoroCounter } from "loro-crdt";

interface MyDoc {
  title: LoroText; // Rich text with collaborative editing
  description: string | null;
  viewCount: LoroCounter; // Increment-only counter
  tasks: Array<{
    id: number;
    text: string;
    completed: boolean;
  }>;
}

// Create document with rich CRDT types
const doc = from<MyDoc>({
  title: CRDT.Text("My Tasks"),
  description: null,
  viewCount: CRDT.Counter(0),
  tasks: [],
});

// Work with rich types in change blocks
change(doc, (draft) => {
  // LoroText operations
  draft.title.insert(0, "✅ ");
  draft.title.insert(draft.title.length, " (Updated)");

  // LoroCounter operations
  draft.viewCount.increment(1);

  // Regular array/object operations
  draft.tasks.push({ id: 1, text: "Write docs", completed: false });
});
```

## Type Safety

This package provides full TypeScript support with compile-time validation:

```typescript
interface TodoDoc {
  title: string;
  todos: Array<{ id: string; text: string; done: boolean }>;
}

const doc = from<TodoDoc>({
  title: "My Todos",
  todos: [],
});

change(doc, (draft) => {
  draft.title = "Updated Todos"; // ✅ Valid
  draft.todos.push({ id: "1", text: "Learn Loro", done: false }); // ✅ Valid

  // draft.title = 123  // ❌ TypeScript error
  // draft.todos.push({ invalid: "field" })  // ❌ TypeScript error
});
```

**Important Notes:**

- Optional properties (`field?: string`) are not supported
- Use `string | null` instead of `string | undefined`
- The underlying Loro library treats `null` and `undefined` equivalently

## Interoperability

`ExtendedLoroDoc` is designed to work seamlessly with existing Loro code:

```typescript
import { ExtendedLoroDoc } from "@loro-extended/change";
import { LoroDoc } from "loro-crdt";

// Wrap existing LoroDoc
const existingDoc = new LoroDoc();
const extended = ExtendedLoroDoc.wrap(existingDoc);

// Unwrap to get original LoroDoc
const original = ExtendedLoroDoc.unwrap(extended);

// Access underlying doc directly
const underlying = extended.doc;
```

## Architecture Notes

This package implements a compromise solution for hiding Loro's internal "root" map structure:

- **Internally**: Documents still use a root `LoroMap` container for compatibility
- **Externally**: The `toJSON()` method returns clean data without the wrapper
- **Benefit**: Maintains full Loro compatibility while providing a cleaner API

For historical context on the design decisions, see:

- [Change Refactor Post-Mortem](../../docs/change-refactor-post-mortem.md)
- [Second Refactor Attempt](../../docs/change-refactor-post-mortem2.md)

## API Reference

### ExtendedLoroDoc Methods

- `toJSON(): T` - Returns clean JSON without internal wrappers
- `get doc(): LoroDoc` - Access underlying LoroDoc
- `get data(): T` - Proxied access to document data
- `commit(): void` - Commit pending changes
- `export(mode?)` - Export as binary snapshot
- `import(data)` - Import from binary snapshot

### Static Methods

- `ExtendedLoroDoc.wrap<T>(doc: LoroDoc): ExtendedLoroDoc<T>`
- `ExtendedLoroDoc.unwrap<T>(extended: ExtendedLoroDoc<T>): LoroDoc`
- `ExtendedLoroDoc.import<T>(data: Uint8Array): ExtendedLoroDoc<T>`

### Utility Functions

- `from<T>(initialState: T): ExtendedLoroDoc<T>`
- `change<T>(doc: ExtendedLoroDoc<T>, fn: (draft: T) => void): ExtendedLoroDoc<T>`

## Contributing

This package is part of the loro-extended ecosystem. Contributions are welcome!

- **Build**: `pnpm build`
- **Test**: `pnpm test`
- **Lint**: Uses Biome for formatting and linting

## License

MIT
