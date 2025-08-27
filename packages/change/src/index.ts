// Main API exports
export { change, createTypedDoc, TypedLoroDoc } from "./change.js"

// Schema and type exports
export { LoroShape } from "./schema.js"
export type {
  // Schema node types
  LoroDocSchema,
  LoroMapSchemaNode,
  LoroListSchemaNode,
  LoroMovableListSchemaNode,
  LoroTextSchemaNode,
  LoroCounterSchemaNode,
  LoroTreeSchemaNode,
  LoroLeafSchemaNode,
  LoroRootContainerSchemaNode,
  LoroIntermediateContainerSchemaNode,
  LoroRootContainerType,
  LoroSchemaType,
  // Type inference
  InferValueType,
  InferDraftType,
  InferEmptyType,
  InferEmptyValue,
  InferInputType,
  LoroAwareDraft,
  // Rich text types
  TextRange,
  StyleValue,
  // Tree types
  TreeNodeID,
  TreeNode,
} from "./schema.js"

// Utility exports
export { createEmptyStateValidator } from "./validation.js"
export { overlayEmptyState, mergeValue } from "./overlay.js"
export { convertInputToContainer, isLoroSchema } from "./conversion.js"
