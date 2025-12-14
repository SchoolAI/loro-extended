# @loro-extended/adapter-websocket

## 1.0.0

### Patch Changes

- Updated dependencies [5d8cfdb]
- Updated dependencies [dafd365]
  - @loro-extended/repo@1.0.0

## 0.9.1

### Patch Changes

- ede3f25: Improved reconnection logic and reliability:
  - Server: Fixed a channel leak where old connections were not cleaned up when a peer reconnected.
  - Client: Added connection state tracking (`disconnected`, `connecting`, `connected`, `reconnecting`).
  - Client: Preserves the channel during transient network failures, reducing re-sync overhead.
  - Client: Added retry logic with exponential backoff for failed POST requests.
  - Client: Added `reconnect` and `postRetry` options to `SseClientNetworkAdapter` configuration.
  - WebSocket: Added connection state tracking and subscription mechanism to `WsClientNetworkAdapter`.
  - HTTP Polling: Added connection state tracking and subscription mechanism to `HttpPollingClientNetworkAdapter`.
  - HTTP Polling: Added retry logic with exponential backoff for failed POST requests.
  - @loro-extended/repo@0.9.1

## 0.9.0

### Patch Changes

- d9ea24e: Add strongly typed `TypedDocHandle` from `Repo.get()`

  ## New Features

  ### TypedDocHandle

  `Repo.get()` now supports typed document and presence schemas:

  ```typescript
  import { Shape } from "@loro-extended/change";

  const DocSchema = Shape.doc({
    title: Shape.text(),
    count: Shape.counter(),
  });

  const PresenceSchema = Shape.plain.object({
    cursor: Shape.plain.object({
      x: Shape.plain.number(),
      y: Shape.plain.number(),
    }),
    name: Shape.plain.string().placeholder("Anonymous"),
  });

  // Get a typed handle with doc and presence schemas
  const handle = repo.get("my-doc", DocSchema, PresenceSchema);

  // Type-safe document mutations
  handle.doc.change((draft) => {
    draft.title.insert(0, "Hello");
    draft.count.increment(1);
  });

  // Type-safe presence with placeholder defaults
  handle.presence.set({ cursor: { x: 100, y: 200 } });
  console.log(handle.presence.self.name); // "Anonymous" (from placeholder)
  ```

  ### API Changes

  - **`repo.get(docId, docShape, presenceShape)`** - Returns `TypedDocHandle<D, P>` with typed `doc` and `presence`
  - **`repo.get(docId, docShape)`** - Returns `TypedDocHandle<D, ValueShape>` with typed `doc`
  - **`repo.get(docId)`** - Returns `UntypedDocHandle` (backward compatible)
  - **`repo.getUntyped(docId)`** - Explicit method to get `UntypedDocHandle`

  ### TypedPresence moved to @loro-extended/change

  `TypedPresence` is now exported from `@loro-extended/change` and works with any `PresenceInterface`:

  ```typescript
  import { TypedPresence, Shape } from "@loro-extended/change";

  const typedPresence = new TypedPresence(PresenceSchema, handle.presence);
  ```

  ### Breaking Changes

  - `DocHandle` renamed to `UntypedDocHandle` (alias provided for backward compatibility)
  - `handle.untypedPresence` renamed to `handle.presence`
  - `TypedPresence` moved from `@loro-extended/repo` to `@loro-extended/change`

  ### Backward Compatibility

  - `DocHandle` is re-exported as an alias for `UntypedDocHandle`
  - `repo.get(docId)` without schemas returns `UntypedDocHandle` as before
  - `TypedPresence` is re-exported from `@loro-extended/repo` for compatibility

- Updated dependencies [9ba361d]
- Updated dependencies [d9ea24e]
- Updated dependencies [702af3c]
  - @loro-extended/repo@0.9.0

## 0.8.1

### Patch Changes

- a6d3fc8: Need to publish hooks-core
- Updated dependencies [a6d3fc8]
  - @loro-extended/repo@0.8.1

## 0.8.0

### Patch Changes

- Updated dependencies [907cdce]
  - @loro-extended/repo@0.8.0

## 0.7.0

### Patch Changes

- Updated dependencies [a26a6c2]
- Updated dependencies [0879e51]
  - @loro-extended/repo@0.7.0

## 0.6.0

### Patch Changes

- Updated dependencies [c67e26c]
- Updated dependencies [76a18ba]
  - @loro-extended/repo@0.6.0

## 0.2.0

### Minor Changes

- e4be1d7: Add websocket network adapter (client/server) using Loro Websocket Protocol
- dcb0aec: Fix an issue where return sync-request was not being made in websocket adapter. For now, use authPayload as a hack to cover this mismatch between our protocol and Loro Websocket Protocol.

### Patch Changes

- Updated dependencies [9b291dc]
- Updated dependencies [204fda2]
  - @loro-extended/repo@0.5.0
