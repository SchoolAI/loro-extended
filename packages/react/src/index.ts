// Re-export schema-related types from @loro-extended/change
export type {
  DocShape,
  Infer,
  Mutable,
  TextRef,
} from "@loro-extended/change"
export { change, getLoroDoc, Shape } from "@loro-extended/change"
// Re-export hook types from @loro-extended/hooks-core
export type {
  UseCollaborativeTextOptions,
  UseCollaborativeTextReturn,
  UseUndoManagerOptions,
  UseUndoManagerReturn,
} from "@loro-extended/hooks-core"
// Re-export handle types from @loro-extended/repo
export type { DocId, Handle } from "@loro-extended/repo"

// Hooks
export {
  RepoContext,
  useCollaborativeText,
  useDoc,
  useEphemeral,
  useHandle,
  usePresence,
  useRepo,
  useUndoManager,
} from "./hooks-core.js"

// Context provider
export * from "./repo-context.js"
