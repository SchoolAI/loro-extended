// Main API exports
export { createTypedDoc, TypedDoc } from "./change.js"
export { mergeValue, overlayEmptyState } from "./overlay.js"
export type {
  ArrayValueShape,
  ContainerOrValueShape,
  ContainerShape,
  ContainerType as RootContainerType,
  // Container shapes
  CounterContainerShape,
  // Discriminated union for tagged unions
  DiscriminatedUnionValueShape,
  // Schema node types
  DocShape,
  ListContainerShape,
  MapContainerShape,
  MovableListContainerShape,
  ObjectValueShape,
  RecordContainerShape,
  RecordValueShape,
  TextContainerShape,
  TreeContainerShape,
  UnionValueShape,
  // Value shapes
  ValueShape,
  // ...
} from "./shape.js"
// Schema and type exports
export { Shape } from "./shape.js"
export type {
  Draft,
  // Type inference - Infer<T> is the recommended unified helper
  Infer,
  InferDraftType,
  InferEmptyStateType,
  InferPlainType,
} from "./types.js"
// Utility exports
export { validateEmptyState } from "./validation.js"
