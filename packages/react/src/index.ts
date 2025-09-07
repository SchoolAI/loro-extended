// Re-export schema-related types from @loro-extended/change for convenience
export type {
  Draft,
  DocShape,
  InferPlainType,
} from "@loro-extended/change"
export { Shape } from "@loro-extended/change"
export type { SimpleChangeFn } from "./hooks/use-doc-changer.js"

// Base hooks for advanced usage
export { useDocChanger, useSimpleDocChanger } from "./hooks/use-doc-changer.js"

// Common types
export type { DocWrapper } from "./hooks/use-doc-handle-state.js"
export {
  useDocHandleState,
  useRawLoroDoc,
} from "./hooks/use-doc-handle-state.js"
export type { UseDocumentReturn } from "./hooks/use-document.js"

// Typed hooks - require @loro-extended/change
export { useDocument } from "./hooks/use-document.js"
export type { UseSimpleDocumentReturn } from "./hooks/use-simple-document.js"
export { useSimpleDocument } from "./hooks/use-simple-document.js"
export type { ChangeFn } from "./hooks/use-typed-doc-changer.js"
export { useTypedDocChanger } from "./hooks/use-typed-doc-changer.js"
export { useTypedDocState } from "./hooks/use-typed-doc-state.js"

export * from "./repo-context.js"
