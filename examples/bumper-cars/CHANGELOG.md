# example-bumper-cars

## 0.1.5

### Patch Changes

- a083e1f: Upgraded bumper-cars example to use new TypedDocHandle and TypedPresence APIs

  - Simplified GameLoop constructor from 3 parameters to 1 (TypedDocHandle)
  - Replaced `createTypedDoc()` pattern with direct `handle.change(draft => ...)`
  - Replaced manual presence callbacks with `handle.presence.all` and `handle.presence.set()`
  - Updated server.ts to use `repo.get(docId, docShape, presenceShape)` for type-safe handle
  - Reduced ~25 lines of boilerplate code and eliminated manual type casting

- Updated dependencies [492af24]
- Updated dependencies [9ba361d]
- Updated dependencies [173be61]
- Updated dependencies [463c5b4]
- Updated dependencies [8de0ce7]
- Updated dependencies [e2dcf3f]
- Updated dependencies [d9ea24e]
- Updated dependencies [702af3c]
  - @loro-extended/change@0.9.0
  - @loro-extended/repo@0.9.0
  - @loro-extended/adapter-websocket@0.9.0
  - @loro-extended/react@0.9.0
  - @loro-extended/adapter-leveldb@0.9.0

## 0.1.4

### Patch Changes

- a6d3fc8: Need to publish hooks-core
- Updated dependencies [a6d3fc8]
  - @loro-extended/adapter-leveldb@0.8.1
  - @loro-extended/adapter-websocket@0.8.1
  - @loro-extended/change@0.8.1
  - @loro-extended/react@0.8.1
  - @loro-extended/repo@0.8.1

## 0.1.3

### Patch Changes

- Updated dependencies [1a80326]
- Updated dependencies [3599dae]
- Updated dependencies [907cdce]
- Updated dependencies [90f1c84]
  - @loro-extended/change@0.8.0
  - @loro-extended/react@0.8.0
  - @loro-extended/repo@0.8.0
  - @loro-extended/adapter-leveldb@0.8.0
  - @loro-extended/adapter-websocket@0.8.0

## 0.1.2

### Patch Changes

- Updated dependencies [ab2d939]
- Updated dependencies [a26a6c2]
- Updated dependencies [0879e51]
  - @loro-extended/change@0.7.0
  - @loro-extended/repo@0.7.0
  - @loro-extended/react@0.7.0
  - @loro-extended/adapter-leveldb@0.7.0
  - @loro-extended/adapter-websocket@0.7.0

## 0.1.1

### Patch Changes

- Updated dependencies [26ca4cd]
- Updated dependencies [b9da0e9]
- Updated dependencies [c67e26c]
- Updated dependencies [76a18ba]
  - @loro-extended/change@0.6.0
  - @loro-extended/react@0.6.0
  - @loro-extended/repo@0.6.0
  - @loro-extended/adapter-websocket@0.6.0
  - @loro-extended/adapter-leveldb@0.6.0
