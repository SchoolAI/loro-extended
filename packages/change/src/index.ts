// Main API exports
export { createTypedDoc, TypedDoc } from "./change.js"

// Schema and type exports
export { Shape } from "./shape.js"
export type {
  // Schema node types
  DocShape,
  ContainerShape,
  ContainerOrValueShape,
  ContainerType as RootContainerType,
  // Container shapes
  CounterContainerShape,
  ListContainerShape,
  MapContainerShape,
  MovableListContainerShape,
  RecordContainerShape,
  TextContainerShape,
  TreeContainerShape,
  // Value shapes
  ValueShape,
  ArrayValueShape,
  RecordValueShape,
  // ...
} from "./shape.js"

export type {
  // Type inference
  InferPlainType,
  InferDraftType,
  Draft,
} from "./types.js"

// Utility exports
export { validateEmptyState } from "./validation.js"
export { overlayEmptyState, mergeValue } from "./overlay.js"
