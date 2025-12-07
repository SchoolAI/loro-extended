// Re-export schema-related types from @loro-extended/change for convenience
export type {
  DocShape,
  /** @deprecated Use Mutable instead */
  Draft,
  Mutable,
} from "@loro-extended/change"
export { Shape } from "@loro-extended/change"
// Common types
export type {
  ChangeFn,
  DocWrapper,
  SimpleChangeFn,
} from "@loro-extended/hooks-core"
// Base hooks for advanced usage
// Typed hooks - require @loro-extended/change
export {
  useDocChanger,
  useDocHandleState,
  useDocument,
  usePresence,
  useRawLoroDoc,
  useTypedDocChanger,
  useTypedDocState,
  useUntypedDocChanger,
  useUntypedDocument,
  useUntypedPresence,
} from "./hooks-core.js"

export * from "./repo-context.js"
