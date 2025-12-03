# @loro-extended/hono

## 0.6.0

### Minor Changes

- b9da0e9: Prevent empty state in useDocument or TypedDoc where empty state includes invalid state--for example, in `Record` or `List` Shape types. The type system previously implied you could pre-populate a list or record with empty state. This is not the case--empty state is not merged in for shape types that do not have pre-defined keys.

### Patch Changes

- Updated dependencies [c67e26c]
- Updated dependencies [76a18ba]
  - @loro-extended/repo@0.6.0

## 0.5.0

### Minor Changes

- dfcddc6: Fixed a race condition with indexeddb storage adapter

### Patch Changes

- Updated dependencies [9b291dc]
- Updated dependencies [204fda2]
  - @loro-extended/repo@0.5.0
