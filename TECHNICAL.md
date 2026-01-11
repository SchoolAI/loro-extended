# Technical Documentation

This document captures architectural decisions, technical insights, and implementation details for the loro-extended project.

## Loro CRDT Behavior

### Commit Idempotency

Loro's `commit()` is **idempotent** - calling it multiple times without changes between calls has no effect:

- Empty commits do not advance the version vector or frontiers
- Multiple sequential commits without mutations are safe and have no overhead
- This enables nested `change()` calls without requiring nesting detection

**Implication**: When implementing batched mutation patterns, you don't need to track nesting depth. Simply call `commit()` at the end of each `change()` block - Loro handles the rest.

## @loro-extended/change Architecture

### Ref Internals Pattern

All typed refs follow a **Facade + Internals** pattern:

```
TypedRef (public facade)
    └── [INTERNAL_SYMBOL]: BaseRefInternals (implementation)
```

- **Public facade** (`TypedRef` subclasses): Thin API surface, delegates to internals
- **Internals** (`BaseRefInternals` subclasses): Contains all state, caching, and implementation logic
- **Symbol access**: Internals are accessed via `[INTERNAL_SYMBOL]` to prevent namespace collisions with user data

### Key Internal Methods

| Method | Purpose |
|--------|---------|
| `getTypedRefParams()` | Returns params to recreate the ref (used by `change()` for draft creation) |
| `getChildTypedRefParams(key/index, shape)` | Returns params for creating child refs (lists, structs, records) |
| `absorbPlainValues()` | Commits cached plain value mutations back to Loro containers |
| `commitIfAuto()` | Commits if `autoCommit` mode is enabled |

### Draft Creation for `change()`

The `change()` function creates draft refs by:

1. Getting params via `internals.getTypedRefParams()`
2. Creating a new ref with `autoCommit: false`, `batchedMutation: true`
3. Executing the user function with the draft
4. Calling `absorbPlainValues()` to persist cached mutations
5. Calling `doc.commit()` to finalize

This works for all ref types because `createContainerTypedRef()` handles the polymorphic creation.

### Value Shape Caching

When `batchedMutation: true` (inside `change()` blocks):

- **Value shapes** (plain objects, primitives) are cached so mutations persist
- **Container shapes** (refs) are cached as handles - mutations go directly to Loro

When `batchedMutation: false` (direct access):

- Values are read fresh from Loro on each access
- No caching overhead for simple reads

## Naming Conventions

### Internal Method Naming

Methods that get params for **child** refs are named `getChildTypedRefParams()` to avoid shadowing the base class `getTypedRefParams()` which returns params for the ref itself.

This distinction is important:
- `getTypedRefParams()` - "How do I recreate myself?"
- `getChildTypedRefParams(key, shape)` - "How do I create a child at this key?"

## Testing Patterns

### Investigating Loro Behavior

When investigating Loro's behavior, use frontiers and oplog info rather than version vectors:

```typescript
// Frontiers show the latest operation IDs
const frontiers = doc.frontiers()

// getAllChanges() shows operation counts
const changes = doc.getAllChanges()
```

Version vectors from `doc.version().toJSON()` may return empty objects in some cases.
