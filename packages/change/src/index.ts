// Main API exports
export { change, createTypedDoc, TypedLoroDoc } from "./change.js"

// Schema and type exports
export { LoroShape } from "./schema.js"
export type {
  // Schema node types
  LoroDocShape,
  LoroMapShape,
  LoroListShape,
  LoroMovableListShape,
  LoroTextShape,
  LoroCounterShape,
  LoroTreeShape,
  LoroLeafShape,
  LoroRootContainerShape,
  LoroIntermediateContainerShape,
  LoroRootContainerType,
  // Type inference
  InferValueType,
  InferDraftType,
  InferInputType,
  LoroAwareDraft,
} from "./schema.js"

// Utility exports
export { createEmptyStateValidator } from "./validation.js"
export { overlayEmptyState, mergeValue } from "./overlay.js"
export { convertInputToContainer, isLoroSchema } from "./conversion.js"
