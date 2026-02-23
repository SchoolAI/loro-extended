# @loro-extended/change Technical Documentation

This document covers implementation details, architecture decisions, and gotchas specific to the `@loro-extended/change` package. For the overall Loro Extended architecture, see the root [TECHNICAL.md](../../TECHNICAL.md).

## Architecture Overview

The `@loro-extended/change` package provides a typed layer over Loro CRDTs with three core abstractions:

### Shape System

Shapes define the schema for documents. They are:
- **Declarative**: Define structure without implementation
- **Composable**: Nest shapes arbitrarily deep
- **Type-inferring**: Generate TypeScript types via `Infer<Shape>`

```typescript
const schema = Shape.doc({
  title: Shape.plain.string().placeholder(""),
  items: Shape.list(Shape.struct({
    id: Shape.plain.string(),
    done: Shape.plain.boolean().placeholder(false),
  })),
});

type Doc = Infer<typeof schema>;
// { title: string; items: { id: string; done: boolean }[] }
```

### TypedDoc

A proxy-wrapped `LoroDoc` that provides schema-aware property access:
- Root-level properties return TypedRefs
- `loro(doc)` returns the underlying `LoroDoc`
- `ext(doc)` returns extended functionality (fork, change, etc.)

### TypedRefs

Typed references to Loro containers. Each container type has its own ref:

| Container | Ref Type | Underlying Loro Type |
|-----------|----------|---------------------|
| `Shape.struct()` | `StructRef` | `LoroMap` |
| `Shape.record()` | `RecordRef` | `LoroMap` |
| `Shape.list()` | `ListRef` | `LoroList` |
| `Shape.movableList()` | `MovableListRef` | `LoroMovableList` |
| `Shape.text()` | `TextRef` | `LoroText` |
| `Shape.counter()` | `CounterRef` | `LoroCounter` |
| `Shape.tree()` | `TreeRef` | `LoroTree` |

### PlainValueRef

A reactive reference to a plain value stored in a Loro container. Key behaviors:
- **Read chain**: overlay → container → placeholder
- **Write-through**: `.set()` immediately writes to the container
- Outside `change()`: returns PlainValueRef for reactive subscriptions
- Inside `change()`: primitives unwrap automatically for ergonomic boolean logic

## Symbol-Based Escape Hatches

TypedDoc and TypedRef are Proxy objects where property names map to schema fields. Symbols provide namespace separation:

| Symbol | Access Function | Purpose |
|--------|-----------------|---------|
| `INTERNAL_SYMBOL` | (internal) | Implementation details, ref internals |
| `LORO_SYMBOL` | `loro()` | Access native Loro containers directly |
| `EXT_SYMBOL` | `ext()` | Loro-extended-specific features |

**Why symbols?** Without them, a schema with a field named `doc` or `change` would collide with library methods.

## Ref Internals Pattern

All typed refs follow a **Facade + Internals** split:

```
TypedRef (public facade / proxy)
    └── [INTERNAL_SYMBOL]: RefInternals (implementation)
```

**Why split?**

1. **Proxy cleanliness**: The proxy handler only needs to delegate to internals
2. **Testability**: Internals can be unit-tested without proxy overhead
3. **Extension**: Subclasses override internals, not the facade
4. **Namespace isolation**: User schema keys can't collide with implementation

### Internals Class Hierarchy

```
BaseRefInternals (abstract)
├── DocRefInternals
├── CounterRefInternals
├── TextRefInternals
├── TreeRefInternals
├── TreeNodeRefInternals
├── ListRefBaseInternals
│   ├── ListRefInternals
│   └── MovableListRefInternals
└── MapBasedRefInternals (abstract)
    ├── StructRefInternals
    └── RecordRefInternals
```

Note: `ListRefBaseInternals` is not abstract because it's fully functional on its own.
The subclasses (`ListRefInternals`, `MovableListRefInternals`) only add container-specific
methods like `absorbValueAtIndex()`.

**MapBasedRefInternals** extracts shared logic for struct and record refs:
- Child ref caching
- `getChildTypedRefParams()` for creating child refs
- `finalizeTransaction()` to clear caches after `change()`

### Key Internal Methods

| Method | Purpose |
|--------|---------|
| `getContainer()` | Returns the underlying Loro container |
| `getTypedRefParams()` | Returns params to recreate this ref (for draft creation) |
| `getChildTypedRefParams(key, shape)` | Returns params for child ref creation |
| `finalizeTransaction()` | Cleanup after `change()` completes |
| `commitIfAuto()` | Commits if `autoCommit` mode is enabled |
| `withBatchedCommit(fn)` | Suppress auto-commit during `fn`, commit once at end |

## PlainValueRef Design

PlainValueRef provides reactive access to plain values in Loro containers.

### Read Chain

When reading a value, PlainValueRef checks in order:

1. **Overlay** (if present): Used for computing "before" state in transitions
2. **Container**: The actual Loro container value
3. **Placeholder**: Schema-defined default for empty state

This chain is implemented in `readFromContainerOrOverlay()`.

### Write-Through

`.set(value)` immediately writes to the Loro container via:
- `writeValue(internals, key, value)` for struct/record properties
- `writeListValue(internals, index, value)` for list items

There is no buffering—writes are eager.

### Proxy Variations

PlainValueRef has multiple proxy implementations optimized for different shapes:

| Proxy Factory | Use Case |
|---------------|----------|
| `createStructProxy` | Struct properties (schema-aware) |
| `createRecordProxy` | Record properties (schema-aware) |
| `createListItemStructProxy` | List items with struct shape |
| `createGenericObjectProxy` | Union/any shapes (runtime inspection) |

All proxies share three helpers:
- `proxyGetPreamble`: Symbol/existing-property checks
- `unwrapForSet`: Unwrap PlainValueRef before writing
- `runtimePrimitiveCheck`: Return raw primitives in draft mode

## Mergeable Storage

When `mergeable: true`, containers are stored at the document root with path-based names:

```typescript
const doc = createTypedDoc(schema, { mergeable: true });
```

**Why?** Concurrent container creation at the same path would create different container IDs. Flattened storage ensures deterministic IDs.

### Path Encoding

| Schema Path | Encoded Root Name |
|-------------|-------------------|
| `data.items` | `data-items` |
| `data.my-key.value` | `data-my\-key-value` |

Separator: `-`, Escape: `\`, Literal hyphen: `\-`, Literal backslash: `\\`

### Limitations

- Lists of containers NOT supported with `mergeable: true`
- Use `Shape.record()` with string keys instead

## Draft Mode

Inside `change()` blocks, refs operate in "draft mode" (`batchedMutation: true`):

### Behavior Differences

| Aspect | Outside `change()` | Inside `change()` |
|--------|-------------------|-------------------|
| Value access | Returns PlainValueRef | Primitives unwrap, objects stay wrapped |
| Auto-commit | After each write | Suppressed until end |
| Boolean logic | `ref.get() && ...` | `ref && ...` works directly |

### Draft Creation Flow

1. `change(doc, fn)` calls `internals.getTypedRefParams()`
2. Creates new ref with `autoCommit: false`, `batchedMutation: true`
3. Executes user function with draft
4. Calls `finalizeTransaction()` for cleanup
5. Calls `doc.commit()` to finalize

## Known Limitations

### Stale List Refs

PlainValueRef for list items stores the index at creation time. After list mutations (insert, delete, move), the index may point to a different item or be out of bounds.

```typescript
// WRONG: ref reads stale index after delete
const ref = draft.items.get(0);
draft.items.delete(0, 1);
ref.get(); // Returns WRONG value (index shifted)

// RIGHT: snapshot before mutating
const value = draft.items.get(0)?.get();
draft.items.delete(0, 1);
// use `value` safely
```

**Future improvement**: Phase 4 of the engineering plan adds `StaleRefError` detection.

### List Overlay TODO

The diff overlay for `getTransition()` does not fully support lists. Computing "before" values for list items requires reversing list deltas, which is partially implemented but not complete.

### No Runtime Validation

Shapes define structure but don't validate at runtime. A `Shape.plain.string()` accepts any value at runtime. Future phases may add optional validation.

### Tree Overlay Not Implemented

Tree containers don't support the diff overlay system. `getTransition()` will not show tree changes correctly.

## Gotchas

1. **PlainValueRef is a LIVE reference, not a snapshot** — After list mutations, indices shift. Always capture raw values before mutating the container.

2. **`typeof` check for primitives happens at runtime** — The primitive vs object decision in draft mode is based on `typeof value`, not the schema type. Union and any shapes can contain either.

3. **RecordRef bracket access always returns PlainValueRef** — Even for non-existent keys. `if (record.someKey)` is always truthy. Use `value(record.someKey)` to check existence.

4. **`assignPlainValueToTypedRef` handles struct/record differently** — For structs, iterates keys and calls `propRef.set()`. For records, calls `ref.set(key, value)`.

5. **List item proxies don't have `runtimePrimitiveCheck`** — Inside `change()`, list item nested properties always return PlainValueRef. Only top-level list access unwraps primitives.

6. **Predicate functions receive plain values** — In `.find()`, `.filter()`, etc., the callback receives raw values for ergonomic comparisons. Only the return value is wrapped.

7. **`materialize()` creates nested containers eagerly** — For structs and docs, all nested containers are created on initialization to ensure deterministic container IDs across peers.

8. **`withBatchedCommit()` is reentrant-safe** — If auto-commit is already suppressed, inner calls don't double-restore.

9. **The `_draft` shape parameter equals `_mutable`** — Both modes return PlainValueRef for value shapes. The distinction may be removed in a future refactor.

10. **Container ID determinism requires eager materialization** — When a struct is created, all nested containers must be created immediately, not lazily. Otherwise, peers create containers with different IDs.

## File Organization

```
src/
├── ext.ts              # ext() function and EXT_SYMBOL
├── loro.ts             # loro() function and LORO_SYMBOL
├── shape.ts            # Shape builders and types
├── change.ts           # change() function implementation
├── subscribe.ts        # Subscription utilities
├── typed-doc.ts        # TypedDoc proxy and creation
├── types.ts            # Shared type definitions
└── typed-refs/
    ├── base.ts                    # BaseRefInternals, TypedRef
    ├── map-based-ref-internals.ts # Shared struct/record internals
    ├── struct-ref.ts              # StructRef facade
    ├── struct-ref-internals.ts    # StructRef implementation
    ├── record-ref.ts              # RecordRef facade
    ├── record-ref-internals.ts    # RecordRef implementation
    ├── list-ref.ts                # ListRef facade
    ├── list-ref-base.ts           # ListRefBaseInternals + ListRefBase
    ├── list-ref-internals.ts      # ListRef implementation
    ├── movable-list-ref.ts        # MovableListRef facade
    ├── movable-list-ref-internals.ts
    ├── text-ref.ts                # TextRef
    ├── text-ref-internals.ts
    ├── counter-ref.ts             # CounterRef
    ├── counter-ref-internals.ts
    ├── tree-ref.ts                # TreeRef
    ├── tree-ref-internals.ts
    ├── tree-node-ref.ts           # TreeNodeRef
    ├── tree-node-ref-internals.ts
    ├── plain-value-ref.ts         # PlainValueRef and factories
    ├── factory.ts                 # createContainerTypedRef
    └── utils.ts                   # Shared utilities
```

## Testing

Run package tests:
```bash
pnpm turbo run verify --filter=@loro-extended/change
```

Run specific test subset:
```bash
pnpm turbo run verify --filter=@loro-extended/change -- logic -- -t 'PlainValueRef'
```

## Related Documentation

- [Root TECHNICAL.md](../../TECHNICAL.md) — Full architecture overview
- [README.md](./README.md) — User-facing API documentation
- [NESTED_CONTAINER_MATERIALIZATION_BUG.md](./NESTED_CONTAINER_MATERIALIZATION_BUG.md) — Bug report and resolution