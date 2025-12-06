# @loro-extended/change

## 0.7.0

### Minor Changes

- ab2d939: Deprecate InferPlainType<> type helper in favor of Infer<>; fix a type invariance bug with discriminatedUnion

## 0.6.0

### Minor Changes

- 26ca4cd: Fix an issue with null-unioned Shapes, where null could be misinterpreted as undefined
- b9da0e9: Prevent empty state in useDocument or TypedDoc where empty state includes invalid state--for example, in `Record` or `List` Shape types. The type system previously implied you could pre-populate a list or record with empty state. This is not the case--empty state is not merged in for shape types that do not have pre-defined keys.

## 0.5.0

## 0.4.0

### Minor Changes

- Accurate and fast presence updates

## 0.3.0

### Minor Changes

- 6d95249: Consistent ReadyState and additional tests

## 0.2.0

### Minor Changes

- Release 0.2.0
