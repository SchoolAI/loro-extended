# @loro-extended/change

This package provides utilities for working with [Loro](https://github.com/loro-dev/loro) CRDT documents using natural JavaScript syntax. It includes the `ExtendedLoroDoc` wrapper class and `change()` function for intuitive document manipulation, with optional patch generation for debugging and observability.

## Overview

Loro is a powerful CRDT library for building local-first applications. However, working with Loro documents directly can involve verbose operations and internal implementation details. This package provides:

- **`ExtendedLoroDoc`**: A wrapper class that hides Loro's internal "root" map structure
- **`change()`**: A function that tracks operations (similar to Immer or mutative) and simplifies making changes to docs.
- **`from()`**: Easy document creation from plain JavaScript objects
- **Debug Integration**: Optional patch generation for debugging and state management

## Key Features

- 🎯 **Clean API**: `doc.toJSON()` returns data directly without internal wrappers
- 🔄 **Natural Mutations**: Write `doc.title = "New Title"` instead of verbose CRDT operations
- 🛡️ **Type Safety**: Full TypeScript support with compile-time validation
- ⚡ **Transactional**: All changes within a `change()` block are atomic
- 🔗 **Interoperable**: Works seamlessly with existing Loro code
- 🐛 **Debug Support**: Optional patch generation for debugging and observability
- 📊 **Simplified Codebase**: Dramatically reduced complexity while maintaining full functionality

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

The `change` function provides transactional mutations:

```typescript
import { change } from "@loro-extended/change";

change(doc, (draft) => {
  // POJO operations
  draft.title = "New Title";
  draft.items.push({ id: 3, text: "New item", done: false });
  draft.items[0].done = true;

  // CRDT operations have direct access
  draft.counter.increment(5);
  draft.text.insert(0, "Hello ");

  draft.metadata = { lastModified: Date.now() };
});

// Document is automatically committed after the function completes
```

**Key Benefits:**

- All mutations are transactional and atomic
- Natural JavaScript syntax for complex operations
- Direct CRDT access for specialized operations
- Optional patch generation for debugging
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

## Nesting CRDTs

A LoroList can contain a plain-old javascript object (POJO):

```ts
    const list = new LoroList();
    list.push({ tags: ["javascript", "typescript"], title: "Article" });
```

The idea here is that you might want an object to exist inside the LoroList, complete and intact. There is no LoroMap inside a LoroList here--the object is either present within the list (presumably at the end, from the perspective of the local operation), or not.

OTOH you may want to have a LoroList whose items are LoroMap objects:

```ts
    const list = new LoroList();
    const map = new LoroMap();
    map.set("tags", ["javascript", "typescript"]);
    map.set("title", "Article");
    list.pushContainer(map);
```

Perhaps we could go one step further, where we want to have a LoroList whose items are LoroMap objects, and arrays at the leaves are LoroList again:

```ts
    const list = new LoroList();
    const map = new LoroMap();
    const langList = new LoroList();
    langList.push("javascript");
    langList.push("typescript");
    map.setContainer("tags", langList);
    map.set("title", "Article");
    list.pushContainer(map);
```

Each of these situations is "valid" within Loro's constraints, and represents a possible intent of the developer.

There are also some "invalid" configurations--for example, it is not possible to have a LoroList with a POJO object in it, that then contains a LoroText. 

In Loro, only containers (e.g., LoroMap, LoroList/MovableList, LoroText, LoroTree, etc.) participate in CRDT operations. Whenever you use a non-container value (a POJO, array, number, string, boolean, etc.), that value is a leaf in the document tree and Loro will not trace CRDT operations inside it. The APIs enforce this separation explicitly: there are “value” setters and “container” setters, and the value setters exclude containers. 


## Debug Integration

For debugging and observability, you can enable patch generation to track all changes using the functional approach:

```typescript
import { from, change } from "@loro-extended/change";

// Create document
const doc = from({
  name: "Initial",
  counter: CRDT.Counter(0),
  text: CRDT.Text(""),
});

// Enable patch generation by passing enablePatches: true
const [updatedDoc, patches] = change(
  doc,
  (draft) => {
    draft.name = "Alice"; // → Standard patch
    draft.counter.increment(5); // → Custom CRDT patch
    draft.text.insert(0, "Hello"); // → Custom CRDT patch
  },
  { enablePatches: true }
);

// Access patches directly from the return value
console.log(patches);
// [
//   { op: "replace", path: ["name"], value: "Alice" },
//   { op: "crdt", path: ["counter"], method: "increment", args: [5], crdtType: "counter" },
//   { op: "crdt", path: ["text"], method: "insert", args: [0, "Hello"], crdtType: "text" }
// ]

// For multiple operations, collect patches manually
const allPatches = [];
let currentDoc = doc;

[currentDoc, patches] = change(currentDoc, (d) => d.counter.increment(10), {
  enablePatches: true,
});
allPatches.push(...patches);

[currentDoc, patches] = change(currentDoc, (d) => (d.name = "Bob"), {
  enablePatches: true,
});
allPatches.push(...patches);
```

**Patch Types:**

- **Standard Patches**: Generated for POJO operations (objects, arrays, primitives)
- **CRDT Patches**: Custom patches that preserve semantic meaning of CRDT operations
- **Combined Stream**: Both types are returned together when `enablePatches: true`

**Use Cases:**

- Time-travel debugging
- State change visualization
- Network synchronization of debug state
- Audit trails and change history
- Integration with state management libraries (TEA, Redux, etc.)

**Functional Pattern Benefits:**

- No complex interfaces to implement
- Direct access to patches when needed
- Consumers decide how to handle patches
- Simpler integration with existing state management

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

This package implements a dual-mode architecture that dramatically simplifies CRDT operations:

### Internal Structure

- **Internally**: Documents still use a root `LoroMap` container for compatibility
- **Externally**: The `toJSON()` method returns clean data without the wrapper
- **Change Processing**: Mutative handles state transitions, CRDT proxies capture specialized operations
- **Benefit**: Maintains full Loro compatibility while providing a dramatically simpler implementation

For historical context on the design decisions, see:

- [Change Refactor Post-Mortem](../../docs/change-refactor-post-mortem.md)
- [Second Refactor Attempt](../../docs/change-refactor-post-mortem2.md)
- [Dual-Mode Proxy Architecture](../../docs/dual-proxy.md)

## API Reference

### ExtendedLoroDoc Methods

- `toJSON(): T` - Returns clean JSON without internal wrappers
- `get doc(): LoroDoc` - Access underlying LoroDoc
- `commit(): void` - Commit pending changes
- `export(mode?)` - Export as binary snapshot
- `import(data)` - Import from binary snapshot
- `getMap(name: string): LoroMap` - Get a map container (for compatibility)

### Static Methods

- `ExtendedLoroDoc.wrap<T>(doc: LoroDoc): ExtendedLoroDoc<T>`
- `ExtendedLoroDoc.unwrap<T>(extended: ExtendedLoroDoc<T>): LoroDoc`
- `ExtendedLoroDoc.import<T>(data: Uint8Array): ExtendedLoroDoc<T>`

### Utility Functions

- `from<T>(initialState: T): ExtendedLoroDoc<T>`
- `change<T>(doc: ExtendedLoroDoc<T>, fn: (draft: T) => void): ExtendedLoroDoc<T>`
- `change<T>(doc: ExtendedLoroDoc<T>, fn: (draft: T) => void, options: { enablePatches: true }): [ExtendedLoroDoc<T>, CombinedPatch[]]`

### Types

```typescript
interface ChangeOptions {
  enablePatches?: boolean;
}

interface CRDTPatch {
  op: "crdt";
  path: string[];
  method: string;
  args: unknown[];
  crdtType: "counter" | "text" | "map" | "list";
  timestamp: number;
}

type CombinedPatch = Patch | CRDTPatch; // Patch from JSON Patch

// CRDT wrapper types
const CRDT = {
  Text: (initialValue?: string) => LoroTextWrapper,
  Counter: (initialValue?: number) => LoroCounterWrapper,
};
```

## Contributing

This package is part of the loro-extended ecosystem. Contributions are welcome!

- **Build**: `pnpm build`
- **Test**: `pnpm test`
- **Lint**: Uses Biome for formatting and linting

## License

MIT
