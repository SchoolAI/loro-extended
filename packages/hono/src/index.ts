// Re-export schema-related types
export type {
  DeepReadonly,
  DocShape,
  Infer,
  Mutable,
} from "@loro-extended/change"
export { Shape } from "@loro-extended/change"

// Re-export handle types
export type { DocId, TypedDocHandle } from "@loro-extended/repo"

// Hooks
export {
  RepoContext,
  useDoc,
  useHandle,
  usePresence,
  useRepo,
} from "./hooks-core.js"

// Context provider
export * from "./repo-context.js"
