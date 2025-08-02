# Loro Change

Provides a simple, Immer-style `change()` method for mutating [Loro](https://github.com/loro-dev/loro) docs and plain JavaScript objects. This utility simplifies state updates, making them more declarative and easier to read, similar to the experience in libraries like Automerge.

## The Problem

Loro is a powerful CRDT library for building local-first applications. However, performing deep or complex mutations on a Loro document can sometimes involve imperative, multi-step operations.

## The Solution

`loro-change` offers two key functions, `change` and `from`, to streamline this process.

### `change(doc, mutator)`

The `change` function takes a Loro document (or a plain object) and a mutator function. It provides the mutator with a proxied draft of the document. You can make direct, seemingly-mutative changes to this draft, and `loro-change` will handle the complexities of applying these changes correctly to the original Loro document under the hood.

**Example:**

```typescript
import { Loro } from "loro-crdt";
import { change } from "loro-change";

const doc = new Loro();
const list = doc.getList("list");

change(doc, (draft) => {
  draft.list.push({ text: "A new item", completed: false });
  draft.meta = { title: "My List" };
});

console.log(list.toJSON());
// Output: [{ text: "A new item", completed: false }]
```

### `from<T>(initialState)`

The `from` function creates a new Loro document from a plain JavaScript object, making it easy to initialize state.

### Working with Types

To get the full benefit of TypeScript, you can define a type for your document's schema. This type is then used by `from` and `change` to provide strong type-checking and autocompletion for your mutations.

Note that optional or undefined types are not allowed: the underlying LoroDoc library treats null the same as deletion (i.e. undefined) and it therefore cannot be respresented.

**Example:**

```typescript
import { Loro, LoroText } from "loro-crdt";
import { change, from, CRDT } from "loro-change";

// 1. Define the schema for your document
interface MyDoc {
  title: LoroText;
  description: string | null;
  tasks: {
    id: number;
    text: string;
    completed: boolean;
  }[];
}

// 2. Create the document with the initial state
// The `CRDT` helper creates rich CRDT types
const doc = from<MyDoc>({
  title: CRDT.Text("My Tasks"),
  description: null,
  tasks: [],
});

// 3. The `draft` in the change function is now fully typed
change(doc, (draft) => {
  // `draft.tasks` is known to be an array
  draft.tasks.push({ id: 1, text: "Write better docs", completed: false });

  // `draft.title` is a LoroText object
  draft.title.insert(0, "✅ ");

  // TypeScript will catch errors
  // draft.description = 123; // Type 'number' is not assignable to type 'string'.
});
```

By providing a type to `from<MyDoc>`, you ensure that all subsequent calls to `change` are type-safe, preventing common errors and making your code easier to refactor.

## Contributing

This project is a lightweight utility within the Loro ecosystem. Contributions are welcome!

### Tooling

- **Build**: This package uses `tsup` for efficient bundling. Run `pnpm build`.
- **Testing**: Tests are run with `vitest`. Use `pnpm test` to run the test suite.
- **Linting & Formatting**: This repository uses Biome for linting and formatting.

Please feel free to open an issue or submit a pull request!
