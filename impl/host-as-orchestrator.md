The "Host-as-Orchestrator" Model

This is closer to the current architecture, where each "program" has a corresponding "host" class (Repo, DocHandle, Synchronizer). The host classes are responsible for executing commands and managing the asynchronous nature of the system.

The key flaw right now is the lack of a "back-channel" to communicate results from the state machine back to the original caller.

Let's refine this model. We can introduce the concept of a Promise-based callback mechanism.

How it Works:

When a public method like repo.create() is called, it generates a unique ID for that specific request.
It creates a Promise and stores its resolve and reject functions in a map, keyed by the request ID.
It dispatches the message to the repo-program, including the request ID.
The repo-program and doc-handle-program do their work. When the operation culminates in a final state (e.g., the handle is ready), the program issues a new kind of command, like report_success.
This command includes the original request ID and the result (e.g., the DocHandle instance).
The Repo host's #executeCommand function handles report_success, finds the corresponding Promise's resolve function in its map, and calls it with the result.
The Promise returned by the original repo.create() call resolves, giving the caller the DocHandle they were waiting for.
Diagram:

```mermaid
graph TD
    A[External Caller] -- 1. calls repo.create() --> B[Repo Host]
    subgraph B
        B1(2. Creates Promise & stores resolver)
        B2(3. dispatch({type: 'create', requestId: 'xyz'}))
    end
    B -- dispatches msg --> C[repo-program]
    C -- issues command --> D[doc-handle-program]
    D -- issues command --> E[doc-handle host]
    E -- executes effects --> E

    subgraph PurePrograms
        C -- issues command --> C
        D -- issues command --> D
    end

    E -- dispatches result --> D
    D -- issues report_success command --> C
    C -- issues report_success command --> B

    subgraph B
        B3(4. Receives command)
        B4(5. Finds resolver & resolves promise)
    end
    B -- 6. Returns resolved promise --> A

```

Pros:

Maintains Separation: It keeps the pure state machines pure. They don't know about Promises. They just deal with state transitions and commands as data.
Conceptual Simplicity (Relatively): The "host" classes remain the clear owners of side effects and asynchronicity. A developer can look at the Repo class to understand how it interacts with the outside world, and at the repo-program to understand the pure state logic. The composition is managed by the hosts calling each other's methods, which is a more familiar imperative-style interaction.
Solves the Async Bridge: It directly solves the problem of getting a result back to the initial caller. The public API can now be async and return Promise<DocHandle>.
Less Boilerplate than Full Composition: It avoids the complex mapEffect and mapProgram boilerplate.
Cons:

More "Impure" Logic: The hosts take on more responsibility. The logic for managing the request/response cycle with Promises lives in the "impure" host classes.
Potential for Race Conditions/Bugs: Managing the map of Promise resolvers needs to be done carefully to avoid memory leaks (e.g., if a reject is never called on a timeout).
