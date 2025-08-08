# Loro Extended Utilities

This monorepo contains a collection of packages that extend the functionality of the [Loro](https://github.com/loro-dev/loro) CRDT library.

## Packages

-   **`packages/change`**: A utility that provides a simple, Immer-style `change()` method for mutating Loro documents.
    -   [View Package README](./packages/change/README.md)

-   **`packages/repo`**: A peer-to-peer document syncing repository, with plugable storage and network adapters.
    -   [View Package README](./packages/repo/README.md)

-   **`examples/todo-app`**: An example implementation of a React + Vite + ExpressJS app using `@loro-extended/change` and `@loro-extended/repo`.
    -   [View Package README](./examples/todo-app/README.md)
