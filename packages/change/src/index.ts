// Main API exports

export {
  derivePlaceholder,
  deriveShapePlaceholder,
} from "./derive-placeholder.js"
// Functional helpers (recommended API)
export { change, getLoroContainer, getLoroDoc } from "./functional-helpers.js"
// The loro() escape hatch for CRDT internals
export {
  LORO_SYMBOL,
  type LoroCounterRef,
  type LoroListRef,
  type LoroMapRef,
  type LoroRefBase,
  type LoroTextRef,
  type LoroTreeRef,
  type LoroTypedDocRef,
  loro,
} from "./loro.js"
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
  // Tree-related types
  TreeNodeJSON,
  TreeRefInterface,
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
// Typed ref types - for specifying types with the loro() function
export type { CounterRef } from "./typed-refs/counter-ref.js"
export type { ListRef } from "./typed-refs/list-ref.js"
export type { MovableListRef } from "./typed-refs/movable-list-ref.js"
export type { RecordRef } from "./typed-refs/record-ref.js"
export type { StructRef } from "./typed-refs/struct-ref.js"
export type { TextRef } from "./typed-refs/text-ref.js"
export type { TreeNodeRef } from "./typed-refs/tree-node-ref.js"
export type { TreeRef } from "./typed-refs/tree-ref.js"
export type {
  // Type inference - Infer<T> is the recommended unified helper
  Infer,
  InferMutableType,
  InferPlaceholderType,
  // InferRaw<T> preserves type alias names (like TreeNodeJSON) in hover displays
  InferRaw,
  Mutable,
} from "./types.js"
// Utility exports
export { validatePlaceholder } from "./validation.js"
