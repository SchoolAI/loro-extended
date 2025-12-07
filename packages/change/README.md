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
- **Loro Compatible**: Works seamlessly with existing Loro code (`typedDoc.loroDoc` is a familiar `LoroDoc`)

## Installation

```bash
npm install @loro-extended/change loro-crdt
# or
pnpm add @loro-extended/change loro-crdt
```

## Quick Start

```typescript
import { TypedDoc, Shape } from "@loro-extended/change";

// Define your document schema
const schema = Shape.doc({
  title: Shape.text().placeholder("My Todo List"),
  todos: Shape.list(
    Shape.plain.object({
      id: Shape.plain.string(),
      text: Shape.plain.string(),
      completed: Shape.plain.boolean(),
    })
  ),
});

// Create a typed document
const doc = new TypedDoc(schema);

// Make changes with natural syntax
const result = doc.change((draft) => {
  draft.title.insert(0, "📝 Todo");
  draft.todos.push({
    id: "1",
    text: "Learn Loro",
    completed: false,
  });
});

console.log(result);
// { title: "📝 Todo", todos: [{ id: "1", text: "Learn Loro", completed: false }] }
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

  // Maps for structured data
  metadata: Shape.map({
    author: Shape.plain.string(), // Plain values (POJOs)
    publishedAt: Shape.plain.string(), // ISO date string
    featured: Shape.plain.boolean(),
  }),

  // Movable lists for reorderable content
  sections: Shape.movableList(
    Shape.map({
      heading: Shape.text(), // Collaborative headings
      content: Shape.text(), // Collaborative content
      order: Shape.plain.number(), // Plain metadata
    })
  ),
});
```

**NOTE:** Use `Shape.*` for collaborative containers and `Shape.plain.*` for plain values. Only put plain values inside Loro containers - a Loro container inside a plain JS object or array won't work.

### Empty State Overlay

Empty state provides default values that are merged when CRDT containers are empty, keeping the whole document typesafe:

```typescript
// Use .placeholder() to set default values
const blogSchemaWithDefaults = Shape.doc({
  title: Shape.text().placeholder("Untitled Document"),
  viewCount: Shape.counter(), // defaults to 0
  tags: Shape.list(Shape.plain.string()), // defaults to []
  metadata: Shape.map({
    author: Shape.plain.string().placeholder("Anonymous"),
    publishedAt: Shape.plain.string(), // defaults to ""
    featured: Shape.plain.boolean(), // defaults to false
  }),
  sections: Shape.movableList(
    Shape.map({
      heading: Shape.text(),
      content: Shape.text(),
      order: Shape.plain.number(),
    })
  ),
});

const doc = new TypedDoc(blogSchemaWithDefaults);

// Initially returns empty state
console.log(doc.value);
// { title: "Untitled Document", viewCount: 0, ... }

// After changes, CRDT values take priority over empty state
doc.change((draft) => {
  draft.title.insert(0, "My Blog Post");
  draft.viewCount.increment(10);
});

console.log(doc.value);
// { title: "My Blog Post",  viewCount: 10,  tags: [], ... }
//   ↑ CRDT value            ↑ CRDT value    ↑ empty state preserved
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

### Discriminated Unions

For type-safe tagged unions (like different message types or presence states), use `Shape.plain.discriminatedUnion()`:

```typescript
import { Shape, mergeValue } from "@loro-extended/change";

// Define variant shapes - each must have the discriminant key
const ClientPresenceShape = Shape.plain.object({
  type: Shape.plain.string("client"), // Literal type for discrimination
  name: Shape.plain.string(),
  input: Shape.plain.object({
    force: Shape.plain.number(),
    angle: Shape.plain.number(),
  }),
});

const ServerPresenceShape = Shape.plain.object({
  type: Shape.plain.string("server"), // Literal type for discrimination
  cars: Shape.plain.record(
    Shape.plain.object({
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
  article: Shape.map({
    title: Shape.text(),
    metadata: Shape.map({
      views: Shape.counter(),
      author: Shape.map({
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

const doc = new TypedDoc(complexSchema, emptyState);

doc.change((draft) => {
  draft.article.title.insert(0, "Deep Nesting Example");
  draft.article.metadata.views.increment(5);
  draft.article.metadata.author.name = "Alice"; // plain string update is captured and applied after closure
  draft.article.metadata.author.email = "alice@example.com"; // same here
});
```

### Map Operations

For map containers, use the standard map methods:

```typescript
const schema = Shape.doc({
  settings: Shape.map({
    theme: Shape.plain.string(),
    collapsed: Shape.plain.boolean(),
    width: Shape.plain.number(),
  }),
});

doc.change((draft) => {
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
    Shape.map({
      title: Shape.text(), // Collaborative title
      content: Shape.text(), // Collaborative content
      tags: Shape.list(Shape.plain.string()), // Collaborative tag list
      metadata: Shape.plain.object({
        // Static metadata
        authorId: Shape.plain.string(),
        publishedAt: Shape.plain.string(),
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
      publishedAt: new Date().toISOString(),
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

#### `new TypedDoc<T>(schema, existingDoc?)`

Creates a new typed Loro document.

```typescript
const doc = new TypedDoc(schema);
const docFromExisting = new TypedDoc(schema, existingLoroDoc);
```

#### `doc.change(mutator)`

Applies transactional changes to a document.

```typescript
const result = doc.change((draft) => {
  // Make changes to draft
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
- `Shape.map(shape)` - Collaborative key-value maps with fixed keys
- `Shape.record(valueSchema)` - Collaborative key-value maps with dynamic string keys
- `Shape.tree(shape)` - Collaborative hierarchical tree structures (Note: incomplete implementation)

#### Value Types

- `Shape.plain.string()` - String values (optionally with literal union types)
- `Shape.plain.number()` - Number values
- `Shape.plain.boolean()` - Boolean values
- `Shape.plain.null()` - Null values
- `Shape.plain.undefined()` - Undefined values
- `Shape.plain.uint8Array()` - Binary data values
- `Shape.plain.object(shape)` - Object values with fixed keys
- `Shape.plain.record(valueShape)` - Object values with dynamic string keys
- `Shape.plain.array(itemShape)` - Array values
- `Shape.plain.union(shapes)` - Union of value types (e.g., `string | null`)
- `Shape.plain.discriminatedUnion(key, variants)` - Tagged union types with a discriminant key

### TypedDoc Methods

#### `.value`

Returns the current document state with empty state overlay.

```typescript
const currentState = doc.value;
```

This overlays "empty state" defaults with CRDT values, returning a JSON object with full type information (from your schema).

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

You may need this when interfacing with other libraries, such as `loro-dev/loro-prosemirror`.

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
doc.change((draft) => {
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
    Shape.plain.object({
      id: Shape.plain.string(),
      text: Shape.plain.string(),
      done: Shape.plain.boolean(),
    })
  ),
});

// TypeScript will ensure the schema produces the correct type
const doc = new TypedDoc(todoSchema);

// The result will be properly typed as TodoDoc
const result: TodoDoc = doc.change((draft) => {
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

// You can also use type assertion to ensure schema compatibility
type SchemaType = InferPlainType<typeof todoSchema>;
const _typeCheck: TodoDoc = {} as SchemaType; // ✅ Will error if types don't match
```

**Note**: Use `Shape.plain.null()` for nullable fields, as Loro treats `null` and `undefined` equivalently.

## Integration with Existing Loro Code

`TypedDoc` works seamlessly with existing Loro applications:

```typescript
import { LoroDoc } from "loro-crdt";

// Wrap existing LoroDoc
const existingDoc = new LoroDoc();
const typedDoc = new TypedDoc(schema, existingDoc);

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
