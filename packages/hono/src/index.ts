// Re-export schema-related types from @loro-extended/change for convenience
export type {
  DocShape,
  Draft,
} from "@loro-extended/change"
export { Shape } from "@loro-extended/change"
export type { SimpleChangeFn } from "@loro-extended/hooks-core"

// Base hooks for advanced usage
export { useDocChanger, useUntypedDocChanger } from "./hooks-core.js"

// Common types
export type { DocWrapper } from "@loro-extended/hooks-core"
export {
  useDocHandleState,
  useRawLoroDoc,
} from "./hooks-core.js"

// Typed hooks - require @loro-extended/change
export { useDocument } from "./hooks-core.js"
export { usePresence, useUntypedPresence } from "./hooks-core.js"
export type { ChangeFn } from "@loro-extended/hooks-core"
export { useTypedDocChanger } from "./hooks-core.js"
export { useTypedDocState } from "./hooks-core.js"
export { useUntypedDocument } from "./hooks-core.js"

export * from "./repo-context.js"
