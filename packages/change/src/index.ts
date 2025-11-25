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
  // Schema node types
  DocShape,
  ListContainerShape,
  MapContainerShape,
  MovableListContainerShape,
  RecordContainerShape,
  RecordValueShape,
  TextContainerShape,
  TreeContainerShape,
  // Value shapes
  ValueShape,
  // ...
} from "./shape.js"
// Schema and type exports
export { Shape } from "./shape.js"
export type {
  Draft,
  InferDraftType,
  // Type inference
  InferPlainType,
} from "./types.js"
// Utility exports
export { validateEmptyState } from "./validation.js"
