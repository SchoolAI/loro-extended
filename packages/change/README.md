# @loro-extended/change

A schema-driven, type-safe wrapper for [Loro CRDT](https://github.com/loro-dev/loro) that provides natural JavaScript syntax for collaborative document editing. Build local-first applications with intuitive APIs while maintaining full CRDT capabilities.

## What is Loro?

[Loro](https://github.com/loro-dev/loro) is a high-performance CRDT (Conflict-free Replicated Data Type) library that enables real-time collaborative editing without conflicts. It's perfect for building local-first applications like collaborative editors, task managers, and (turn-based) multiplayer games.

## Why Use `change`?

Working with Loro directly involves somewhat verbose container operations and complex type management. The `change` package provides:

- **Schema-First Design**: Define your document structure with type-safe schemas
- **Natural Syntax**: Write `doc.title.insert(0, "Hello")` instead of verbose CRDT operations
- **Placeholders**: Seamlessly blend default values with CRDT state
- **Full Type Safety**: Complete TypeScript support with compile-time validation
- **Transactional Changes**: All mutations within a `change()` block are atomic
- **Loro Compatible**: Works seamlessly with existing Loro code (`loro(doc)` returns the familiar `LoroDoc`)

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
    }),
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
change(doc, (draft) => {
  draft.title.insert(0, "Change: ");
  draft.count.increment(10);
  draft.users.set("bob", { name: "Bob" });
});
// All changes commit as one transaction

// Get JSON snapshot
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
  viewCount: Shape.counter(), // Collaborative increment/decrement counter

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
    }),
  ),
});
```

**NOTE:** Use `Shape.*` for collaborative containers and `Shape.plain.*` for plain values. Only put plain values inside Loro containers - a Loro container inside a plain JS struct or array won't work.

### Placeholders (Empty State Overlay)

Placeholders provide default values that are merged when CRDT containers are empty, ensuring the entire document remains type-safe even before any data has been written.

#### Why placeholders matter in distributed systems:

In traditional client-server architectures, you typically have a single source of truth that initializes default values. But in CRDTs, multiple peers can start working independently without coordination. This creates a challenge: who initializes the defaults?

Placeholders solve this elegantly:

- No initialization race conditions - Every peer sees the same defaults without needing to coordinate who writes them first
- Zero-cost defaults - Placeholders aren't stored in the CRDT; they're computed on read. This means no wasted storage or sync bandwidth for default values
- Conflict-free - Since placeholders aren't written to the CRDT, there's no possibility of conflicts between peers trying to initialize the same field
- Lazy materialization - Defaults only become "real" CRDT data when a peer explicitly modifies them

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
    }),
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

You can access and write schema properties directly on a TypedDoc. Mutations commit immediately by default:

```typescript
// Direct mutations - each commits immediately
doc.title.insert(0, "📝");
doc.viewCount.increment(1);
doc.tags.push("typescript");
```

For batched operations (better performance, atomic undo), use `change()`:

```typescript
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

  // Struct operations (use .set() on PlainValueRef)
  draft.metadata.author.set("John Doe");
  draft.metadata.featured.set(false);

  // Movable list operations
  draft.sections.push({
    heading: "Introduction",
    content: "Welcome to my blog...",
    order: 1,
  });
  draft.sections.move(0, 1); // Reorder sections
});

// All changes are committed atomically as one transaction
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
| Encapsulated ref operations       | Ref-level: `change(ref, d => {...})` |

### Ref-Level `change()` for Encapsulation

The `change()` function also works on individual refs (ListRef, TextRef, TreeRef, etc.), enabling better encapsulation when you want to pass refs around without exposing the entire document:

```typescript
import { change } from "@loro-extended/change";

// Library code - expose only the ref, not the doc
class StateMachine {
  private doc: TypedDoc<...>;

  get states(): TreeRef<StateNodeShape> {
    return this.doc.states;
  }
}

// User code - works with just the ref
function addStates(states: TreeRef<StateNodeShape>) {
  change(states, draft => {
    const idle = draft.createNode();
    idle.data.name.insert(0, "idle");

    const running = draft.createNode();
    running.data.name.insert(0, "running");
  });
}

// Usage
const machine = new StateMachine();
addStates(machine.states); // No access to the underlying doc needed!
```

This pattern is useful for:

- **Library APIs**: Expose typed refs without leaking document structure
- **Component isolation**: Pass refs to components that only need partial access
- **Testing**: Mock or stub individual refs without full document setup

All ref types support `change()`:

```typescript
// ListRef
change(doc.items, (draft) => {
  draft.push("item1");
  draft.push("item2");
});

// TextRef
change(doc.title, (draft) => {
  draft.insert(0, "Hello ");
  draft.insert(6, "World");
});

// CounterRef
change(doc.count, (draft) => {
  draft.increment(5);
  draft.decrement(2);
});

// StructRef
change(doc.profile, (draft) => {
  draft.bio.insert(0, "Hello");
  draft.age.increment(1);
});

// RecordRef
change(doc.users, (draft) => {
  draft.set("alice", { name: "Alice" });
  draft.set("bob", { name: "Bob" });
});

// TreeRef
change(doc.tree, (draft) => {
  const node = draft.createNode();
  node.data.name.insert(0, "root");
});
```

Nested `change()` calls are safe - Loro's commit is idempotent:

```typescript
change(doc.items, (outer) => {
  outer.push("from outer");

  // Nested change on a different ref - works correctly
  change(doc.count, (inner) => {
    inner.increment(10);
  });

  outer.push("still in outer");
});
// All mutations are committed
```

## Advanced Usage

### Discriminated Unions

For type-safe tagged unions (like different message types or presence states), use `Shape.plain.discriminatedUnion()`:

```typescript
import { Shape } from "@loro-extended/change";

// Define variant shapes - each must have the discriminant key
const ClientPresenceShape = Shape.plain.struct({
  type: Shape.plain.string("client"), // Literal type for discrimination
  name: Shape.plain.string().placeholder("Anonymous"),
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
    }),
  ),
  tick: Shape.plain.number(),
});

// Create the discriminated union
const GamePresenceSchema = Shape.plain.discriminatedUnion("type", {
  client: ClientPresenceShape,
  server: ServerPresenceShape,
});

// Type-safe handling based on discriminant
function handlePresence(presence: Infer<typeof GamePresenceSchema>) {
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

- The discriminant (e.g., `"type"`) determines which variant shape to use
- Use `.placeholder()` on fields to provide defaults (placeholders are applied automatically)
- Works seamlessly with `@loro-extended/repo`'s presence system
- Full TypeScript support for discriminated union types

### Untyped Integration with External Libraries

When integrating with external libraries that manage their own document structure (like `loro-prosemirror`), you may want typed presence but untyped document content. Use `Shape.any()` as an escape hatch:

```typescript
import { Shape } from "@loro-extended/change";

// Fully typed presence with binary cursor data
const CursorPresenceSchema = Shape.plain.struct({
  anchor: Shape.plain.bytes().nullable(), // Uint8Array | null
  focus: Shape.plain.bytes().nullable(),
  user: Shape.plain
    .struct({
      name: Shape.plain.string(),
      color: Shape.plain.string(),
    })
    .nullable(),
});

// With @loro-extended/repo:

// Shape.any() in a container - one container is untyped
const ProseMirrorDocShape = Shape.doc({
  doc: Shape.any(), // loro-prosemirror manages this
  metadata: Shape.struct({
    // But we can still have typed containers
    title: Shape.text(),
  }),
});
const handle2 = repo.get(docId, ProseMirrorDocShape, {
  presence: CursorPresenceSchema,
});
handle2.doc.toJSON(); // { doc: unknown, metadata: { title: string } }
```

**Key features:**

- `Shape.any()` creates an `AnyContainerShape` - type inference produces `unknown`
- `Shape.plain.any()` creates an `AnyValueShape` - type inference produces Loro's `Value` type
- `Shape.plain.bytes()` is an alias for `Shape.plain.uint8Array()` for better discoverability
- All support `.nullable()` for optional values

**When to use:**

| Scenario                                 | Shape to Use                                                 |
| ---------------------------------------- | ------------------------------------------------------------ |
| External library manages entire document | `repo.get(docId, Shape.any(), { presence: presenceSchema })` |
| External library manages one container   | `Shape.doc({ doc: Shape.any(), ... })`                       |
| Flexible metadata in presence            | `Shape.plain.any()` for dynamic values                       |
| Binary cursor/selection data             | `Shape.plain.bytes().nullable()` for `Uint8Array` \| `null`  |
| Full type safety                         | Use specific shapes like `Shape.struct()`, `Shape.text()`    |

### Nested Structures

Handle complex nested documents with ease:

```typescript
const complexSchema = Shape.doc({
  article: Shape.struct({
    title: Shape.text(),
    metadata: Shape.struct({
      views: Shape.counter(),
      author: Shape.struct({
        name: Shape.plain.string().placeholder("Anonymous"),
        email: Shape.plain.string(),
      }),
    }),
  }),
});

const doc = createTypedDoc(complexSchema);

change(doc, (draft) => {
  draft.article.title.insert(0, "Deep Nesting Example");
  draft.article.metadata.views.increment(5);
  draft.article.metadata.author.name.set("Alice");
  draft.article.metadata.author.email.set("alice@example.com");
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
  // Set individual values using .set()
  draft.settings.theme.set("dark");
  draft.settings.collapsed.set(true);
  draft.settings.width.set(250);
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
  draft.articles[0]?.title.insert(0, "✨ ");
  draft.articles[0]?.tags.push("real-time");
});
```

## Path Selector DSL

The `@loro-extended/change` package exports a type-safe path selector DSL for building (a subset of) JSONPath expressions with full TypeScript type inference. This is primarily used by `handle.subscribe()` in `@loro-extended/repo` for efficient, type-safe subscriptions:

```typescript
// In @loro-extended/repo, use with Handle.subscribe():
handle.subscribe(
  (p) => p.books.$each.title, // Type-safe path selector
  (titles, prev) => {
    // titles: string[], prev: string[] | undefined
    console.log("Titles changed:", titles);
  },
);

// DSL constructs:
// p.config.theme        - Property access
// p.books.$each         - All items in list/record
// p.books.$at(0)        - Item at index (supports negative: -1 = last)
// p.books.$first        - First item (alias for $at(0))
// p.books.$last         - Last item (alias for $at(-1))
// p.users.$key("alice") - Record value by key
```

See `@loro-extended/repo` documentation for full details on `Handle.subscribe()`.

## API Reference

### Core Functions

#### `createTypedDoc<T>(schema, options?)`

Creates a new typed Loro document. This is the recommended way to create documents.

```typescript
import { createTypedDoc, Shape } from "@loro-extended/change";

const doc = createTypedDoc(schema);
const docFromExisting = createTypedDoc(schema, { doc: existingLoroDoc });
```

**Options:**

| Option           | Type        | Default | Description                                                    |
| ---------------- | ----------- | ------- | -------------------------------------------------------------- |
| `doc`            | `LoroDoc`   | —       | Wrap an existing LoroDoc instead of creating a new one         |
| `mergeable`      | `boolean`   | `false` | Store containers at root with path-based names for deterministic IDs |
| `skipInitialize` | `boolean`   | `false` | Skip automatic metadata initialization (for synced documents)  |

#### `change(target, fn, options?)`

The primary mutation API. Batches multiple mutations into a single transaction. Works with TypedDoc and all ref types. Returns the target for chaining.

```typescript
import { change } from "@loro-extended/change";

// Document-level
change(doc, (draft) => {
  draft.count.increment(10);
  draft.title.update("Hello");
});

// Ref-level
change(doc.items, (draft) => {
  draft.push("item1");
});

// With commit message
change(doc, (draft) => {
  draft.count.increment(10);
}, { commitMessage: { userId: "alice" } });
```

**Options:**

| Option          | Type               | Description                                              |
| --------------- | ------------------ | -------------------------------------------------------- |
| `commitMessage` | `string \| object` | Metadata attached to the commit (objects are JSON-serialized) |

### The `loro()` Function

The `loro()` function returns the **native Loro type** directly from any TypedDoc or ref. Use it when you need to access the underlying Loro API.

```typescript
import { loro } from "@loro-extended/change";

// Returns native Loro types directly
const loroDoc = loro(doc);           // LoroDoc
const loroText = loro(doc.title);    // LoroText
const loroList = loro(doc.items);    // LoroList
const loroMap = loro(doc.settings);  // LoroMap (for struct or record)
const loroCounter = loro(doc.count); // LoroCounter
const loroTree = loro(doc.states);   // LoroTree

// Call native Loro methods directly
loroDoc.frontiers();
loroDoc.peerId;
loroDoc.subscribe(callback);

loroText.length;
loroText.toString();
```

### The `subscribe()` Function

The `subscribe()` function is the recommended way to listen to document and container changes. It supports three modes:

```typescript
import { subscribe, loro } from "@loro-extended/change";

// 1. Whole document subscription
const unsubscribe = subscribe(doc, (event) => {
  console.log("Document changed:", event.by); // "local" | "import" | "checkout"
});

// 2. Ref-level subscription (specific container)
const unsubscribe = subscribe(doc.title, (event) => {
  console.log("Title changed");
});

// 3. Path-selector subscription (type-safe, fine-grained)
const unsubscribe = subscribe(doc, p => p.config.theme, (theme) => {
  console.log("Theme changed to:", theme);
});

// For native Loro access, use loro().subscribe() directly:
loro(doc).subscribe(callback);      // LoroDoc subscription
loro(doc.title).subscribe(callback); // LoroText subscription
```

### The `ext()` Function

The `ext()` function provides access to **loro-extended-specific features** that go beyond native Loro. Use it for forking and accessing document metadata.

```typescript
import { ext } from "@loro-extended/change";

// Document-level features
ext(doc).fork();                     // Fork the document
ext(doc).forkAt(frontiers);          // Fork at a specific version
ext(doc).shallowForkAt(frontiers);   // Fork with shallow snapshot
ext(doc).applyPatch(patch);          // Apply JSON Patch operations
ext(doc).docShape;                   // Access the schema
ext(doc).rawValue;                   // CRDT state without placeholders
ext(doc).mergeable;                  // Whether doc uses mergeable storage
ext(doc).initialize();               // Write metadata (if skipInitialize was used)

// Ref-level features
ext(ref).doc;                        // Get LoroDoc from any ref
ext(list).pushContainer(container);  // Push a pre-existing Loro container
ext(list).insertContainer(i, c);     // Insert a pre-existing Loro container
ext(struct).setContainer("key", c);  // Set a pre-existing Loro container
ext(record).setContainer("key", c);  // Set a pre-existing Loro container
```

#### API Surface by Ref Type

**ListRef / MovableListRef**

| Direct Access          | Via `loro()` (native)               | Via `ext()` (extended)              |
| ---------------------- | ----------------------------------- | ----------------------------------- |
| `push(item)`           | Native `LoroList` / `LoroMovableList` methods | `pushContainer(container)`          |
| `insert(index, item)`  |                                     | `insertContainer(index, container)` |
| `delete(index, len)`   |                                     | `doc`                               |
| `find(predicate)`      |                                     |                                     |
| `filter(predicate)`    |                                     |                                     |
| `map(callback)`        |                                     |                                     |
| `forEach(callback)`    |                                     |                                     |
| `some(predicate)`      |                                     |                                     |
| `every(predicate)`     |                                     |                                     |
| `slice(start, end)`    |                                     |                                     |
| `findIndex(predicate)` |                                     |                                     |
| `length`, `[index]`    |                                     |                                     |
| `toJSON()`             |                                     |                                     |

**StructRef**

| Direct Access                | Via `loro()` (native)    | Via `ext()` (extended)         |
| ---------------------------- | ------------------------ | ------------------------------ |
| `obj.property` (get)         | Native `LoroMap` methods | `setContainer(key, container)` |
| `obj.property = value` (set) |                          | `doc`                          |
| `Object.keys(obj)`           |                          |                                |
| `'key' in obj`               |                          |                                |
| `delete obj.key`             |                          |                                |
| `toJSON()`                   |                          |                                |

**RecordRef** (Map-like interface)

| Direct Access                     | Via `loro()` (native)    | Via `ext()` (extended)         |
| --------------------------------- | ------------------------ | ------------------------------ |
| `get(key)`                        | Native `LoroMap` methods | `setContainer(key, container)` |
| `set(key, value)`                 |                          | `doc`                          |
| `delete(key)`                     |                          |                                |
| `has(key)`                        |                          |                                |
| `keys()`, `values()`, `entries()` |                          |                                |
| `size`                            |                          |                                |
| `replace(values)`                 |                          |                                |
| `merge(values)`                   |                          |                                |
| `clear()`                         |                          |                                |
| `toJSON()`                        |                          |                                |

**TextRef**

| Direct Access                    | Via `loro()` (native)    | Via `ext()` (extended)  |
| -------------------------------- | ------------------------ | ----------------------- |
| `insert(index, content)`         | Native `LoroText` methods | `doc`                   |
| `delete(index, len)`             |                          |                         |
| `update(text)`                   |                          |                         |
| `mark(range, key, value)`        |                          |                         |
| `unmark(range, key)`             |                          |                         |
| `toDelta()`, `applyDelta(delta)` |                          |                         |
| `toString()`, `valueOf()`        |                          |                         |
| `length`, `toJSON()`             |                          |                         |

**CounterRef**

| Direct Access        | Via `loro()` (native)       | Via `ext()` (extended) |
| -------------------- | --------------------------- | ---------------------- |
| `increment(value)`   | Native `LoroCounter` methods | `doc`                  |
| `decrement(value)`   |                             |                        |
| `value`, `valueOf()` |                             |                        |
| `toJSON()`           |                             |                        |

**TypedDoc**

| Direct Access                  | Via `loro()` (native)  | Via `ext()` (extended)  |
| ------------------------------ | ---------------------- | ----------------------- |
| `doc.property` (schema access) | Native `LoroDoc` methods | `fork()`, `forkAt()`  |
| `toJSON()`                     | `subscribe(callback)`  | `applyPatch(patch)`     |
|                                |                        | `docShape`, `rawValue`  |

### Subscribing to Ref Changes

Use the `subscribe()` helper to subscribe to container-level changes:

```typescript
import { subscribe } from "@loro-extended/change";

function TextEditor({ textRef }: { textRef: TextRef }) {
  useEffect(() => {
    return subscribe(textRef, (event) => {
      // Handle text changes
    });
  }, [textRef]);

  return <div>...</div>;
}
```

### Subscribing to Document Transitions

Use `getTransition()` to build `{ before, after }` TypedDocs from a
subscription event using the diff overlay (no checkout or fork required):

```typescript
import { getTransition, loro } from "@loro-extended/change";

// loro(doc) returns a LoroDoc — call subscribe on it directly
const unsubscribe = loro(doc).subscribe((event) => {
  if (event.by === "checkout") return;

  const { before, after } = getTransition(doc, event);

  if (!before.users.has("alice") && after.users.has("alice")) {
    console.log("Alice just joined");
  }
});
```

### Schema Builders

#### `Shape.doc(shape, options?)`

Creates a document schema.

```typescript
const schema = Shape.doc({
  field1: Shape.text(),
  field2: Shape.counter(),
});

// With mergeable storage for deterministic container IDs
const mergeableSchema = Shape.doc({
  players: Shape.record(Shape.struct({ score: Shape.plain.number() })),
}, { mergeable: true });
```

#### Container Types

- `Shape.text()` - Collaborative text editing
- `Shape.counter()` - Collaborative increment/decrement counters
- `Shape.list(itemSchema)` - Collaborative ordered lists
- `Shape.movableList(itemSchema)` - Collaborative reorderable lists
- `Shape.struct(shape)` - Collaborative structs with fixed keys (uses LoroMap internally)
- `Shape.record(valueSchema)` - Collaborative key-value maps with dynamic string keys
- `Shape.tree(dataShape)` - Collaborative hierarchical tree structures with typed node metadata
- `Shape.any()` - Escape hatch for untyped containers (see [Untyped Integration](#untyped-integration-with-external-libraries))

#### Value Types

- `Shape.plain.string()` - String values (optionally with literal union types)
- `Shape.plain.number()` - Number values
- `Shape.plain.boolean()` - Boolean values
- `Shape.plain.null()` - Null values
- `Shape.plain.undefined()` - Undefined values
- `Shape.plain.uint8Array()` - Binary data values
- `Shape.plain.bytes()` - Alias for `uint8Array()` for better discoverability
- `Shape.plain.struct(shape)` - Struct values with fixed keys
- `Shape.plain.record(valueShape)` - Object values with dynamic string keys
- `Shape.plain.array(itemShape)` - Array values
- `Shape.plain.union(shapes)` - Union of value types (e.g., `string | null`)
- `Shape.plain.discriminatedUnion(key, variants)` - Tagged union types with a discriminant key
- `Shape.plain.any()` - Escape hatch for untyped values (see [Untyped Integration](#untyped-integration-with-external-libraries))

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

With the proxy-based API, schema properties are accessed directly on the doc object, and CRDT internals are accessed via `loro()` and `ext()`.

#### Direct Schema Access

Access schema properties directly on the doc. Mutations commit immediately (auto-commit mode).

```typescript
// Read values
const title = doc.title.toString();
const count = doc.count;

// Mutate directly - commits immediately
doc.title.insert(0, "Hello");
doc.count.increment(5);
doc.users.set("alice", { name: "Alice" });

// Check existence
doc.users.has("alice"); // true
"alice" in doc.users; // true
```

For batched mutations, use `change(doc, fn)`.

#### `doc.toJSON()`

Returns the full plain JavaScript object representation.

```typescript
const snapshot = doc.toJSON();
```

#### `ext(doc).rawValue`

Returns raw CRDT state without placeholders (empty state overlay).

```typescript
import { ext } from "@loro-extended/change";
const crdtState = ext(doc).rawValue;
```

#### `loro(doc)` — Access the underlying LoroDoc

Returns the native `LoroDoc` directly.

```typescript
import { loro } from "@loro-extended/change";
const loroDoc = loro(doc); // LoroDoc instance
loroDoc.frontiers();
loroDoc.peerId;
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
const current = draft.count.get();
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

Methods like `find()` and `filter()` return **mutable draft objects** that you can modify directly:

```typescript
change(doc, (draft) => {
  // Find and mutate pattern - very common!
  const todo = draft.todos.find((t) => t.id.get() === "123");
  if (todo) {
    todo.completed.set(true); // ✅ This mutation will persist!
    todo.text.set("Updated text"); // ✅ This too!
  }

  // Filter and modify multiple items
  const activeTodos = draft.todos.filter((t) => !t.completed.get());
  activeTodos.forEach((todo) => {
    todo.priority.set("high"); // ✅ All mutations persist!
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

### Record Bulk Update Operations

Records support bulk update methods for efficient batch operations:

```typescript
// Replace entire contents - keys not in the new object are removed
draft.players.replace({
  alice: { name: "Alice", score: 100 },
  bob: { name: "Bob", score: 50 },
});
// Result: only alice and bob exist, any previous entries are removed

// Merge values - existing keys not in the new object are kept
draft.scores.merge({
  alice: 150, // updates alice
  charlie: 25, // adds charlie
});
// Result: alice=150, bob=50 (unchanged), charlie=25

// Clear all entries
draft.history.clear();
// Result: empty record
```

**Method semantics:**

| Method            | Adds new | Updates existing | Removes absent |
| ----------------- | -------- | ---------------- | -------------- |
| `replace(values)` | ✅       | ✅               | ✅             |
| `merge(values)`   | ✅       | ✅               | ❌             |
| `clear()`         | ❌       | ❌               | ✅ (all)       |

These methods batch all operations into a single commit, avoiding multiple subscription notifications.

### Tree Operations

Trees are hierarchical structures where each node has typed metadata. Perfect for state machines, file systems, org charts, and nested data.

```typescript
// Define node data shape
const StateNodeDataShape = Shape.struct({
  name: Shape.text(),
  facts: Shape.record(Shape.plain.any()),
  rules: Shape.list(
    Shape.plain.struct({
      name: Shape.plain.string(),
      rego: Shape.plain.string(),
      description: Shape.plain.string().nullable(),
    }),
  ),
});

const schema = Shape.doc({
  states: Shape.tree(StateNodeDataShape),
});

const doc = createTypedDoc(schema);

change(doc, (draft) => {
  // Create root nodes
  const idle = draft.states.createNode();
  idle.data.name.insert(0, "idle");

  const running = draft.states.createNode();
  running.data.name.insert(0, "running");

  // Create child nodes
  const processing = idle.createNode();
  processing.data.name.insert(0, "processing");

  // Access typed node data
  processing.data.rules.push({
    name: "validate",
    rego: "package validate",
    description: null,
  });

  // Navigate the tree
  const parent = processing.parent(); // Returns idle node
  const children = idle.children(); // Returns [processing]

  // Move nodes between parents
  processing.move(running); // Move to different parent
  processing.move(); // Move to root (no parent)

  // Query the tree
  const roots = draft.states.roots(); // All root nodes
  const allNodes = draft.states.nodes(); // All nodes (flat)
  const node = draft.states.getNodeByID(idle.id); // Find by ID
  const exists = draft.states.has(idle.id); // Check existence

  // Delete nodes (and all descendants)
  draft.states.delete(running);

  // Enable fractional indexing for ordering
  draft.states.enableFractionalIndex(8);
  const index = idle.index(); // Position among siblings
  const fractionalIndex = idle.fractionalIndex(); // Fractional index string
});

// Serialize to JSON (nested structure)
const json = doc.toJSON();
// {
//   states: [{
//     id: "0@123",
//     parent: null,
//     index: 0,
//     fractionalIndex: "80",
//     data: { name: "idle", facts: {}, rules: [] },
//     children: [...]
//   }]
// }

// Get flat array representation
change(doc, (draft) => {
  const flatArray = draft.states.toArray();
  // [{ id, parent, index, fractionalIndex, data }, ...]
});
```

**Tree Node Properties:**

- `node.id` - Unique TreeID for the node
- `node.data` - Typed StructRef for node metadata (access like `node.data.name`)
- `node.parent()` - Get parent node (or undefined for roots)
- `node.children()` - Get child nodes in order
- `node.index()` - Position among siblings
- `node.fractionalIndex()` - Fractional index string for ordering
- `node.isDeleted()` - Check if node has been deleted

**Tree Node Methods:**

- `node.createNode(initialData?, index?)` - Create child node
- `node.move(newParent?, index?)` - Move to new parent (undefined = root)
- `node.moveAfter(sibling)` - Move after sibling
- `node.moveBefore(sibling)` - Move before sibling

**TreeRef Methods:**

- `tree.createNode(initialData?)` - Create root node
- `tree.roots()` - Get all root nodes
- `tree.nodes()` - Get all nodes (flat)
- `tree.getNodeByID(id)` - Find node by TreeID
- `tree.has(id)` - Check if node exists
- `tree.delete(target)` - Delete node and descendants
- `tree.enableFractionalIndex(jitter?)` - Enable ordering
- `tree.toJSON()` - Nested JSON structure
- `tree.toArray()` - Flat array representation

### JSON Serialization and Snapshots

You can easily get a plain JavaScript object snapshot of any part of the document using `JSON.stringify()` or `.toJSON()`. This works for the entire document, nested containers, and even during loading states (placeholders).

```typescript
// Get full document snapshot
const snapshot = doc.toJSON();

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
import { TypedDoc, Shape, type Infer } from "@loro-extended/change";

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
    }),
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
type SchemaType = Infer<typeof todoSchema>;
const _typeCheck: TodoDoc = {} as SchemaType; // ✅ Will error if types don't match
```

**Note**: Use `Shape.plain.null()` for nullable fields, as Loro treats `null` and `undefined` equivalently.

## Integration with Existing Loro Code

`TypedDoc` works seamlessly with existing Loro applications:

```typescript
import { LoroDoc } from "loro-crdt";
import { createTypedDoc, loro } from "@loro-extended/change";

// Wrap existing LoroDoc
const existingDoc = new LoroDoc();
const typedDoc = createTypedDoc(schema, { doc: existingDoc });

// Access underlying LoroDoc
const loroDoc = loro(typedDoc); // returns the LoroDoc directly

// Use with existing Loro APIs
loroDoc.subscribe((event) => {
  console.log("Document changed:", event);
});
```

## TypedEphemeral (Presence)

The `TypedEphemeral` interface in `@loro-extended/repo` provides type-safe access to ephemeral presence data with placeholder defaults. Define your presence schema and use it with `repo.get()`:

```typescript
import { Shape } from "@loro-extended/change";

// Define a presence schema with placeholders
const PresenceSchema = Shape.plain.struct({
  cursor: Shape.plain.struct({
    x: Shape.plain.number(),
    y: Shape.plain.number(),
  }),
  name: Shape.plain.string().placeholder("Anonymous"),
  status: Shape.plain.string().placeholder("online"),
});

// Use with @loro-extended/repo
const handle = repo.get("doc-id", DocSchema, { presence: PresenceSchema });

// Read your presence (with placeholder defaults merged in)
console.log(handle.presence.self);
// { cursor: { x: 0, y: 0 }, name: "Anonymous", status: "online" }

// Set presence values
handle.presence.setSelf({ cursor: { x: 100, y: 200 }, name: "Alice" });

// Read other peers' presence
for (const [peerId, presence] of handle.presence.peers) {
  console.log(`${peerId}: ${presence.name}`);
}

// Subscribe to presence changes
handle.presence.subscribe(({ key, value, source }) => {
  console.log(`Peer ${key} updated:`, value);
});
```

See `@loro-extended/repo` documentation for full details on the `TypedEphemeral` interface.

## Performance Considerations

- All changes within a `change()` call are batched into a single transaction
- Empty state overlay is computed on-demand, not stored
- Container creation is lazy - containers are only created when accessed
- Type validation occurs at development time, not runtime

## Contributing

This package is part of the loro-extended ecosystem. Contributions welcome!

- **Build**: `pnpm build`
- **Test**: `pnpm test`
- **Lint**: `pnpm check`

## License

MIT
