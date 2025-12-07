// Main API exports

export {
  derivePlaceholder,
  deriveShapePlaceholder,
} from "./derive-placeholder.js"
export { mergeValue, overlayPlaceholder } from "./overlay.js"
export type { ObjectValue, PresenceInterface } from "./presence-interface.js"
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
  // WithPlaceholder type for shapes that support .placeholder()
  WithPlaceholder,
} from "./shape.js"
// Schema and type exports
export { Shape } from "./shape.js"
export { createTypedDoc, TypedDoc } from "./typed-doc.js"
export { TypedPresence } from "./typed-presence.js"
export type {
  DeepReadonly,
  /** @deprecated Use Mutable instead */
  Draft,
  // Type inference - Infer<T> is the recommended unified helper
  Infer,
  /** @deprecated Use InferMutableType instead */
  InferDraftType,
  InferMutableType,
  InferPlaceholderType,
  Mutable,
} from "./types.js"
// Utility exports
export { validatePlaceholder } from "./validation.js"
