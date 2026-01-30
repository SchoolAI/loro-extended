// Re-export schema-related types from @loro-extended/change
export type {
  CounterRef,
  DocShape,
  Infer,
  ListRef,
  MovableListRef,
  Mutable,
  RecordRef,
  StructRef,
  TextRef,
  TreeRef,
} from "@loro-extended/change"
export { change, getLoroDoc, Shape } from "@loro-extended/change"
// Re-export hook types from @loro-extended/hooks-core
export type {
  Lens,
  LensOptions,
  UseCollaborativeTextOptions,
  UseCollaborativeTextReturn,
  UseRefValueReturn,
  UseUndoManagerOptions,
  UseUndoManagerReturn,
} from "@loro-extended/hooks-core"
// Re-export handle types from @loro-extended/repo
export type { DocId, Handle } from "@loro-extended/repo"

// Hooks
export {
  CursorRegistry,
  CursorRegistryContext,
  RepoContext,
  useCollaborativeText,
  useCursorRegistry,
  useDoc,
  useEphemeral,
  useHandle,
  useLens,
  useRefValue,
  useRepo,
  useUndoManager,
} from "./hooks-core.js"

// Context provider
export * from "./repo-context.js"
