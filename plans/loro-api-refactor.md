# `loro()` API Refactor Plan

## Problem Statement

The loro-extended/change API has inconsistent method placement across refs:

1. **Namespace collision** - Methods like `loroDoc`, `subscribe`, `pushContainer` live directly on refs, potentially conflicting with user data keys
2. **Mixed concerns** - Plain value operations and CRDT-specific operations are intermingled
3. **`$` escape hatch is awkward** - `ref.$.loroDoc` is unintuitive

## Solution: The `loro()` Function

A single escape hatch function that reveals CRDT internals:

```typescript
import { loro } from "@loro-extended/change";

loro(ref).doc; // LoroDoc
loro(ref).container; // LoroList, LoroMap, etc. (correctly typed)
loro(ref).subscribe(cb); // Subscribe to changes
loro(list).pushContainer(loroMap); // Container operations
```

## Design Principle

> If it takes a plain JavaScript value, keep it on the ref.
> If it takes a Loro container or exposes CRDT internals, move to `loro()`.

## API Surface by Ref Type

### ListRef / MovableListRef

**Keep on Ref** (plain value operations):

| Method                 | Notes                      |
| ---------------------- | -------------------------- |
| `push(item)`           | Array-like                 |
| `insert(index, item)`  | CRDT but takes plain value |
| `delete(index, len)`   | CRDT but common operation  |
| `find(predicate)`      | Array-like                 |
| `filter(predicate)`    | Array-like                 |
| `map(callback)`        | Array-like                 |
| `forEach(callback)`    | Array-like                 |
| `some(predicate)`      | Array-like                 |
| `every(predicate)`     | Array-like                 |
| `slice(start, end)`    | Array-like                 |
| `findIndex(predicate)` | Array-like                 |
| `length`               | Array-like                 |
| `[index]`              | Array-like (via proxy)     |
| `toJSON()`             | Serialization              |
| `[Symbol.iterator]`    | Iteration                  |

**Move to `loro()`** (container/CRDT operations):

| Method                              | Notes                   |
| ----------------------------------- | ----------------------- |
| `pushContainer(container)`          | Takes Loro container    |
| `insertContainer(index, container)` | Takes Loro container    |
| `subscribe(callback)`               | CRDT event subscription |
| `doc`                               | Raw LoroDoc access      |
| `container`                         | Raw LoroList access     |

**Remove** (internal/redundant):

| Method                | Reason                                    |
| --------------------- | ----------------------------------------- |
| `get(index)`          | Use `[index]` instead                     |
| `absorbPlainValues()` | Internal - hide via Symbol                |
| `getTypedRefParams()` | Internal - hide via Symbol                |
| `$`                   | Replaced by `loro()`                      |

### StructRef

**Keep on Ref** (plain value operations):

| Method                 | Notes                       |
| ---------------------- | --------------------------- |
| `obj.property`         | Property access (via Proxy) |
| `obj.property = value` | Property assignment         |
| `Object.keys(obj)`     | Via Proxy `ownKeys` trap    |
| `'key' in obj`         | Via Proxy `has` trap        |
| `delete obj.key`       | Via Proxy `deleteProperty`  |
| `toJSON()`             | Serialization               |

**Move to `loro()`**:

| Method                         | Notes                   |
| ------------------------------ | ----------------------- |
| `setContainer(key, container)` | Takes Loro container    |
| `subscribe(callback)`          | CRDT event subscription |
| `doc`                          | Raw LoroDoc access      |
| `container`                    | Raw LoroMap access      |

**Remove**:

| Method                | Reason                                                 |
| --------------------- | ------------------------------------------------------ |
| `get(key)`            | Use property access instead                            |
| `set(key, value)`     | Use property assignment instead                        |
| `delete(key)`         | Use `delete obj.key` instead (via Proxy)               |
| `has(key)`            | Use `'key' in obj` instead (via Proxy)                 |
| `keys()`              | Use `Object.keys(obj)` instead (via Proxy)             |
| `values()`            | Use `Object.values(obj)` instead (via Proxy)           |
| `size`                | Not standard for objects                               |
| `absorbPlainValues()` | Internal - hide via Symbol                             |
| `getOrCreateRef()`    | Internal - hide via Symbol                             |
| `getTypedRefParams()` | Internal - hide via Symbol                             |
| `$`                   | Replaced by `loro()`                                   |

### RecordRef

**Decision: Map-like interface only** (remove proxy object access)

**Keep on Ref** (Map-like operations with plain values):

| Method            | Notes         |
| ----------------- | ------------- |
| `get(key)`        | Map-like      |
| `set(key, value)` | Map-like      |
| `delete(key)`     | Map-like      |
| `has(key)`        | Map-like      |
| `keys()`          | Map-like      |
| `values()`        | Map-like      |
| `size`            | Map-like      |
| `toJSON()`        | Serialization |

**Move to `loro()`**:

| Method                         | Notes                   |
| ------------------------------ | ----------------------- |
| `setContainer(key, container)` | Takes Loro container    |
| `subscribe(callback)`          | CRDT event subscription |
| `doc`                          | Raw LoroDoc access      |
| `container`                    | Raw LoroMap access      |

**Remove**:

| Method                | Reason                     |
| --------------------- | -------------------------- |
| Proxy object access   | Use `get()`/`set()` only   |
| `record.key`          | Use `record.get('key')`    |
| `record.key = value`  | Use `record.set('key', v)` |
| `getRef(key)`         | Internal - hide via Symbol |
| `getOrCreateRef(key)` | Internal - hide via Symbol |
| `absorbPlainValues()` | Internal - hide via Symbol |
| `$`                   | Replaced by `loro()`       |

### TextRef

**Keep on Ref** (these ARE the core API):

| Method                    | Notes               |
| ------------------------- | ------------------- |
| `insert(index, content)`  | Core text operation |
| `delete(index, len)`      | Core text operation |
| `update(text)`            | Convenience method  |
| `mark(range, key, value)` | Rich text           |
| `unmark(range, key)`      | Rich text           |
| `toDelta()`               | Rich text           |
| `applyDelta(delta)`       | Rich text           |
| `toString()`              | String-like         |
| `valueOf()`               | String-like         |
| `length`                  | String-like         |
| `toJSON()`                | Serialization       |
| `[Symbol.toPrimitive]`    | String coercion     |

**Move to `loro()`**:

| Method                | Notes                   |
| --------------------- | ----------------------- |
| `subscribe(callback)` | CRDT event subscription |
| `doc`                 | Raw LoroDoc access      |
| `container`           | Raw LoroText access     |

**Remove**:

| Method                | Reason                     |
| --------------------- | -------------------------- |
| `absorbPlainValues()` | Internal - hide via Symbol |
| `$`                   | Replaced by `loro()`       |

### CounterRef

**Keep on Ref** (these ARE the core API):

| Method                 | Notes                  |
| ---------------------- | ---------------------- |
| `increment(value)`     | Core counter operation |
| `decrement(value)`     | Core counter operation |
| `value`                | Number-like            |
| `valueOf()`            | Number-like            |
| `toJSON()`             | Serialization          |
| `[Symbol.toPrimitive]` | Number coercion        |

**Move to `loro()`**:

| Method                | Notes                   |
| --------------------- | ----------------------- |
| `subscribe(callback)` | CRDT event subscription |
| `doc`                 | Raw LoroDoc access      |
| `container`           | Raw LoroCounter access  |

**Remove**:

| Method                | Reason                     |
| --------------------- | -------------------------- |
| `absorbPlainValues()` | Internal - hide via Symbol |
| `$`                   | Replaced by `loro()`       |

## TypedDoc Changes

**Keep on Doc**:

| Method         | Notes                                      |
| -------------- | ------------------------------------------ |
| `doc.property` | Schema property access                     |
| `toJSON()`     | Serialization                              |
| `change(fn)`   | Batched mutations (move from `$.change()`) |

**Namespace collision escape hatch**: If a schema has a property named `change`, access it via bracket notation: `doc['change']` instead of `doc.change`.

**Move to `loro()`**:

| Method                | Notes                                  |
| --------------------- | -------------------------------------- |
| `doc`                 | Raw LoroDoc access (was `$.loroDoc`)   |
| `subscribe(callback)` | Doc-level subscription                 |
| `applyPatch(patch)`   | JSON Patch (was `$.applyPatch()`)      |
| `docShape`            | Schema access (was `$.docShape`)       |
| `rawValue`            | Unmerged CRDT value (was `$.rawValue`) |

**Remove**:

| Method | Reason                |
| ------ | --------------------- |
| `$`    | Replaced by `loro()`  |

## Implementation

### `loro()` Function

```typescript
// Type definitions
interface LoroBase {
  readonly doc: LoroDoc;
  subscribe(callback: (event: unknown) => void): Subscription;
}

interface LoroList<Shape> extends LoroBase {
  readonly container: LoroList;
  pushContainer(container: Container): Container;
  insertContainer(index: number, container: Container): Container;
}

interface LoroMap<Shape> extends LoroBase {
  readonly container: LoroMap;
  setContainer(key: string, container: Container): Container;
}

interface LoroText extends LoroBase {
  readonly container: LoroText;
}

interface LoroCounter extends LoroBase {
  readonly container: LoroCounter;
}

interface LoroTypedDoc extends LoroBase {
  applyPatch(patch: JsonPatch, pathPrefix?: (string | number)[]): void;
  readonly docShape: DocShape;
  readonly rawValue: unknown;
}

// Implementation
function loro<Shape extends ListContainerShape>(
  ref: ListRef<Shape>
): LoroList<Shape>;
function loro<Shape extends MovableListContainerShape>(
  ref: MovableListRef<Shape>
): LoroList<Shape>;
function loro<Shape extends StructContainerShape>(
  ref: StructRef<Shape>
): LoroMap<Shape>;
function loro<Shape extends RecordContainerShape>(
  ref: RecordRef<Shape>
): LoroMap<Shape>;
function loro(ref: TextRef): LoroText;
function loro(ref: CounterRef): LoroCounter;
function loro<Shape extends DocShape>(doc: TypedDoc<Shape>): LoroTypedDoc;
function loro(refOrDoc: TypedRef<any> | TypedDoc<any>): LoroBase {
  return refOrDoc[LORO_SYMBOL];
}
```

### Storage of Internals via Symbol

Use a Symbol to store internal methods and the loro() result:

```typescript
// Well-known Symbol for loro() access
export const LORO_SYMBOL = Symbol.for("loro-extended:loro");

// Symbol for internal methods (not exported)
const INTERNAL_SYMBOL = Symbol("loro-extended:internal");

// In TypedRef base class
class TypedRef<Shape> {
  // Public loro() access
  [LORO_SYMBOL]: LoroBase;
  
  // Internal methods (hidden from enumeration, not exported)
  [INTERNAL_SYMBOL]: {
    absorbPlainValues(): void;
    getTypedRefParams(): TypedRefParams;
    // ... other internal methods
  };

  constructor(params) {
    this[LORO_SYMBOL] = {
      get doc() { return params.getDoc(); },
      get container() { return params.getContainer(); },
      subscribe: (cb) => params.getContainer().subscribe(cb),
      // ... container-specific methods
    };
    
    this[INTERNAL_SYMBOL] = {
      absorbPlainValues: () => { /* ... */ },
      getTypedRefParams: () => params,
    };
  }
}

// loro() implementation
export function loro(ref: TypedRef<any>): LoroBase {
  return ref[LORO_SYMBOL];
}
```

### StructRef Proxy Implementation

Switch from `Object.defineProperty()` to Proxy for full object-like behavior:

```typescript
class StructRef<Shape> extends TypedRef<Shape> {
  constructor(params) {
    super(params);
    
    // Return a Proxy instead of the class instance
    return new Proxy(this, {
      get(target, prop, receiver) {
        // Handle Symbol access (loro(), internal, etc.)
        if (typeof prop === 'symbol') {
          return Reflect.get(target, prop, receiver);
        }
        
        // Handle toJSON
        if (prop === 'toJSON') {
          return () => target.toJSON();
        }
        
        // Schema property access
        if (prop in target.shape.shapes) {
          return target.getPropertyValue(prop as string);
        }
        
        return undefined;
      },
      
      set(target, prop, value) {
        if (typeof prop === 'string' && prop in target.shape.shapes) {
          target.setPropertyValue(prop, value);
          return true;
        }
        return false;
      },
      
      has(target, prop) {
        if (typeof prop === 'string') {
          return prop in target.shape.shapes;
        }
        return false;
      },
      
      deleteProperty(target, prop) {
        if (typeof prop === 'string' && prop in target.shape.shapes) {
          target.deleteProperty(prop);
          return true;
        }
        return false;
      },
      
      ownKeys(target) {
        // Return only schema keys, not internal methods
        return Object.keys(target.shape.shapes);
      },
      
      getOwnPropertyDescriptor(target, prop) {
        if (typeof prop === 'string' && prop in target.shape.shapes) {
          return {
            configurable: true,
            enumerable: true,
            value: target.getPropertyValue(prop),
          };
        }
        return undefined;
      },
    });
  }
}
```

## Implementation Phases

### Phase 1: Create `loro()` Function and Migrate Container Operations
- [x] Define `LoroBase` and container-specific interfaces
- [x] Add `LORO_SYMBOL` storage to TypedRef base class
- [x] Implement `loro()` function
- [ ] Move `pushContainer` from ListRef to `LoroList` (Phase 2)
- [ ] Move `insertContainer` from ListRef to `LoroList` (Phase 2)
- [ ] Move `setContainer` from StructRef/RecordRef to `LoroMap` (Phase 2)
- [x] Move `$.loroDoc` to `loro(ref).doc`
- [x] Move `$.loroContainer` to `loro(ref).container`
- [x] Move `$.subscribe` to `loro(ref).subscribe`
- [x] Export `loro` from package
- [x] Update tests (23 new tests for loro())
- [x] Update `getLoroDoc()` and `getLoroContainer()` helpers to use `loro()`

### Phase 2: Clean Up All Refs ✅ COMPLETED
- [x] **ListRef**: Add `pushContainer`/`insertContainer` to `loro()` namespace
- [x] **StructRef**: Add `setContainer` to `loro()` namespace
- [x] **RecordRef**: Add `setContainer` to `loro()` namespace
- [x] **StructRef**: Switch from defineProperty to Proxy
  - [x] Implement `get` trap for property access
  - [x] Implement `set` trap for property assignment (`struct.key = value`)
  - [x] Implement `ownKeys` trap for `Object.keys()`
  - [x] Implement `has` trap for `'key' in obj`
  - [x] Implement `deleteProperty` trap for `delete obj.key`
  - [x] Implement `getOwnPropertyDescriptor` trap for proper enumeration
  - [x] Remove `.set()` method (use property assignment instead)
  - [x] StructRef is now a type alias (not a class extending TypedRef)
- [x] **All Refs**: Move internal methods to `INTERNAL_SYMBOL`
  - [x] `absorbPlainValues()` - now accessed via `ref[INTERNAL_SYMBOL].absorbPlainValues()`
- [ ] **ListRef**: Remove `get(index)` method (future - breaking change)
- [ ] **RecordRef**: Remove proxy object access, keep Map-like interface only (future - already Map-like)

### Phase 3: Update TypedDoc and Remove `$` ✅ COMPLETED
- [x] Move `$.change()` to `doc.change()`
- [x] Move `$.loroDoc` to `loro(doc).doc`
- [x] Move `$.applyPatch()` to `loro(doc).applyPatch()`
- [x] Update `getLoroDoc()` and `getLoroContainer()` helpers to use `loro()`
- [x] Update tests (32 tests for loro() and doc.change())
- [x] Remove `$` property from TypedRef
- [x] Remove `$` property from TypedDoc
- [x] Remove `RefMetaNamespace` interface
- [x] Remove `TypedDocMeta` class
- [ ] Update examples (future)
- [ ] Update documentation (future)

## Files to Modify

| File                         | Changes                                    |
| ---------------------------- | ------------------------------------------ |
| `typed-refs/base.ts`         | Add Symbol storage, remove `$`             |
| `typed-refs/struct.ts`       | Switch to Proxy, remove methods            |
| `typed-refs/record.ts`       | Remove proxy, keep Map-like, hide internals|
| `typed-refs/list-base.ts`    | Remove `get()`, move container methods     |
| `typed-refs/list.ts`         | Inherit changes                            |
| `typed-refs/movable-list.ts` | Inherit changes                            |
| `typed-refs/text.ts`         | Hide internals via Symbol                  |
| `typed-refs/counter.ts`      | Hide internals via Symbol                  |
| `typed-doc.ts`               | Move `change()` to doc, remove `$`         |
| `functional-helpers.ts`      | Update to use `loro()`                     |
| `index.ts`                   | Export `loro`, `LORO_SYMBOL`               |
| All `*.test.ts`              | Update to use new API                      |
| Examples                     | Update to use new API                      |

## Migration Guide

### Before

```typescript
// CRDT access
ref.$.loroDoc
ref.$.loroContainer
ref.$.subscribe(callback)

// Container operations
list.pushContainer(loroMap)
struct.setContainer('key', loroMap)

// TypedDoc
doc.$.change(draft => { ... })
doc.$.loroDoc
```

### After

```typescript
import { loro } from '@loro-extended/change'

// CRDT access
loro(ref).doc
loro(ref).container
loro(ref).subscribe(callback)

// Container operations
loro(list).pushContainer(loroMap)
loro(struct).setContainer('key', loroMap)

// TypedDoc
doc.change(draft => { ... })
loro(doc).doc

// If schema has a 'change' property, use bracket notation
doc['change']  // Access schema property named 'change'
```

## Success Criteria

1. **Zero reserved names on refs** - No method name can conflict with user data (except `toJSON` which is a JS convention)
2. **Clear separation** - Plain value ops on ref, CRDT ops via `loro()`
3. **Type-safe** - `loro(listRef).container` returns `LoroList`
4. **Single import** - Just `import { loro }`
5. **JavaScript-native behavior** - StructRef supports `Object.keys()`, `'key' in obj`, `delete obj.key`
6. **RecordRef is Map-like** - Clear, consistent interface
7. **Internal methods hidden** - Via Symbol, not enumerable
8. **All tests pass** - No regressions
9. **Documentation updated** - Clear migration path
