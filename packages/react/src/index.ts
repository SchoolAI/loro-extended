// Re-export schema-related types from @loro-extended/change
export type {
  DeepReadonly,
  DocShape,
  Infer,
  Mutable,
} from "@loro-extended/change"
export { Shape } from "@loro-extended/change"

// Re-export handle types from @loro-extended/repo
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
