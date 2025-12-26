// Main API exports

export {
  derivePlaceholder,
  deriveShapePlaceholder,
} from "./derive-placeholder.js"
// Functional helpers (recommended API)
export { change, getLoroDoc } from "./functional-helpers.js"
export { mergeValue, overlayPlaceholder } from "./overlay.js"
// Path selector DSL exports
export { createPathBuilder } from "./path-builder.js"
export { compileToJsonPath, hasWildcard } from "./path-compiler.js"
export { evaluatePath, evaluatePathOnValue } from "./path-evaluator.js"
export type {
  PathBuilder,
  PathNode,
  PathSegment,
  PathSelector,
} from "./path-selector.js"
export { createPlaceholderProxy } from "./placeholder-proxy.js"
export type {
  // Escape hatch shapes for untyped integration
  AnyContainerShape,
  AnyValueShape,
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
  /** @deprecated Use StructContainerShape instead */
  MapContainerShape,
  MovableListContainerShape,
  /** @deprecated Use StructValueShape instead */
  ObjectValueShape,
  RecordContainerShape,
  RecordValueShape,
  StructContainerShape,
  StructValueShape,
  TextContainerShape,
  TreeContainerShape,
  UnionValueShape,
  // Value shapes
  ValueShape,
  // WithNullable type for shapes that support .nullable()
  WithNullable,
  // WithPlaceholder type for shapes that support .placeholder()
  WithPlaceholder,
} from "./shape.js"
// Schema and type exports
export { Shape } from "./shape.js"
export type { TypedDoc } from "./typed-doc.js"
export { createTypedDoc } from "./typed-doc.js"
export type {
  // Type inference - Infer<T> is the recommended unified helper
  Infer,
  InferMutableType,
  InferPlaceholderType,
  Mutable,
} from "./types.js"
// Utility exports
export { validatePlaceholder } from "./validation.js"
