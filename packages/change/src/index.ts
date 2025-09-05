// Main API exports
export { change, createTypedDoc, TypedLoroDoc } from "./change.js"

// Schema and type exports
export { LoroShape } from "./schema.js"
export type {
  // Schema node types
  LoroDocShape,
  MapContainerShape,
  ListContainerShape,
  MovableListContainerShape,
  TextContainerShape,
  CounterContainerShape,
  TreeContainerShape,
  ValueShape as LeafShape,
  ContainerShape as LoroRootContainerShape,
  ContainerOrValueShape as LoroIntermediateContainerShape,
  RootContainerType as LoroRootContainerType,
  // Type inference
  InferValueType,
  InferInputType,
  Draft,
} from "./schema.js"

// Utility exports
export { createEmptyStateValidator } from "./validation.js"
export { overlayEmptyState, mergeValue } from "./overlay.js"
export { convertInputToContainer, isLoroSchema } from "./conversion.js"
