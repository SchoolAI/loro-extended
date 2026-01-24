// ═══════════════════════════════════════════════════════════════════════════
// LEA 3.0 (Loro Extended Architecture)
// ═══════════════════════════════════════════════════════════════════════════
//
// LEA is a pattern for building CRDT-native applications with pure functional
// principles. It extends The Elm Architecture (TEA) to work with CRDTs.
//
// Core equation: (Frontier, Msg) → Frontier'
//
// Key Components:
// - Doc: The CRDT document (shared state)
// - Update: State transition function (frontier, msg) → frontier'
// - Reactors: Respond to transitions (before, after) → void | UI
// - Runtime: Imperative shell that orchestrates everything

// ═══════════════════════════════════════════════════════════════════════════
// Reactor Types
// ═══════════════════════════════════════════════════════════════════════════

export type {
  Dispatch,
  Program,
  Reactor,
  ReactorWithCleanup,
  Transition,
  UpdateFn,
} from "./reactor-types.js"

// ═══════════════════════════════════════════════════════════════════════════
// Transition Helpers
// ═══════════════════════════════════════════════════════════════════════════

export { changed, entered, exited, transitioned } from "./helpers.js"

// ═══════════════════════════════════════════════════════════════════════════
// Update Factory
// ═══════════════════════════════════════════════════════════════════════════

export { createUpdate, getTimestampFromFrontier } from "./update.js"

// ═══════════════════════════════════════════════════════════════════════════
// Runtime
// ═══════════════════════════════════════════════════════════════════════════

export type { Disposer } from "./runtime.js"
export { createRuntime } from "./runtime.js"

// ═══════════════════════════════════════════════════════════════════════════
// History Utilities
// ═══════════════════════════════════════════════════════════════════════════

export type {
  HistoryDoc,
  HistoryEntry,
  ParsedHistoryEntry,
} from "./history.js"
export {
  appendHistoryEntry,
  getHistoryDocId,
  getHistoryEntries,
  HistoryDocSchema,
  HistoryEntrySchema,
} from "./history.js"
