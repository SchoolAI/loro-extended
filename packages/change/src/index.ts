// Main API exports
export { createTypedDoc, TypedDoc } from "./change.js"

// Schema and type exports
export { Shape } from "./schema.js"
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
  TextContainerShape,
  TreeContainerShape,
  // Value shapes
  ValueShape,
  ArrayValueShape,
  // ...
  // Type inference
  InferPlainType,
  Draft,
} from "./schema.js"

// Utility exports
export { validateEmptyState } from "./validation.js"
export { overlayEmptyState, mergeValue } from "./overlay.js"
export { convertInputToContainer, isLoroSchema } from "./conversion.js"
