// Re-export schema-related types
export type {
  DocShape,
  Infer,
  Mutable,
} from "@loro-extended/change"
export { change, getLoroDoc, Shape } from "@loro-extended/change"

// Re-export handle types
export type { DocId, Handle } from "@loro-extended/repo"

// Hooks
export {
  RepoContext,
  useDoc,
  useEphemeral,
  useHandle,
  usePresence,
  useRepo,
} from "./hooks-core.js"

// Context provider
export * from "./repo-context.js"
