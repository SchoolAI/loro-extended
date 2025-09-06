// Main API exports
export { change, createTypedDoc, TypedLoroDoc } from "./change.js"

// Schema and type exports
export { Shape } from "./schema.js"
export type {
  // Schema node types
  DocumentShape,
  ContainerShape,
  ContainerOrValueShape,
  RootContainerType,
  // Container shapes
  CounterContainerShape,
  ListContainerShape,
  MapContainerShape,
  MovableListContainerShape,
  TextContainerShape,
  TreeContainerShape,
  // Value shapes
  ValueShape,
  ArrayValueShape,
  // ...
  // Type inference
  InferValueType,
  InferInputType,
  Draft,
} from "./schema.js"

// Utility exports
export { createEmptyStateValidator } from "./validation.js"
export { overlayEmptyState, mergeValue } from "./overlay.js"
export { convertInputToContainer, isLoroSchema } from "./conversion.js"
