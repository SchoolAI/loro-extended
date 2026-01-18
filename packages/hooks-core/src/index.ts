/**
 * @loro-extended/hooks-core
 *
 * Framework-agnostic hook factories for Loro collaborative editing.
 * This package provides factory functions that accept framework-specific hooks
 * (React's useState, useEffect, etc. or Hono's equivalents) and return
 * collaborative editing hooks.
 *
 * @example
 * ```ts
 * // In a React adapter:
 * import { createHooks, createTextHooks, createUndoHooks, createRefHooks } from "@loro-extended/hooks-core"
 * import { useState, useEffect, useCallback, useMemo, useRef, useSyncExternalStore, useContext, createContext } from "react"
 *
 * const frameworkHooks = { useState, useEffect, useCallback, useMemo, useRef, useSyncExternalStore, useContext, createContext }
 *
 * export const { RepoContext, useRepo, useHandle, useDoc, useEphemeral } = createHooks(frameworkHooks)
 * export const { useCollaborativeText } = createTextHooks(frameworkHooks)
 * export const { useUndoManager } = createUndoHooks(frameworkHooks)
 * export const { useRefValue } = createRefHooks(frameworkHooks)
 * ```
 */

// Core hooks factory
export { createHooks } from "./create-hooks"
export type { AnyTypedRef, UseRefValueReturn } from "./create-ref-hooks"
// Ref hooks factory and types
export { createRefHooks } from "./create-ref-hooks"
export type {
  CreateTextHooksConfig,
  UseCollaborativeTextOptions,
  UseCollaborativeTextReturn,
} from "./create-text-hooks"
// Text hooks factory and types
export { createTextHooks } from "./create-text-hooks"
// Cursor utilities for delta-based cursor adjustment
export {
  adjustCursorFromDelta,
  adjustSelectionFromDelta,
} from "./create-text-hooks/cursor-utils"
export type {
  CreateUndoHooksConfig,
  CursorPosition,
  UseUndoManagerOptions,
  UseUndoManagerReturn,
} from "./create-undo-hooks"
// Undo hooks factory and types
export { createUndoHooks } from "./create-undo-hooks"
// Cursor registry for tracking text elements and focus state
export {
  CursorRegistry,
  type FocusedElementInfo,
  type RegisteredElement,
} from "./cursor-registry"
// Cursor registry context factory
export { createCursorRegistryContext } from "./cursor-registry-context"
// Types
export type { FrameworkHooks } from "./types"
// Undo manager registry for namespace-based undo
export {
  NAMESPACE_ORIGIN_PREFIX,
  type OnPopCallback,
  type OnPushCallback,
  type RegisteredUndoManager,
  UndoManagerRegistry,
} from "./undo-manager-registry"
export type { SyncStore } from "./utils/create-sync-store"
// Utilities (for advanced use cases)
export { createSyncStore } from "./utils/create-sync-store"
