import { createAskforceSchema } from "@loro-extended/askforce"
import { type Infer, Shape } from "@loro-extended/change"

// ═══════════════════════════════════════════════════════════════════════════
// Question/Answer Schemas - The RPC Contract
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Question: what the client asks the server
 */
export const QuestionSchema = Shape.plain.struct({
  username: Shape.plain.string(),
})

/**
 * Answer: what the server responds
 */
export const AnswerSchema = Shape.plain.struct({
  available: Shape.plain.boolean(),
  reason: Shape.plain.string().nullable(), // "taken" | "invalid" | "reserved" | null
  suggestions: Shape.plain.array(Shape.plain.string()).nullable(),
})

// Derive TypeScript types from schemas
export type Question = Infer<typeof QuestionSchema>
export type Answer = Infer<typeof AnswerSchema>

// ═══════════════════════════════════════════════════════════════════════════
// Askforce Schema - Creates the RPC queue structure
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The Askforce schema wraps Question/Answer into a CRDT-backed RPC queue.
 * Each "ask" becomes an entry in this record, keyed by ask ID.
 */
export const UsernameRpcSchema = createAskforceSchema(
  QuestionSchema,
  AnswerSchema,
)

// ═══════════════════════════════════════════════════════════════════════════
// Document Schema - The full collaborative document
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The document contains the RPC queue.
 * In a real app, you might have multiple queues or other data here.
 */
export const DocSchema = Shape.doc({
  rpc: UsernameRpcSchema,
})

export type Doc = Infer<typeof DocSchema>

// ═══════════════════════════════════════════════════════════════════════════
// Worker Presence Schema - For Askforce coordination
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Worker presence is used by Askforce to track active workers.
 * This enables features like staggered claiming in Pool mode.
 */
export const WorkerPresenceSchema = Shape.plain.struct({
  workerId: Shape.plain.string(),
  activeAsks: Shape.plain.array(Shape.plain.string()),
  lastHeartbeat: Shape.plain.number(),
})

export type WorkerPresence = Infer<typeof WorkerPresenceSchema>

/**
 * Ephemeral declarations for the document.
 * This tells the Repo what ephemeral data to track.
 */
export const EphemeralDeclarations = {
  presence: WorkerPresenceSchema,
}
