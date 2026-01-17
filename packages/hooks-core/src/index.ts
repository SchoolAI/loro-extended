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
 * import { createHooks, createTextHooks, createUndoHooks } from "@loro-extended/hooks-core"
 * import { useState, useEffect, useCallback, useMemo, useRef, useSyncExternalStore, useContext, createContext } from "react"
 *
 * const frameworkHooks = { useState, useEffect, useCallback, useMemo, useRef, useSyncExternalStore, useContext, createContext }
 *
 * export const { RepoContext, useRepo, useHandle, useDoc, useEphemeral } = createHooks(frameworkHooks)
 * export const { useCollaborativeText } = createTextHooks(frameworkHooks)
 * export const { useUndoManager } = createUndoHooks(frameworkHooks)
 * ```
 */

// Core hooks factory
export { createHooks } from "./create-hooks"
export type {
  UseCollaborativeTextOptions,
  UseCollaborativeTextReturn,
} from "./create-text-hooks"

// Text hooks factory and types
export { createTextHooks } from "./create-text-hooks"
export type {
  UseUndoManagerOptions,
  UseUndoManagerReturn,
} from "./create-undo-hooks"

// Undo hooks factory and types
export { createUndoHooks } from "./create-undo-hooks"
// Types
export type { FrameworkHooks } from "./types"
export type { SyncStore } from "./utils/create-sync-store"
// Utilities (for advanced use cases)
export { createSyncStore } from "./utils/create-sync-store"
