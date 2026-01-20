import { type Frontiers, loro, type TypedDoc } from "@loro-extended/change"
import type { TaskIntention } from "./intentions.js"
import type { Operation } from "./operations.js"
import type { TaskDocSchema, TaskState } from "./schema.js"

// ═══════════════════════════════════════════════════════════════════════════
// interpret - PURE Function that Computes Operations from Intentions
// ═══════════════════════════════════════════════════════════════════════════
// This function is the heart of the LEA pattern. It:
// 1. Receives the document, intention, and frontier (causal context)
// 2. Derives state from (doc, frontier)
// 3. Derives timestamp from frontier (logical time)
// 4. Returns operations to perform (does NOT mutate!)
//
// PURITY: This function has no side effects. Same inputs always produce
// same outputs. Everything is derived from the frontier context.

/**
 * Derive state at a given frontier.
 * For this demo, we use forkAt to get state at the frontier.
 */
export function getStateAtFrontier(
  doc: TypedDoc<typeof TaskDocSchema>,
  frontier: Frontiers,
): TaskState {
  // Fork the doc at the frontier to get state at that point
  const forkedDoc = doc.forkAt(frontier)
  return forkedDoc.task.state
}

/**
 * Derive a logical timestamp from the frontier.
 * We use the sum of counters as a monotonically increasing logical time.
 * This is deterministic and derived purely from the frontier.
 */
export function getTimestampFromFrontier(frontier: Frontiers): number {
  // Sum of all counters gives us a logical timestamp
  // This increases monotonically as operations are added
  return frontier.reduce((sum, f) => sum + f.counter + 1, 0)
}

/**
 * Get the current frontiers from a TypedDoc.
 * This is a helper to access loro(doc).doc.frontiers().
 */
export function getFrontiers(doc: TypedDoc<typeof TaskDocSchema>): Frontiers {
  return loro(doc).doc.frontiers()
}

/**
 * Pure interpret function following full LEA architecture.
 *
 * @param doc - The TypedDoc (immutable reference to document history)
 * @param intention - The user's intention (pure data)
 * @param frontier - The causal context (when the intention was formed)
 * @returns Operations to perform (pure data)
 */
export function interpret(
  doc: TypedDoc<typeof TaskDocSchema>,
  intention: TaskIntention,
  frontier: Frontiers,
): Operation[] {
  // Derive state from (doc, frontier) - PURE
  const state = getStateAtFrontier(doc, frontier)

  // Derive timestamp from frontier - PURE
  const timestamp = getTimestampFromFrontier(frontier)

  switch (intention.type) {
    // ═══════════════════════════════════════════════════════════════════════
    // Content Updates
    // ═══════════════════════════════════════════════════════════════════════

    case "UPDATE_TITLE": {
      // Can update title in draft, todo, in_progress, blocked
      // Cannot update in done or archived
      if (state.status === "done" || state.status === "archived") return []
      return [{ type: "UPDATE_TITLE", title: intention.title }]
    }

    case "UPDATE_DESCRIPTION": {
      // Can only update description in states that have it
      // draft and archived don't have description
      if (
        state.status === "draft" ||
        state.status === "done" ||
        state.status === "archived"
      )
        return []
      return [
        { type: "UPDATE_DESCRIPTION", description: intention.description },
      ]
    }

    // ═══════════════════════════════════════════════════════════════════════
    // State Transitions
    // ═══════════════════════════════════════════════════════════════════════

    case "PUBLISH": {
      // draft → todo
      if (state.status !== "draft") return []
      return [
        {
          type: "SET_TASK_STATE",
          value: {
            status: "todo",
            title: state.title,
            description: "",
            createdAt: state.createdAt,
          },
        },
      ]
    }

    case "START": {
      // todo → in_progress
      if (state.status !== "todo") return []
      return [
        {
          type: "SET_TASK_STATE",
          value: {
            status: "in_progress",
            title: state.title,
            description: state.description,
            startedAt: timestamp, // Derived from frontier!
          },
        },
      ]
    }

    case "BLOCK": {
      // in_progress → blocked
      if (state.status !== "in_progress") return []
      return [
        {
          type: "SET_TASK_STATE",
          value: {
            status: "blocked",
            title: state.title,
            description: state.description,
            blockedReason: intention.reason,
            blockedAt: timestamp, // Derived from frontier!
          },
        },
      ]
    }

    case "UNBLOCK": {
      // blocked → in_progress
      if (state.status !== "blocked") return []
      return [
        {
          type: "SET_TASK_STATE",
          value: {
            status: "in_progress",
            title: state.title,
            description: state.description,
            startedAt: timestamp, // Derived from frontier!
          },
        },
      ]
    }

    case "COMPLETE": {
      // in_progress → done
      if (state.status !== "in_progress") return []
      return [
        {
          type: "SET_TASK_STATE",
          value: {
            status: "done",
            title: state.title,
            description: state.description,
            completedAt: timestamp, // Derived from frontier!
          },
        },
      ]
    }

    case "REOPEN": {
      // done → todo
      if (state.status !== "done") return []
      return [
        {
          type: "SET_TASK_STATE",
          value: {
            status: "todo",
            title: state.title,
            description: state.description,
            createdAt: timestamp, // Derived from frontier!
          },
        },
      ]
    }

    case "ARCHIVE": {
      // any (except archived) → archived
      if (state.status === "archived") return []
      return [
        {
          type: "SET_TASK_STATE",
          value: {
            status: "archived",
            title: state.title,
            archivedAt: timestamp, // Derived from frontier!
          },
        },
      ]
    }
  }
}
