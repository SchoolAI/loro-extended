// Re-export schema-related types
export type {
  DocShape,
  Infer,
  Mutable,
  TextRef,
} from "@loro-extended/change"
export { change, ext, loro, Shape } from "@loro-extended/change"
// Re-export hook types from @loro-extended/hooks-core
export type {
  UseCollaborativeTextOptions,
  UseCollaborativeTextReturn,
  UseUndoManagerOptions,
  UseUndoManagerReturn,
} from "@loro-extended/hooks-core"
// Re-export doc types
export type { Doc, DocId } from "@loro-extended/repo"
// Hooks
export {
  RepoContext,
  useCollaborativeText,
  useDocument,
  useEphemeral,
  useLens,
  usePlaceholder,
  useRepo,
  useUndoManager,
  useValue,
} from "./hooks-core.js"

// Context provider
export * from "./repo-context.js"
