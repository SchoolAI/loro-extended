Of course. Here is the post-mortem report.

# Post-Mortem: Refactoring `@loro-extended/change` for Direct `LoroDoc` Interaction

## 1. Objective

The primary goal of this refactoring effort was to modify the [`@loro-extended/change`](packages/change/src/index.ts:1) library to remove its dependency on a single, hardcoded "root" `LoroMap` container. The intention was to allow developers to interact directly with a `LoroDoc`'s root-level named containers (`LoroMap`, `LoroList`, etc.), providing a more intuitive and flexible API that aligns better with the capabilities of the underlying `loro-crdt` library.

The key desired change was to move from this:

```typescript
// Current API
const doc = from({ a: 1, b: { c: 2 } });
// Under the hood, this creates a single LoroMap named "root".
// doc.getMap("root") contains { a: 1, b: ... }
```

to this:

```typescript
// Desired API
const doc = from({ a: 1, b: { c: 2 } });
// `a` would be a root-level value/container.
// `b` would be a root-level LoroMap named "b".
```

## 2. Summary of Approach

The planned approach consisted of several steps:

1.  **Create a `docProxyHandler` for `LoroDoc`**: This new `ProxyHandler` would intercept property access on a `LoroDoc` proxy. The `get` trap would resolve property names to root containers (e.g., `doc.getMap(prop)`), and the `set` trap would create new root-level containers.
2.  **Update the `change` function**: Modify the `change` function to create a proxy around the `LoroDoc` instance itself, not the hardcoded `doc.getMap("root")`.
3.  **Update the `from` function**: Modify the `from` function to iterate over the initial state object and create a named root container for each key-value pair, leveraging the new proxy mechanism.
4.  **Refactor `createProxy`**: Generalize the `createProxy` helper function to handle both `LoroDoc` and individual `Container` types.
5.  **Adjust Type Definitions**: Update TypeScript types to reflect the new `LoroDoc`-centric structure.
6.  **Update Tests**: Write new tests to validate the new API.

## 3. Implementation and Challenges

Steps 1, 2, and 4 were completed successfully. A `docProxyHandler` was implemented, and the `change` and `createProxy` functions were updated to use it. However, the implementation of the `from` function (Step 3) exposed a fundamental architectural challenge that ultimately halted the effort.

### The Core Problem: Grafting Detached Containers

The central issue lies in the interaction between the `toLoroValue` utility and the `LoroDoc` API.

1.  **`toLoroValue` Creates Detached Containers**: The `toLoroValue` function recursively converts a plain JavaScript object into a tree of _detached_ Loro containers. For example, `toLoroValue({ a: 1 })` returns a `LoroMap` instance that is not yet part of any `LoroDoc`.

2.  **`docProxyHandler.set` Receives Detached Containers**: When the `from` function executes `d[key] = initialState[key]`, it triggers the `docProxyHandler`'s `set` trap. This trap receives the detached container created by `toLoroValue`.

3.  **No Direct API for Attaching Containers**: The `loro-crdt` library does not provide a direct API to "graft" or "attach" an existing, populated, detached container as a new root-level container in a `LoroDoc`. Methods like `doc.getMap(key)` or `doc.getList(key)` _create and return a new, empty, attached container_.

This mismatch led to a significant problem: how do you transfer the state from the detached container (returned by `toLoroValue`) into the newly created attached container (returned by `doc.getMap(key)`)?

### Attempted Solutions and Why They Failed

1.  **Simplistic Iteration in `from`**:

    - **Attempt**: The initial attempt was to simply loop through the initial state in the `from` function: `for (const key in initialState) { d[key] = initialState[key] }`.
    - **Failure**: This relied on the `docProxyHandler.set` method to perform the complex task of grafting the container tree. The initial implementation of the `set` handler was incorrect, as it did not account for this complexity.

2.  **Recursive Copying in `set` Handler**:

    - **Attempt**: A more sophisticated `set` handler was considered. The idea was that upon receiving a detached container, the handler would create a new attached container of the same type (e.g., `doc.getMap(key)`) and then recursively copy the key-value pairs from the detached container to the attached one.
    - **Failure**: This approach is highly complex and inefficient. It essentially requires re-implementing a deep-copy mechanism specifically for Loro containers, which defeats the purpose of the `toLoroValue` function. It also introduces significant performance overhead, especially for large initial states.

3.  **Modifying `toLoroValue`**:
    - **Idea**: We discussed refactoring `toLoroValue` to accept a parent container as an argument. This would allow it to build the CRDT structure in-place, creating attached containers from the start, rather than detached ones.
    - **Challenge**: This would be a major rewrite of the library's core logic and would tightly couple the value conversion process to the container hierarchy, making it less modular.

## 4. Conclusion and Recommendation

The refactoring effort was paused because the `loro-crdt` API's design does not easily support the intended approach. The lack of a direct method to attach a pre-populated, detached container as a new root container in a `LoroDoc` is the primary blocker.

**Recommendation for Future Developers:**

Before proceeding with this refactoring, it is recommended to investigate whether the `loro-crdt` library can be extended to support this "grafting" functionality. A feature request or contribution to the core library to add `doc.setContainer(name, detachedContainer)` would likely be the most effective path forward. Without such a change, any attempt to implement this feature in the `@loro-extended/change` library will likely result in the same complex and inefficient workarounds described above.
