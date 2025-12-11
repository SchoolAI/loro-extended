# Plan: Integrate `.key()` and `.migrateFrom()` Directly into Shape Types

## Overview

This plan outlines the refactoring needed to support `.key()` and `.migrateFrom()` methods directly on `Shape` types, eliminating the need for the `makeMigratable()` wrapper function.

### Current State
```typescript
// Current API - requires makeMigratable wrapper
import { makeMigratable, Shape } from "@loro-extended/change"

const ChatSchema = Shape.doc({
  messages: makeMigratable(Shape.list(Shape.text()))
    .key("_v2_messages")
    .migrateFrom({...})
})
```

### Target State
```typescript
// Target API - methods directly on Shape
import { Shape } from "@loro-extended/change"

const ChatSchema = Shape.doc({
  messages: Shape.list(Shape.text())
    .key("_v2_messages")
    .migrateFrom({...})
})
```

## Analysis

### Files to Modify

1. **`packages/change/src/shape.ts`** - Core shape definitions
2. **`packages/change/src/migration.ts`** - Migration types (keep for type exports)
3. **`packages/change/src/index.ts`** - Update exports
4. **`packages/change/src/migration.test.ts`** - Update tests
5. **`packages/change/src/schema-migration.integration.test.ts`** - Update integration tests

### Shape Types That Need Migration Support

Based on [`shape.ts`](packages/change/src/shape.ts), the following container shapes need `.key()` and `.migrateFrom()`:

- `ListContainerShape` (line 64-70)
- `MovableListContainerShape` (line 72-78)
- `MapContainerShape` (line 80-95)
- `RecordContainerShape` (line 97-106)
- `TextContainerShape` (line 46-48)
- `CounterContainerShape` (line 49-52)
- `TreeContainerShape` (line 53-58)

### Design Decisions

1. **Approach**: Add migration methods to each container shape interface and factory function
2. **Type Safety**: Use intersection types to add migration extensions
3. **Immutability**: Each method returns a new shape object (current behavior preserved)
4. **Backward Compatibility**: Keep `makeMigratable` as a deprecated export for gradual migration

## Implementation Steps

### Step 1: Create a Migratable Shape Mixin Type

In `shape.ts`, create a generic type that adds migration methods to any container shape:

```typescript
/**
 * Adds .key() and .migrateFrom() methods to a container shape.
 * This is the type returned by all container shape factory functions.
 */
export type MigratableContainerShape<S extends ContainerShape> = S & {
  readonly _storageKey?: string
  readonly _migrations?: MigrationDefinition<ContainerOrValueShape, S>[]
  
  /**
   * Set the physical storage key for this field.
   */
  key(storageKey: string): MigratableContainerShape<S>
  
  /**
   * Define a migration from an older schema version.
   */
  migrateFrom<SourceShape extends ContainerOrValueShape>(migration: {
    key: string
    sourceShape: SourceShape
    transform: (sourceData: SourceShape["_plain"]) => S["_plain"]
  }): MigratableContainerShape<S>
}
```

### Step 2: Create a Helper Function to Add Migration Methods

Create a private helper that adds the migration methods to any shape object:

```typescript
function withMigrationMethods<S extends ContainerShape>(
  shape: S,
  storageKey?: string,
  migrations?: MigrationDefinition[]
): MigratableContainerShape<S> {
  const result = {
    ...shape,
    _storageKey: storageKey,
    _migrations: migrations,
    
    key(newStorageKey: string): MigratableContainerShape<S> {
      return withMigrationMethods(shape, newStorageKey, migrations)
    },
    
    migrateFrom<SourceShape extends ContainerOrValueShape>(migration: {
      key: string
      sourceShape: SourceShape
      transform: (sourceData: SourceShape["_plain"]) => S["_plain"]
    }): MigratableContainerShape<S> {
      const migrationDef: MigrationDefinition = {
        sourceKey: migration.key,
        sourceShape: migration.sourceShape,
        transform: migration.transform as (sourceData: unknown) => unknown,
      }
      return withMigrationMethods(
        shape,
        storageKey,
        [...(migrations ?? []), migrationDef]
      )
    },
  }
  
  return result as MigratableContainerShape<S>
}
```

### Step 3: Update Container Shape Factory Functions

Update each factory function in the `Shape` object to return `MigratableContainerShape<T>`:

```typescript
export const Shape = {
  // ... doc stays the same (doc shapes don't need migration)
  
  counter: (): MigratableContainerShape<WithPlaceholder<CounterContainerShape>> => {
    const base: CounterContainerShape = {
      _type: "counter" as const,
      _plain: 0,
      _mutable: {} as CounterRef,
      _placeholder: 0,
    }
    const withPlaceholder = Object.assign(base, {
      placeholder(value: number): CounterContainerShape {
        return { ...base, _placeholder: value }
      },
    })
    return withMigrationMethods(withPlaceholder)
  },
  
  list: <T extends ContainerOrValueShape>(
    shape: T
  ): MigratableContainerShape<ListContainerShape<T>> => {
    const base: ListContainerShape<T> = {
      _type: "list" as const,
      shape,
      _plain: [] as any,
      _mutable: {} as any,
      _placeholder: [] as never[],
    }
    return withMigrationMethods(base)
  },
  
  // ... similar updates for map, record, movableList, text, tree
}
```

### Step 4: Handle Composition with `.placeholder()`

Some shapes like `counter()` and `text()` return `WithPlaceholder<T>`. We need to ensure the migration methods work correctly with these:

```typescript
// The type should be:
MigratableContainerShape<WithPlaceholder<CounterContainerShape>>

// Which expands to:
CounterContainerShape & {
  placeholder(value: number): CounterContainerShape
} & {
  _storageKey?: string
  _migrations?: MigrationDefinition[]
  key(storageKey: string): MigratableContainerShape<...>
  migrateFrom(...): MigratableContainerShape<...>
}
```

**Challenge**: When `.placeholder()` is called, it returns a plain `CounterContainerShape` without migration methods. We need to preserve migration methods through `.placeholder()` calls.

**Solution**: Modify the `withMigrationMethods` helper to also wrap the `placeholder` method if it exists:

```typescript
function withMigrationMethods<S extends ContainerShape>(
  shape: S,
  storageKey?: string,
  migrations?: MigrationDefinition[]
): MigratableContainerShape<S> {
  const result: any = {
    ...shape,
    _storageKey: storageKey,
    _migrations: migrations,
    
    key(newStorageKey: string) {
      return withMigrationMethods(shape, newStorageKey, migrations)
    },
    
    migrateFrom<SourceShape extends ContainerOrValueShape>(migration: {...}) {
      // ... same as before
    },
  }
  
  // If the shape has a placeholder method, wrap it to preserve migration methods
  if ('placeholder' in shape && typeof (shape as any).placeholder === 'function') {
    const originalPlaceholder = (shape as any).placeholder
    result.placeholder = function(value: any) {
      const newShape = originalPlaceholder.call(shape, value)
      return withMigrationMethods(newShape, storageKey, migrations)
    }
  }
  
  return result as MigratableContainerShape<S>
}
```

### Step 5: Update Type Exports

In `index.ts`, update the exports:

```typescript
// Keep MigratableShape type for backward compatibility
export type { MigratableShape } from "./migration.js"

// Add new type
export type { MigratableContainerShape } from "./shape.js"

// Deprecate makeMigratable
/** @deprecated Use Shape.list(...).key(...) directly instead */
export { makeMigratable } from "./migration.js"
```

### Step 6: Update Tests

Update `migration.test.ts` to test the new API:

```typescript
describe("Direct Migration Methods on Shape", () => {
  it("should support .key() directly on Shape.list()", () => {
    const shape = Shape.list(Shape.text()).key("_v2_messages")
    expect(shape._storageKey).toBe("_v2_messages")
  })
  
  it("should support .migrateFrom() directly on Shape.list()", () => {
    const shape = Shape.list(Shape.text())
      .key("_v2_messages")
      .migrateFrom({
        key: "_v1_messages",
        sourceShape: Shape.list(Shape.plain.string()),
        transform: (v1) => v1,
      })
    expect(shape._migrations).toHaveLength(1)
  })
  
  it("should preserve migration methods through .placeholder()", () => {
    const shape = Shape.counter()
      .key("_v2_count")
      .placeholder(10)
    
    expect(shape._storageKey).toBe("_v2_count")
    expect(shape._placeholder).toBe(10)
  })
})
```

Update `schema-migration.integration.test.ts` to use the new API (remove `makeMigratable` calls).

### Step 7: Deprecate `makeMigratable`

Keep `makeMigratable` in `migration.ts` but mark it as deprecated:

```typescript
/**
 * @deprecated Use Shape.list(...).key(...).migrateFrom(...) directly instead.
 * This function will be removed in a future version.
 */
export function makeMigratable<S extends ContainerOrValueShape>(
  shape: S,
): MigratableShape<S> {
  // ... existing implementation
}
```

## Type Complexity Considerations

### Return Type of Factory Functions

The return types become more complex:

```typescript
// Before
Shape.list(Shape.text()) // returns ListContainerShape<TextContainerShape>

// After  
Shape.list(Shape.text()) // returns MigratableContainerShape<ListContainerShape<TextContainerShape>>
```

This is acceptable because:
1. Users rarely need to explicitly type these - TypeScript infers them
2. The `_plain` and `_mutable` phantom types are preserved
3. IDE autocomplete will show `.key()` and `.migrateFrom()` methods

### Nested Shapes

When a shape is nested inside another (e.g., `Shape.list(Shape.map({...}))`), only the outer shape needs migration methods. The inner shape's migration is handled by the outer shape's migration transform function.

## Testing Strategy

1. **Unit Tests**: Test each factory function returns shapes with migration methods
2. **Integration Tests**: Update existing integration tests to use new API
3. **Type Tests**: Ensure TypeScript correctly infers types with migration methods
4. **Backward Compatibility**: Ensure `makeMigratable` still works (with deprecation warning)

## Migration Guide for Users

```markdown
## Migrating from makeMigratable to Direct Methods

### Before (v1.x)
```typescript
import { makeMigratable, Shape } from "@loro-extended/change"

const schema = Shape.doc({
  messages: makeMigratable(Shape.list(Shape.text()))
    .key("_v2_messages")
    .migrateFrom({...})
})
```

### After (v2.x)
```typescript
import { Shape } from "@loro-extended/change"

const schema = Shape.doc({
  messages: Shape.list(Shape.text())
    .key("_v2_messages")
    .migrateFrom({...})
})
```

The `makeMigratable` function is deprecated and will be removed in a future version.
```

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Breaking existing code | Keep `makeMigratable` as deprecated export |
| Type inference issues | Extensive type testing |
| Performance overhead | Methods are just factory functions, minimal overhead |
| Increased bundle size | Negligible - just a few extra methods per shape |

## Summary

This refactoring improves DX by:
1. Eliminating the need for `makeMigratable` import
2. Making `.key()` and `.migrateFrom()` discoverable via autocomplete
3. Creating a more fluent API: `Shape.list(...).key(...).migrateFrom(...)`

The implementation is straightforward:
1. Add a `withMigrationMethods` helper function
2. Update each container factory to use this helper
3. Handle `.placeholder()` composition correctly
4. Deprecate `makeMigratable` for backward compatibility