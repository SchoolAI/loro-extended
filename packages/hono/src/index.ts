// Re-export schema-related types
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
  UseRefValueReturn,
  UseUndoManagerOptions,
  UseUndoManagerReturn,
} from "@loro-extended/hooks-core"
// Re-export handle types
export type { DocId, Handle } from "@loro-extended/repo"

// Hooks
export {
  RepoContext,
  useCollaborativeText,
  useDoc,
  useEphemeral,
  useHandle,
  useRefValue,
  useRepo,
  useUndoManager,
} from "./hooks-core.js"

// Context provider
export * from "./repo-context.js"
