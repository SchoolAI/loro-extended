# Architectural Post-Mortem & Forward Guidance: The Host-as-Orchestrator Pattern

## 1. Introduction

The primary goal of this refactoring effort was to bridge the synchronous, pure world of our `raj-ts` state machines (`repo-program`, `doc-handle-program`) with the asynchronous, effectful world of the application. Specifically, we aimed to make the public API of the `Repo` class (e.g., `create`, `find`) asynchronous, returning a `Promise` that resolves with a `DocHandle` in a terminal state (`ready`, `unavailable`).

This document outlines the implementation path taken, analyzes the challenges encountered, and provides architectural guidance for a more successful subsequent attempt.

## 2. The Chosen Architecture: "Host-as-Orchestrator"

We adopted the "Host-as-Orchestrator" model, where each pure state machine ("program") is managed by a corresponding "host" class responsible for executing side effects. To solve the async bridge problem, we designed a `Promise`-based request/response cycle:

1.  A `Repo` method is called (e.g., `repo.create()`).
2.  A unique `requestId` is generated. A `Promise` is created, and its resolver functions are stored in a map keyed by the `requestId`.
3.  A message with the `requestId` is dispatched to the `repo-program`.
4.  The action flows through the state machines (`repo-program` -> `doc-handle-program`).
5.  Upon completion, the `DocHandle` enters a terminal state.
6.  The `Repo` host, listening for `state-change` events from the `DocHandle`, uses the `documentId` to look up the `requestId` and resolve the appropriate promise.

## 3. Implementation Attempt: What We Did

We executed the following steps to implement the above architecture:

-   **State Machine Refactoring:** Modified `repo-program.ts` to add a `requestId` to its messages (`CreateMessage`, etc.) and its primary command (`GetHandleCommand`). This correctly threaded the request context through the pure state logic.
-   **Promise Management:** Implemented the `#pendingRequests` and `#documentIdToRequestId` maps in the `Repo` class to track in-flight operations.
-   **API Changes:** Correctly modified the `Repo`'s public API (`create`, `find`, `findOrCreate`) to be `async` and return a `Promise`.
-   **Event-based Resolution:** Hooked into the `DocHandle`'s `state-change` event within the `Repo.#getHandle` method. The handler was responsible for looking up and resolving the pending promise when the handle's state became `ready` or `unavailable`.
-   **Bug Fixes:**
    -   Corrected a logic error in `doc-handle-program.ts` where the `idle` state did not properly handle a `storage_load_success` message, which is critical for the `create` flow.
    -   Fixed the `InMemoryStorageAdapter` to return `null` instead of `undefined` for a missing document, aligning it with the test assertions.
-   **Test Refactoring:** Modified the `vitest` tests to use a non-blocking `await` pattern (`const p = repo.create(); await vi.runAllTimersAsync(); await p;`) to attempt to solve a deadlock with fake timers.

## 4. Analysis: What Went Wrong

Despite the implementation appearing logically sound, the tests consistently failed with timeouts. The root cause was a subtle but critical deadlock between the asynchronous host and the testing environment.

**The Deadlock:**
1.  A test calls `await repo.find()`. The test's execution thread is now paused, waiting for the promise to resolve.
2.  The `repo.find()` method synchronously dispatches a message that eventually causes a `DocHandle` to be created and to execute a command that involves a `setTimeout` (e.g., the network timeout simulation).
3.  The promise returned by `repo.find()` can only be resolved by the `Repo`'s `state-change` listener.
4.  The `state-change` listener will only fire when the `DocHandle`'s state actually changes to `ready` or `unavailable`.
5.  This state change depends on the `setTimeout` from step 2 firing.
6.  Because we use fake timers, the `setTimeout` will *only* fire when the test explicitly calls `vi.runAllTimersAsync()`.
7.  The test *cannot* call `vi.runAllTimersAsync()` because its execution is paused at `await repo.find()`.

The attempt to fix this with a non-blocking await pattern also failed, indicating the issue is more deeply rooted in the architecture of the promise resolution itself.

**The Core Architectural Flaw:** The `Repo` (the parent/creator) relies on listening to a generic, decoupled event (`state-change`) from the `DocHandle` (the child/product) to fulfill the promise of the `DocHandle`'s own creation and initialization. This creates a circular dependency when operating in a single-threaded, fake-timed test environment.

## 5. Architectural Guidance for the Next Attempt

The "Host-as-Orchestrator" model remains a viable approach, but the mechanism for bridging the async gap must be more direct and explicit to avoid this circular dependency.

**Recommendation: Callback-based `executeCommand`**

Instead of relying on event listeners, the `Promise`'s `resolve` function should be passed down directly as part of the command chain.

1.  **Modify the `Repo`'s Public API:**
    -   When `repo.create()` is called, create the `Promise` as before.
    -   Dispatch the `create` message to the `repo-program`. This part remains the same. The `requestId` is still essential for tracking.

2.  **Modify `Repo.#executeCommand`:**
    -   Do not pass a simple data object. Instead, the `effectWrapper` should be prepared to handle a command that includes the promise resolvers.
    -   `#executeCommand` for a `get_handle` command should retrieve the `resolve` and `reject` functions from the `#pendingRequests` map using the `requestId` from the command.
    -   It should then call `#getHandle`, which creates the `DocHandle` instance.
    -   Crucially, it will then call `handle.whenReady().then(resolve).catch(reject)`.

**Revised Flow:**

1.  Test calls `repo.create()`.
2.  `repo.create` creates a promise, stores its resolvers, and dispatches a `{ type: 'create', ... }` message. It returns the promise.
3.  The `repo-program` issues a `get_handle` command.
4.  The `Repo`'s `#executeCommand` for `get_handle` does the following:
    a. Looks up the `{ resolve, reject }` pair using the `requestId` from the command.
    b. Calls `#getHandle` to get the (currently `idle`) handle.
    c. Calls `handle.create()` to kick off the handle's internal state machine.
    d. **Attaches the `resolve` and `reject` functions directly to the handle's `whenReady()` promise:** `handle.whenReady().then(status => resolve(handle), reject)`.
    e. Cleans up the pending request maps.
5.  The test can now safely `await` the original promise. When `vi.runAllTimersAsync()` is called, the handle's internal state machine will run, `whenReady()` will resolve, and that will, in turn, resolve the test's promise.

This approach breaks the deadlock by creating a direct, explicit link between the request's promise and the specific `DocHandle` instance's `whenReady()` promise, completely bypassing the problematic `state-change` listener for promise resolution. It is a more robust and testable implementation of the "Host-as-Orchestrator" pattern.
## 6. Hindsight and Alternative Strategy: A Bottom-Up Approach

In retrospect, the top-down approach to this refactor—starting from the `Repo`'s public API—was a primary contributor to the challenges we faced. It forced us to immediately confront complex integration issues between the `Repo`, the `DocHandle`, and the `vitest` fake timer environment, making the root cause of the test deadlocks difficult to isolate.

A more effective strategy would have been to work from the bottom up, starting with the `DocHandle`.

### The Bottom-Up Advantage

The core architectural challenge is bridging the synchronous `doc-handle-program` with its asynchronous, effectful host, the `DocHandle` class. By isolating this component, we could have perfected this "async seam" before introducing any other complexity.

1.  **Isolate the Core Problem:** The first goal should be to make `new DocHandle('id').find()` and `new DocHandle('id').create()` work flawlessly in a test environment. This focuses all effort on the interaction between a single host and its program.
2.  **TDD as a Guiding Force:** A test-driven approach would have quickly revealed the fake timer deadlock, but in the much simpler context of `doc-handle.test.ts`. Solving it here would have been faster and would have resulted in a verifiably robust component.
3.  **Build on a Solid Foundation:** Once `DocHandle` is a reliable, self-contained unit with a comprehensive passing test suite, a `Repo` can be built on top of it. The `Repo`'s role would be greatly simplified to that of a factory and collection manager for these reliable components, rather than being an active participant in their complex internal lifecycles.

By perfecting the smallest moving part first, we ensure that as the system grows, we are always building on a foundation of proven, reliable components.