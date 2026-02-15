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
export { change, ext, loro, Shape } from "@loro-extended/change"

// Re-export hook types from @loro-extended/hooks-core
export type {
  AnyTypedRef,
  Lens,
  LensOptions,
  UseCollaborativeTextOptions,
  UseCollaborativeTextReturn,
  UseUndoManagerOptions,
  UseUndoManagerReturn,
} from "@loro-extended/hooks-core"

// Re-export types from @loro-extended/repo
export type {
  Doc,
  DocId,
  SyncRef,
  SyncRefWithEphemerals,
  WaitForSyncOptions,
} from "@loro-extended/repo"

// Re-export sync function from @loro-extended/repo
export { hasSync, sync } from "@loro-extended/repo"

// Hooks
export {
  CursorRegistry,
  CursorRegistryContext,
  RepoContext,
  useCollaborativeText,
  useCursorRegistry,
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
