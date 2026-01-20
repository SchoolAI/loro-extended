import { createAskSchema } from "@loro-extended/asks"
import { type Infer, Shape } from "@loro-extended/change"

// ═══════════════════════════════════════════════════════════════════════════
// Question/Answer Schemas - The RPC Contract
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Question: what the client asks the server (now a claim request)
 */
export const QuestionSchema = Shape.plain.struct({
  username: Shape.plain.string(),
})

/**
 * Answer: what the server responds
 * - claimed: true if the username was successfully claimed
 * - reason: "taken" | "invalid" | null
 * - suggestions: alternative usernames if claim failed
 */
export const AnswerSchema = Shape.plain.struct({
  claimed: Shape.plain.boolean(),
  reason: Shape.plain.string().nullable(), // "taken" | "invalid" | null
  suggestions: Shape.plain.array(Shape.plain.string()).nullable(),
})

// Derive TypeScript types from schemas
export type Question = Infer<typeof QuestionSchema>
export type Answer = Infer<typeof AnswerSchema>

// ═══════════════════════════════════════════════════════════════════════════
// Username Validation - Shared between client and server
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Username validation regex: 3-20 characters, alphanumeric and underscore only
 */
export const USERNAME_REGEX = /^[a-zA-Z0-9_]{3,20}$/

/**
 * Validate a username format.
 * Shared between client (for immediate feedback) and server (for authoritative validation).
 */
export function isValidUsername(username: string): boolean {
  return USERNAME_REGEX.test(username)
}

// ═══════════════════════════════════════════════════════════════════════════
// Asks Schema - Creates the RPC queue structure
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The Asks schema wraps Question/Answer into a CRDT-backed RPC queue.
 * Each "ask" becomes an entry in this record, keyed by ask ID.
 */
export const UsernameRpcSchema = createAskSchema(QuestionSchema, AnswerSchema)

// ═══════════════════════════════════════════════════════════════════════════
// Claimed Username Schema - For tracking claimed usernames
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Schema for a claimed username entry
 */
export const ClaimedUsernameSchema = Shape.plain.struct({
  username: Shape.plain.string(),
  claimedAt: Shape.plain.number(), // timestamp
})

export type ClaimedUsername = Infer<typeof ClaimedUsernameSchema>

// ═══════════════════════════════════════════════════════════════════════════
// Document Schemas - Split for permissions
// ═══════════════════════════════════════════════════════════════════════════

/**
 * RPC Document - Client-writable
 * Contains the Asks RPC queue for question/answer communication.
 */
export const RpcDocSchema = Shape.doc({
  rpc: UsernameRpcSchema,
})

export type RpcDoc = Infer<typeof RpcDocSchema>

/**
 * Claimed Usernames Document - Server-only (via permissions)
 * Contains the list of claimed usernames. Only the server can write to this.
 */
export const ClaimedUsernamesDocSchema = Shape.doc({
  claimedUsernames: Shape.list(ClaimedUsernameSchema),
})

export type ClaimedUsernamesDoc = Infer<typeof ClaimedUsernamesDocSchema>

/**
 * @deprecated Use RpcDocSchema instead. Kept for backwards compatibility.
 */
export const DocSchema = RpcDocSchema

export type Doc = RpcDoc

// ═══════════════════════════════════════════════════════════════════════════
// Worker Presence Schema - For Asks coordination
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Worker presence is used by Asks to track active workers.
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
