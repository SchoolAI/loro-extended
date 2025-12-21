# @loro-extended/change

A schema-driven, type-safe wrapper for [Loro CRDT](https://github.com/loro-dev/loro) that provides natural JavaScript syntax for collaborative document editing. Build local-first applications with intuitive APIs while maintaining full CRDT capabilities.

## What is Loro?

[Loro](https://github.com/loro-dev/loro) is a high-performance CRDT (Conflict-free Replicated Data Type) library that enables real-time collaborative editing without conflicts. It's perfect for building local-first applications like collaborative editors, task managers, and (turn-based) multiplayer games.

## Why Use `change`?

Working with Loro directly involves somewhat verbose container operations and complex type management. The `change` package provides:

- **Schema-First Design**: Define your document structure with type-safe schemas
- **Natural Syntax**: Write `doc.title.insert(0, "Hello")` instead of verbose CRDT operations
- **Empty State Overlay**: Seamlessly blend default values with CRDT state
- **Full Type Safety**: Complete TypeScript support with compile-time validation
- **Transactional Changes**: All mutations within a `$.batch()` block are atomic
- **Loro Compatible**: Works seamlessly with existing Loro code (`doc.$.loroDoc` is a familiar `LoroDoc`)

## Installation

```bash
npm install @loro-extended/change loro-crdt
# or
pnpm add @loro-extended/change loro-crdt
```

## Quick Start

```typescript
import { createTypedDoc, Shape, change } from "@loro-extended/change";

// Define your document schema
const schema = Shape.doc({
  title: Shape.text().placeholder("My Todo List"),
  count: Shape.counter(),
  users: Shape.record(
    Shape.plain.struct({
      name: Shape.plain.string(),
    })
  ),
});

// Create a typed document
const doc = createTypedDoc(schema);

// Direct mutations - commit immediately (auto-commit mode)
doc.title.insert(0, "📝 Todo");
doc.count.increment(5);
doc.users.set("alice", { name: "Alice" });

// Check existence
if (doc.users.has("alice")) {
  console.log("Alice exists!");
}
if ("alice" in doc.users) {
  console.log("Also works with 'in' operator!");
}

// Batched mutations - commit together (optional, for performance)
// Using functional helper (recommended)
change(doc, (draft) => {
  draft.title.insert(0, "Change: ");
  draft.count.increment(10);
  draft.users.set("bob", { name: "Bob" });
});
// All changes commit as one transaction

// Get JSON snapshot using functional helper
console.log(doc.toJSON());
// { title: "Change: 📝 Todo", count: 15, users: { alice: { name: "Alice" }, bob: { name: "Bob" } } }
```

Note that this is even more useful in combination with `@loro-extended/react` (if your app uses React) and `@loro-extended/repo` for syncing between client/server or among peers.

## Core Concepts

### Schema Definition with `Shape`

Define your document structure using `Shape` builders:

```typescript
import { Shape } from "@loro-extended/change";

const blogSchema = Shape.doc({
  // CRDT containers for collaborative editing
  title: Shape.text(), // Collaborative text
  viewCount: Shape.counter(), // Increment-only counter

  // Lists for ordered data
  tags: Shape.list(Shape.plain.string()), // List of strings

  // Structs for structured data with fixed keys
  metadata: Shape.struct({
    author: Shape.plain.string(), // Plain values (POJOs)
    publishedAt: Shape.plain.string(), // ISO date string
    featured: Shape.plain.boolean(),
  }),

  // Movable lists for reorderable content
  sections: Shape.movableList(
    Shape.struct({
      heading: Shape.text(), // Collaborative headings
      content: Shape.text(), // Collaborative content
      order: Shape.plain.number(), // Plain metadata
    })
  ),
});
```

**NOTE:** Use `Shape.*` for collaborative containers and `Shape.plain.*` for plain values. Only put plain values inside Loro containers - a Loro container inside a plain JS struct or array won't work.

### Empty State Overlay

Empty state provides default values that are merged when CRDT containers are empty, keeping the whole document typesafe:

```typescript
// Use .placeholder() to set default values
const blogSchemaWithDefaults = Shape.doc({
  title: Shape.text().placeholder("Untitled Document"),
  viewCount: Shape.counter(), // defaults to 0
  tags: Shape.list(Shape.plain.string()), // defaults to []
  metadata: Shape.struct({
    author: Shape.plain.string().placeholder("Anonymous"),
    publishedAt: Shape.plain.string(), // defaults to ""
    featured: Shape.plain.boolean(), // defaults to false
  }),
  sections: Shape.movableList(
    Shape.struct({
      heading: Shape.text(),
      content: Shape.text(),
      order: Shape.plain.number(),
    })
  ),
});

const doc = createTypedDoc(blogSchemaWithDefaults);

// Initially returns empty state
console.log(doc.toJSON());
// { title: "Untitled Document", viewCount: 0, ... }

// After changes, CRDT values take priority over empty state
change(doc, (draft) => {
  draft.title.insert(0, "My Blog Post");
  draft.viewCount.increment(10);
});

console.log(doc.toJSON());
// { title: "My Blog Post",  viewCount: 10,  tags: [], ... }
//   ↑ CRDT value            ↑ CRDT value    ↑ empty state preserved
```

### Direct Mutations vs Batched Mutations

With the Grand Unified API, schema properties are accessed directly on the doc. Mutations commit immediately by default:

```typescript
// Direct mutations - each commits immediately
doc.title.insert(0, "📝");
doc.viewCount.increment(1);
doc.tags.push("typescript");
```

For batched operations (better performance, atomic undo), use `change()`:

```typescript
import { change } from "@loro-extended/change";

change(doc, (draft) => {
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

  // Struct operations (POJO values)
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

// All changes are committed atomically as one transaction
// change() returns the doc for chaining
console.log(doc.toJSON()); // Updated document state
```

### When to Use `change()` vs Direct Mutations

| Use Case                          | Approach                             |
| --------------------------------- | ------------------------------------ |
| Single mutation                   | Direct: `doc.count.increment(1)`     |
| Multiple related mutations        | Batched: `change(doc, d => { ... })` |
| Atomic undo/redo                  | Batched: `change(doc, d => { ... })` |
| Performance-critical bulk updates | Batched: `change(doc, d => { ... })` |
| Simple reads + writes             | Direct: `doc.users.set(...)`         |

> **Note:** The `$.change()` method is available as an escape hatch, but the functional `change()` helper is recommended for cleaner code.

## Advanced Usage

### Discriminated Unions

For type-safe tagged unions (like different message types or presence states), use `Shape.plain.discriminatedUnion()`:

```typescript
import { Shape, mergeValue } from "@loro-extended/change";

// Define variant shapes - each must have the discriminant key
const ClientPresenceShape = Shape.plain.struct({
  type: Shape.plain.string("client"), // Literal type for discrimination
  name: Shape.plain.string(),
  input: Shape.plain.struct({
    force: Shape.plain.number(),
    angle: Shape.plain.number(),
  }),
});

const ServerPresenceShape = Shape.plain.struct({
  type: Shape.plain.string("server"), // Literal type for discrimination
  cars: Shape.plain.record(
    Shape.plain.struct({
      x: Shape.plain.number(),
      y: Shape.plain.number(),
    })
  ),
  tick: Shape.plain.number(),
});

// Create the discriminated union
const GamePresenceSchema = Shape.plain.discriminatedUnion("type", {
  client: ClientPresenceShape,
  server: ServerPresenceShape,
});

// Empty states for each variant
const EmptyClientPresence = {
  type: "client" as const,
  name: "",
  input: { force: 0, angle: 0 },
};

const EmptyServerPresence = {
  type: "server" as const,
  cars: {},
  tick: 0,
};

// Use with mergeValue for presence data
const crdtValue = { type: "client", name: "Alice" };
const result = mergeValue(GamePresenceSchema, crdtValue, EmptyClientPresence);
// Result: { type: "client", name: "Alice", input: { force: 0, angle: 0 } }

// Type-safe filtering
function handlePresence(presence: typeof result) {
  if (presence.type === "server") {
    // TypeScript knows this is ServerPresence
    console.log(presence.cars, presence.tick);
  } else {
    // TypeScript knows this is ClientPresence
    console.log(presence.name, presence.input);
  }
}
```

**Key features:**

- The discriminant key (e.g., `"type"`) determines which variant shape to use
- Missing fields are filled from the empty state of the matching variant
- Works seamlessly with `@loro-extended/react`'s `usePresence` hook
- Full TypeScript support for discriminated union types

### Nested Structures

Handle complex nested documents with ease:

```typescript
const complexSchema = Shape.doc({
  article: Shape.struct({
    title: Shape.text(),
    metadata: Shape.struct({
      views: Shape.counter(),
      author: Shape.struct({
        name: Shape.plain.string(),
        email: Shape.plain.string(),
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

const doc = createTypedDoc(complexSchema);

change(doc, (draft) => {
  draft.article.title.insert(0, "Deep Nesting Example");
  draft.article.metadata.views.increment(5);
  draft.article.metadata.author.name = "Alice"; // plain string update is captured and applied after closure
  draft.article.metadata.author.email = "alice@example.com"; // same here
});
```

### Struct Operations

For struct containers (fixed-key objects), use direct property access:

```typescript
const schema = Shape.doc({
  settings: Shape.struct({
    theme: Shape.plain.string(),
    collapsed: Shape.plain.boolean(),
    width: Shape.plain.number(),
  }),
});

change(doc, (draft) => {
  // Set individual values
  draft.settings.theme = "dark";
  draft.settings.collapsed = true;
  draft.settings.width = 250;
});
```

### Lists with Container Items

Create lists containing CRDT containers for collaborative nested structures:

```typescript
const collaborativeSchema = Shape.doc({
  articles: Shape.list(
    Shape.struct({
      title: Shape.text(), // Collaborative title
      content: Shape.text(), // Collaborative content
      tags: Shape.list(Shape.plain.string()), // Collaborative tag list
      metadata: Shape.plain.struct({
        // Static metadata
        authorId: Shape.plain.string(),
        publishedAt: Shape.plain.string(),
      }),
    })
  ),
});

change(doc, (draft) => {
  // Push creates and configures nested containers automatically
  draft.articles.push({
    title: "Collaborative Article",
    content: "This content can be edited by multiple users...",
    tags: ["collaboration", "crdt"],
    metadata: {
      authorId: "user123",
      publishedAt: new Date().toISOString(),
    },
  });

  // Later, edit the collaborative parts
  // Note: articles[0] returns the actual CRDT containers
  draft.articles.get(0)?.title.insert(0, "✨ ");
  draft.articles.get(0)?.tags.push("real-time");
});
```

## Path Selector DSL

The `@loro-extended/change` package exports a type-safe path selector DSL for building (a subset of) JSONPath expressions with full TypeScript type inference. This is primarily used by `TypedDocHandle.subscribe()` in `@loro-extended/repo` for efficient, type-safe subscriptions:

```typescript
// In @loro-extended/repo, use with TypedDocHandle.subscribe():
handle.subscribe(
  (p) => p.books.$each.title, // Type-safe path selector
  (titles, prev) => {
    // titles: string[], prev: string[] | undefined
    console.log("Titles changed:", titles);
  }
);

// DSL constructs:
// p.config.theme        - Property access
// p.books.$each         - All items in list/record
// p.books.$at(0)        - Item at index (supports negative: -1 = last)
// p.books.$first        - First item (alias for $at(0))
// p.books.$last         - Last item (alias for $at(-1))
// p.users.$key("alice") - Record value by key
```

See `@loro-extended/repo` documentation for full details on `TypedDocHandle.subscribe()`.

## API Reference

### Core Functions

#### `createTypedDoc<T>(schema, existingDoc?)`

Creates a new typed Loro document. This is the recommended way to create documents.

```typescript
import { createTypedDoc, Shape } from "@loro-extended/change";

const doc = createTypedDoc(schema);
const docFromExisting = createTypedDoc(schema, existingLoroDoc);
```

#### `new TypedDoc<T>(schema, existingDoc?)` _(deprecated)_

Constructor-style API. Use `createTypedDoc()` instead for cleaner code.

```typescript
// Deprecated - use createTypedDoc() instead
const doc = new TypedDoc(schema);
```

### Functional Helpers (Recommended)

These functional helpers provide a cleaner API and are the recommended way to work with TypedDoc:

#### `change(doc, mutator)`

Batches multiple mutations into a single transaction. Returns the doc for chaining.

```typescript
import { change } from "@loro-extended/change";

change(doc, (draft) => {
  draft.title.insert(0, "Hello");
  draft.count.increment(5);
});

// Chainable - change returns the doc
change(doc, (d) => d.count.increment(1)).count.increment(2);
```

#### `doc.toJSON()`

Returns the full plain JavaScript object representation of the document.

```typescript
const snapshot = doc.toJSON();
// { title: "Hello", count: 5, ... }
```

#### `getLoroDoc(doc)`

Access the underlying LoroDoc for advanced operations.

```typescript
import { getLoroDoc } from "@loro-extended/change";

const loroDoc = getLoroDoc(doc);
loroDoc.subscribe((event) => console.log("Changed:", event));
```

### $ Namespace (Escape Hatch)

The `$` namespace provides access to meta-operations. While functional helpers are recommended, the `$` namespace is available for advanced use cases:

#### `doc.$.change(mutator)`

Same as `change(doc, mutator)`.

```typescript
doc.$.change((draft) => {
  // Make changes to draft - all commit together
});
```

### Schema Builders

#### `Shape.doc(shape)`

Creates a document schema.

```typescript
const schema = Shape.doc({
  field1: Shape.text(),
  field2: Shape.counter(),
});
```

#### Container Types

- `Shape.text()` - Collaborative text editing
- `Shape.counter()` - Collaborative increment/decrement counters
- `Shape.list(itemSchema)` - Collaborative ordered lists
- `Shape.movableList(itemSchema)` - Collaborative reorderable lists
- `Shape.struct(shape)` - Collaborative structs with fixed keys (uses LoroMap internally)
- `Shape.record(valueSchema)` - Collaborative key-value maps with dynamic string keys
- `Shape.tree(shape)` - Collaborative hierarchical tree structures (Note: incomplete implementation)

#### Value Types

- `Shape.plain.string()` - String values (optionally with literal union types)
- `Shape.plain.number()` - Number values
- `Shape.plain.boolean()` - Boolean values
- `Shape.plain.null()` - Null values
- `Shape.plain.undefined()` - Undefined values
- `Shape.plain.uint8Array()` - Binary data values
- `Shape.plain.struct(shape)` - Struct values with fixed keys
- `Shape.plain.record(valueShape)` - Object values with dynamic string keys
- `Shape.plain.array(itemShape)` - Array values
- `Shape.plain.union(shapes)` - Union of value types (e.g., `string | null`)
- `Shape.plain.discriminatedUnion(key, variants)` - Tagged union types with a discriminant key

#### Nullable Values

Use `.nullable()` on value types to create nullable fields with `null` as the default placeholder:

```typescript
const schema = Shape.doc({
  profile: Shape.struct({
    name: Shape.plain.string().placeholder("Anonymous"),
    email: Shape.plain.string().nullable(), // string | null, defaults to null
    age: Shape.plain.number().nullable(), // number | null, defaults to null
    verified: Shape.plain.boolean().nullable(), // boolean | null, defaults to null
    tags: Shape.plain.array(Shape.plain.string()).nullable(), // string[] | null
    metadata: Shape.plain.record(Shape.plain.string()).nullable(), // Record<string, string> | null
    location: Shape.plain
      .struct({
        // { lat: number, lng: number } | null
        lat: Shape.plain.number(),
        lng: Shape.plain.number(),
      })
      .nullable(),
  }),
});
```

You can chain `.placeholder()` after `.nullable()` to customize the default value:

```typescript
const schema = Shape.doc({
  settings: Shape.struct({
    // Nullable string with custom default
    nickname: Shape.plain.string().nullable().placeholder("Guest"),
  }),
});
```

This is syntactic sugar for the more verbose union pattern:

```typescript
// These are equivalent:
email: Shape.plain.string().nullable();
email: Shape.plain
  .union([Shape.plain.null(), Shape.plain.string()])
  .placeholder(null);
```

### TypedDoc API

With the proxy-based API, schema properties are accessed directly on the doc object, and meta-operations are accessed via the `$` namespace.

#### Direct Schema Access

Access schema properties directly on the doc. Mutations commit immediately (auto-commit mode).

```typescript
// Read values
const title = doc.title.toString();
const count = doc.count.value;

// Mutate directly - commits immediately
doc.title.insert(0, "Hello");
doc.count.increment(5);
doc.users.set("alice", { name: "Alice" });

// Check existence
doc.users.has("alice"); // true
"alice" in doc.users; // true
```

For batched mutations, use `$.change()` instead.

#### `doc.$.toJSON()`

Same as `doc.toJSON`. Returns the full plain JavaScript object representation.

```typescript
const snapshot = doc.$.toJSON();
```

#### `doc.$.rawValue`

Returns raw CRDT state without empty state overlay.

```typescript
const crdtState = doc.$.rawValue;
```

#### `doc.$.loroDoc`

Same as `getLoroDoc(doc)`. Access the underlying LoroDoc.

```typescript
const loroDoc = doc.$.loroDoc;
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

#### Array-like Methods

Lists support familiar JavaScript array methods for filtering and finding items:

```typescript
// Find items (returns mutable draft objects)
const foundItem = draft.todos.find((todo) => todo.completed);
const foundIndex = draft.todos.findIndex((todo) => todo.id === "123");

// Filter items (returns array of mutable draft objects)
const completedTodos = draft.todos.filter((todo) => todo.completed);
const activeTodos = draft.todos.filter((todo) => !todo.completed);

// Transform items (returns plain array, not mutable)
const todoTexts = draft.todos.map((todo) => todo.text);
const todoIds = draft.todos.map((todo) => todo.id);

// Check conditions
const hasCompleted = draft.todos.some((todo) => todo.completed);
const allCompleted = draft.todos.every((todo) => todo.completed);

// Iterate over items
draft.todos.forEach((todo, index) => {
  console.log(`Todo ${index}: ${todo.text}`);
});
```

**Important**: Methods like `find()` and `filter()` return **mutable draft objects** that you can modify directly:

```typescript
change(doc, (draft) => {
  // Find and mutate pattern - very common!
  const todo = draft.todos.find((t) => t.id === "123");
  if (todo) {
    todo.completed = true; // ✅ This mutation will persist!
    todo.text = "Updated text"; // ✅ This too!
  }

  // Filter and modify multiple items
  const activeTodos = draft.todos.filter((t) => !t.completed);
  activeTodos.forEach((todo) => {
    todo.priority = "high"; // ✅ All mutations persist!
  });
});
```

This dual interface ensures predicates work with current data (including previous mutations in the same `change()` block) while returned objects remain mutable.

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

// Access nested values
const value = draft.metadata.get("key");
```

### JSON Serialization and Snapshots

You can easily get a plain JavaScript object snapshot of any part of the document using `JSON.stringify()` or `.toJSON()`. This works for the entire document, nested containers, and even during loading states (placeholders).

```typescript
// Get full document snapshot
const snapshot = doc.$.toJSON();

// Get snapshot of a specific list
const todos = doc.todos.toJSON(); // returns plain array of todos

// Works with nested structures
const metadata = doc.metadata.toJSON(); // returns plain object

// Serialize as JSON
const serializedMetadata = JSON.stringify(doc.metadata); // returns string
```

**Note:** `JSON.stringify()` is recommended for serialization as it handles all data types correctly. `.toJSON()` is available on all `TypedRef` objects and proxied placeholders for convenience when you need a direct object snapshot.

## Type Safety

Full TypeScript support with compile-time validation:

```typescript
import { TypedDoc, Shape, type InferPlainType } from "@loro-extended/change";

// Define your desired interface
interface TodoDoc {
  title: string;
  todos: Array<{ id: string; text: string; done: boolean }>;
}

// Define the schema that matches your interface
const todoSchema = Shape.doc({
  title: Shape.text(),
  todos: Shape.list(
    Shape.plain.struct({
      id: Shape.plain.string(),
      text: Shape.plain.string(),
      done: Shape.plain.boolean(),
    })
  ),
});

// TypeScript will ensure the schema produces the correct type
const doc = createTypedDoc(todoSchema);

// Mutations are type-safe
change(doc, (draft) => {
  draft.title.insert(0, "Hello"); // ✅ Valid - TypeScript knows this is LoroText
  draft.todos.push({
    // ✅ Valid - TypeScript knows the expected shape
    id: "1",
    text: "Learn Loro",
    done: false,
  });

  // draft.title.insert(0, 123);         // ❌ TypeScript error
  // draft.todos.push({ invalid: true }); // ❌ TypeScript error
});

// The result is properly typed as TodoDoc
const result: TodoDoc = doc.toJSON();

// You can also use type assertion to ensure schema compatibility
type SchemaType = InferPlainType<typeof todoSchema>;
const _typeCheck: TodoDoc = {} as SchemaType; // ✅ Will error if types don't match
```

**Note**: Use `Shape.plain.null()` for nullable fields, as Loro treats `null` and `undefined` equivalently.

## Integration with Existing Loro Code

`TypedDoc` works seamlessly with existing Loro applications:

```typescript
import { LoroDoc } from "loro-crdt";
import { createTypedDoc, getLoroDoc } from "@loro-extended/change";

// Wrap existing LoroDoc
const existingDoc = new LoroDoc();
const typedDoc = createTypedDoc(schema, existingDoc);

// Access underlying LoroDoc
const loroDoc = getLoroDoc(typedDoc);

// Use with existing Loro APIs
loroDoc.subscribe((event) => {
  console.log("Document changed:", event);
});
```

## TypedPresence

The `TypedPresence` class provides type-safe access to ephemeral presence data with placeholder defaults:

```typescript
import { TypedPresence, Shape } from "@loro-extended/change";

// Define a presence schema with placeholders
const PresenceSchema = Shape.plain.struct({
  cursor: Shape.plain.struct({
    x: Shape.plain.number(),
    y: Shape.plain.number(),
  }),
  name: Shape.plain.string().placeholder("Anonymous"),
  status: Shape.plain.string().placeholder("online"),
});

// Create typed presence from a PresenceInterface
// (Usually obtained from handle.presence in @loro-extended/repo)
const typedPresence = new TypedPresence(PresenceSchema, presenceInterface);

// Read your presence (with placeholder defaults merged in)
console.log(typedPresence.self);
// { cursor: { x: 0, y: 0 }, name: "Anonymous", status: "online" }

// Set presence values
typedPresence.set({ cursor: { x: 100, y: 200 }, name: "Alice" });

// Read all peers' presence
console.log(typedPresence.all);
// { "peer-1": { cursor: { x: 100, y: 200 }, name: "Alice", status: "online" } }

// Subscribe to presence changes
typedPresence.subscribe(({ self, all }) => {
  console.log("My presence:", self);
  console.log("All peers:", all);
});
```

### PresenceInterface

`TypedPresence` works with any object implementing `PresenceInterface`:

```typescript
import type { PresenceInterface, ObjectValue } from "@loro-extended/change";

interface PresenceInterface {
  set: (values: ObjectValue) => void;
  get: (key: string) => Value;
  readonly self: ObjectValue;
  readonly all: Record<string, ObjectValue>;
  setRaw: (key: string, value: Value) => void;
  subscribe: (cb: (values: ObjectValue) => void) => () => void;
}
```

This is typically provided by `UntypedDocHandle.presence` in `@loro-extended/repo`.

## Performance Considerations

- All changes within a `change()` call are batched into a single transaction
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
