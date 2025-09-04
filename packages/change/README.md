# @loro-extended/change

A schema-driven, type-safe wrapper for [Loro CRDT](https://github.com/loro-dev/loro) that provides natural JavaScript syntax for collaborative document editing. Build local-first applications with intuitive APIs while maintaining full CRDT capabilities.

## What is Loro?

[Loro](https://github.com/loro-dev/loro) is a high-performance CRDT (Conflict-free Replicated Data Type) library that enables real-time collaborative editing without conflicts. It's perfect for building local-first applications like collaborative editors, task managers, and (turn-based) multiplayer games.

## Why Use `change`?

Working with Loro directly involves somewhat verbose container operations and complex type management. The `change` package provides:

- **Schema-First Design**: Define your document structure with type-safe schemas
- **Natural Syntax**: Write `draft.title.insert(0, "Hello")` instead of verbose CRDT operations
- **Empty State Overlay**: Seamlessly blend default values with CRDT state
- **Full Type Safety**: Complete TypeScript support with compile-time validation
- **Transactional Changes**: All mutations within a `change()` block are atomic
- **Loro Compatible**: Works seamlessly with existing Loro code

## Installation

```bash
npm install @loro-extended/change loro-crdt zod
# or
pnpm add @loro-extended/change loro-crdt zod
```

## Quick Start

```typescript
import { createTypedDoc, change, LoroShape } from "@loro-extended/change";
import { z } from "zod";

// Define your document schema
const schema = LoroShape.doc({
  title: LoroShape.text(),
  todos: LoroShape.list(
    z.object({
      id: z.string(),
      text: z.string(),
      completed: z.boolean(),
    })
  ),
});

// Define empty state (default values)
const emptyState = {
  title: "My Todo List",
  todos: [],
};

// Create a typed document
const doc = createTypedDoc(schema, emptyState);

// Make changes with natural syntax
const result = doc.change((draft) => {
  draft.title.insert(0, "📝 ");
  draft.todos.push({
    id: "1",
    text: "Learn Loro",
    completed: false,
  });
});

console.log(result);
// { title: "📝 My Todo List", todos: [{ id: "1", text: "Learn Loro", completed: false }] }
```

Note that this is even more useful in combination with `@loro-extended/react` (if your app uses React) and `@loro-extended/repo` for syncing between client/server or among peers.

## Core Concepts

### Schema Definition with `LoroShape`

Define your document structure using `LoroShape` builders (and optionally, zod):

```typescript
import { LoroShape } from "@loro-extended/change";
import { z } from "zod";

const blogSchema = LoroShape.doc({
  // CRDT containers for collaborative editing
  title: LoroShape.text(), // Collaborative text
  viewCount: LoroShape.counter(), // Increment-only counter

  // Lists for ordered data
  tags: LoroShape.list(z.string()), // List of strings

  // Maps for structured data
  metadata: LoroShape.map({
    author: z.string(), // Plain values (POJOs)
    publishedAt: z.date(),
    featured: z.boolean(),
  }),

  // Movable lists for reorderable content
  sections: LoroShape.movableList(
    LoroShape.map({
      heading: LoroShape.text(), // Collaborative headings
      content: LoroShape.text(), // Collaborative content
      order: z.number(), // Plain metadata
    })
  ),
});
```

NOTE: Only put plain values inside Loro containers. A Loro container inside a plain js list or map won't work.

### Empty State Overlay

Empty state provides default values that appear when CRDT containers are empty:

```typescript
const emptyState = {
  title: "Untitled Document", // unusual empty state, but technically ok
  viewCount: 0,
  tags: [],
  metadata: {
    author: "Anonymous",
    publishedAt: new Date(),
    featured: false,
  },
  sections: [],
};

const doc = createTypedDoc(blogSchema, emptyState);

// Initially returns empty state
console.log(doc.value);
// { title: "Untitled Document", viewCount: 0, ... }

// After changes, CRDT values overlay empty state
doc.change((draft) => {
  draft.title.insert(0, "My Blog Post");
  draft.viewCount.increment(10);
});

console.log(doc.value);
// { title: "My Blog Post", viewCount: 10, tags: [], ... }
//   ↑ CRDT value    ↑ CRDT value    ↑ empty state preserved
```

### The `change()` Function

All mutations happen within transactional `change()` blocks:

```typescript
const result = doc.change((draft) => {
  // Text operations
  draft.title.insert(0, "📝");
  draft.title.delete(5, 3);

  // Counter operations
  draft.viewCount.increment(1);
  draft.viewCount.decrement(2);

  // List operations
  draft.tags.push("typescript");
  draft.tags.insert(0, "loro");
  draft.tags.delete(1, 1);

  // Map operations (POJO values)
  draft.metadata.set("author", "John Doe");
  draft.metadata.delete("featured");

  // Movable list operations
  draft.sections.push({
    heading: "Introduction",
    content: "Welcome to my blog...",
    order: 1,
  });
  draft.sections.move(0, 1); // Reorder sections
});

// All changes are committed atomically
console.log(result); // Updated document state
```

## Advanced Usage

### Nested Structures

Handle complex nested documents with ease:

```typescript
const complexSchema = LoroShape.doc({
  article: LoroShape.map({
    title: LoroShape.text(),
    metadata: LoroShape.map({
      views: LoroShape.counter(),
      author: LoroShape.map({
        name: z.string(),
        email: z.string(),
      }),
    }),
  }),
});

const emptyState = {
  article: {
    title: "",
    metadata: {
      views: 0,
      author: {
        name: "Anonymous",
        email: "",
      },
    },
  },
};

const doc = createTypedDoc(complexSchema, emptyState);

doc.change((draft) => {
  draft.article.title.insert(0, "Deep Nesting Example");
  draft.article.metadata.views.increment(5);
  draft.article.metadata.author.set("name", "Alice");
  draft.article.metadata.author.set("email", "alice@example.com");
});
```

### POJO Mutations with `update()`

For complex object mutations, use the `update()` method:

```typescript
const schema = LoroShape.doc({
  settings: LoroShape.map({
    ui: z.object({
      theme: z.string(),
      sidebar: z.object({
        collapsed: z.boolean(),
        width: z.number(),
      }),
    }),
  }),
});

doc.change((draft) => {
  // Natural object mutation syntax
  draft.settings.update((settings) => {
    settings.ui.theme = "dark";
    settings.ui.sidebar.collapsed = true;
    settings.ui.sidebar.width = 250;
  });
});
```

Under the hood, `update` is using [mutative](https://github.com/unadlib/mutative)'s `create` function, with type forwarding from the TypedLoroDoc schema.

### Lists with Container Items

Create lists containing CRDT containers for collaborative nested structures:

```typescript
const collaborativeSchema = LoroShape.doc({
  articles: LoroShape.list(
    LoroShape.map({
      title: LoroShape.text(), // Collaborative title
      content: LoroShape.text(), // Collaborative content
      tags: LoroShape.list(z.string()), // Collaborative tag list
      metadata: z.object({
        // Static metadata
        authorId: z.string(),
        publishedAt: z.date(),
      }),
    })
  ),
});

doc.change((draft) => {
  // Push creates and configures nested containers automatically
  draft.articles.push({
    title: "Collaborative Article",
    content: "This content can be edited by multiple users...",
    tags: ["collaboration", "crdt"],
    metadata: {
      authorId: "user123",
      publishedAt: new Date(),
    },
  });

  // Later, edit the collaborative parts
  // Note: articles[0] returns the actual CRDT containers
  draft.articles.get(0)?.title.insert(0, "✨ ");
  draft.articles.get(0)?.tags.push("real-time");
});
```

## API Reference

### Core Functions

#### `createTypedDoc<T>(schema, emptyState, existingDoc?)`

Creates a new typed Loro document.

```typescript
const doc = createTypedDoc(schema, emptyState);
const docFromExisting = createTypedDoc(schema, emptyState, existingLoroDoc);
```

#### `change<T>(typedDoc, mutator)`

Applies transactional changes to a document.

```typescript
const result = doc.change((draft) => {
  // Make changes to draft
});
```

### Schema Builders

#### `LoroShape.doc(shape)`

Creates a document schema.

```typescript
const schema = LoroShape.doc({
  field1: LoroShape.text(),
  field2: LoroShape.counter(),
});
```

#### Container Types

- `LoroShape.text()` - Collaborative text editing
- `LoroShape.counter()` - Increment-only counters
- `LoroShape.list(itemSchema)` - Ordered lists
- `LoroShape.movableList(itemSchema)` - Reorderable lists
- `LoroShape.map(shape)` - Key-value maps
- `LoroShape.tree()` - Hierarchical tree structures

### TypedLoroDoc Methods

#### `.value`

Returns the current document state with empty state overlay.

```typescript
const currentState = doc.value;
```

This is better than using the LoroDoc `toJSON()` method because it forwards inferred type information from the schema you defined.

#### `.rawValue`

Returns raw CRDT state without empty state overlay.

```typescript
const crdtState = doc.rawValue;
```

#### `.loroDoc`

Access the underlying LoroDoc for advanced operations.

```typescript
const loroDoc = doc.loroDoc;

const foods = loroDoc.getMap("foods");
const drinks = loroDoc.getOrCreateContainer("drinks", new LoroMap());
// etc.
```

## CRDT Container Operations

### Text Operations

```typescript
draft.title.insert(index, content);
draft.title.delete(index, length);
draft.title.update(newContent); // Replace entire content
draft.title.mark(range, key, value); // Add formatting
draft.title.unmark(range, key); // Remove formatting
draft.title.toDelta(); // Get Delta format
draft.title.applyDelta(delta); // Apply Delta operations
```

### Counter Operations

```typescript
draft.count.increment(value);
draft.count.decrement(value);
const current = draft.count.value;
```

### List Operations

```typescript
draft.items.push(item);
draft.items.insert(index, item);
draft.items.delete(index, length);
const item = draft.items.get(index);
const array = draft.items.toArray();
const length = draft.items.length;
```

### Movable List Operations

```typescript
draft.tasks.push(item);
draft.tasks.insert(index, item);
draft.tasks.set(index, item); // Replace item
draft.tasks.move(fromIndex, toIndex); // Reorder
draft.tasks.delete(index, length);
```

### Map Operations

```typescript
draft.metadata.set(key, value);
draft.metadata.get(key);
draft.metadata.delete(key);
draft.metadata.has(key);
draft.metadata.keys();
draft.metadata.values();

// For POJO mutations
draft.metadata.update((obj) => {
  obj.nested.property = newValue;
});
```

## Type Safety

Full TypeScript support with compile-time validation. You can define your desired interface and ensure the schema matches:

```typescript
import { createTypedDoc, LoroShape, type InferEmptyType } from "@loro-extended/change";
import { z } from "zod";

// Define your desired interface
interface TodoDoc {
  title: string;
  todos: Array<{ id: string; text: string; done: boolean }>;
}

// Define the schema that matches your interface
const todoSchema = LoroShape.doc({
  title: LoroShape.text(),
  todos: LoroShape.list(z.object({
    id: z.string(),
    text: z.string(),
    done: z.boolean()
  }))
});

// Define empty state that matches your interface
const emptyState: TodoDoc = {
  title: "My Todos",
  todos: []
};

// TypeScript will ensure the schema produces the correct type
const doc = createTypedDoc(todoSchema, emptyState);

// The result will be properly typed as TodoDoc
const result: TodoDoc = doc.change((draft) => {
  draft.title.insert(0, "Hello"); // ✅ Valid - TypeScript knows this is LoroText
  draft.todos.push({              // ✅ Valid - TypeScript knows the expected shape
    id: "1",
    text: "Learn Loro",
    done: false,
  });

  // draft.title.insert(0, 123);         // ❌ TypeScript error
  // draft.todos.push({ invalid: true }); // ❌ TypeScript error
});

// You can also use type assertion to ensure schema compatibility
type SchemaType = InferEmptyType<typeof todoSchema>;
const _typeCheck: TodoDoc = {} as SchemaType; // ✅ Will error if types don't match
```

**Note**: Use `string | null` instead of `string | undefined` for optional fields, as Loro treats `null` and `undefined` equivalently.

## Integration with Existing Loro Code

`TypedLoroDoc` works seamlessly with existing Loro applications:

```typescript
import { LoroDoc } from "loro-crdt";

// Wrap existing LoroDoc
const existingDoc = new LoroDoc();
const typedDoc = createTypedDoc(schema, emptyState, existingDoc);

// Access underlying LoroDoc
const loroDoc = typedDoc.loroDoc;

// Use with existing Loro APIs
loroDoc.subscribe((event) => {
  console.log("Document changed:", event);
});
```

## Performance Considerations

- All changes within a `change()` block are batched into a single transaction
- Empty state overlay is computed on-demand, not stored
- Container creation is lazy - containers are only created when accessed
- Type validation occurs at development time, not runtime

## Contributing

This package is part of the loro-extended ecosystem. Contributions welcome!

- **Build**: `pnpm build`
- **Test**: `pnpm test`
- **Lint**: Uses Biome for formatting and linting

## License

MIT
