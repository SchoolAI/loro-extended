// Main API exports

// Change options for commit messages
export {
  type ChangeOptions,
  serializeCommitMessage,
} from "./change-options.js"
export {
  derivePlaceholder,
  deriveShapePlaceholder,
} from "./derive-placeholder.js"
// Diff overlay--make the TypedDoc return values as if a diff is applied
export { createDiffOverlay } from "./diff-overlay.js"
// The ext() function for loro-extended-specific features
export {
  EXT_SYMBOL,
  type ExtDocRef,
  type ExtListRef,
  type ExtMapRef,
  type ExtRefBase,
  ext,
} from "./ext.js"
export type { Transition } from "./functional-helpers.js"
// Functional helpers (recommended API)
export { change, getTransition, subscribe } from "./functional-helpers.js"
// The loro() escape hatch for native Loro types
export { LORO_SYMBOL, loro } from "./loro.js"
export type { LoroExtendedMeta } from "./metadata.js"
// Document metadata utilities
export {
  hasMetadata,
  isLoroExtendedReservedKey,
  LORO_EXTENDED_PREFIX,
  META_CONTAINER_NAME,
  readMetadata,
  writeMetadata,
} from "./metadata.js"
// Regular placeholder overlay
export { mergeValue, overlayPlaceholder } from "./overlay.js"
// Path selector DSL exports
export { createPathBuilder } from "./path-builder.js"
export { compileToJsonPath, hasWildcard } from "./path-compiler.js"
// Path encoding for flattened root container storage (mergeable containers)
export {
  buildRootContainerName,
  escapePathSegment,
  parseRootContainerName,
} from "./path-encoding.js"
export { evaluatePath, evaluatePathOnValue } from "./path-evaluator.js"
export type {
  PathBuilder,
  PathNode,
  PathSegment,
  PathSelector,
} from "./path-selector.js"
// Path subscription utilities
export {
  requiresGlobalSubscription,
  subscribeToPath,
} from "./path-subscription.js"
export { createPlaceholderProxy } from "./placeholder-proxy.js"
// PlainValueRef - Reactive subscriptions for plain values
export type { PlainValueRef } from "./plain-value-ref/index.js"
export {
  createPlainValueRef,
  getPlainValueRefParentInternals,
  getPlainValueRefPath,
  isPlainValueRef,
  PLAIN_VALUE_REF_SYMBOL,
} from "./plain-value-ref/index.js"
export { replayDiff } from "./replay-diff.js"
// Doc shapes
// Container shapes
// Value shapes
// Shape utilities
export type {
  AnyContainerShape,
  AnyValueShape,
  ArrayValueShape,
  BooleanValueShape,
  // A shape type representing any container-type or value-type shape (excludes DocShape)
  ContainerOrValueShape,
  // A shape type representing any container-type shape
  ContainerShape,
  ContainerType as RootContainerType,
  CounterContainerShape,
  // Tagged union of two or more plain value types
  DiscriminatedUnionValueShape,
  DocShape,
  // Options for configuring a document schema
  DocShapeOptions,
  ListContainerShape,
  MovableListContainerShape,
  NullValueShape,
  NumberValueShape,
  RecordContainerShape,
  RecordValueShape,
  StringValueShape,
  StructContainerShape,
  StructValueShape,
  TextContainerShape,
  TreeContainerShape,
  TreeNodeJSON,
  TreeRefInterface,
  Uint8ArrayValueShape,
  UndefinedValueShape,
  // Union of two or more plain value types
  UnionValueShape,
  // A shape type representing any value-type shape
  ValueShape,
  // WithNullable type for shapes that support .nullable()
  WithNullable,
  // WithPlaceholder type for shapes that support .placeholder()
  WithPlaceholder,
} from "./shape.js"
// Schema and type exports
export { Shape } from "./shape.js"
export type { Frontiers, TypedDoc } from "./typed-doc.js"
export { createTypedDoc } from "./typed-doc.js"
// Typed ref types - for specifying types with the loro() function
export type {
  CounterRef,
  DiffOverlay,
  ListRef,
  MovableListRef,
  RecordRef,
  StructRef,
  TextRef,
  TreeNodeRef,
  TreeRef,
} from "./typed-refs/index.js"
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
// The value() function for unwrapping reactive wrappers
// The unwrap() helper for conditionally unwrapping PlainValueRef
export { unwrap, value } from "./value.js"
