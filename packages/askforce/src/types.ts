/**
 * Status of an ask, derived from the answers map.
 */
export type AskStatus = "pending" | "claimed" | "answered" | "failed"

/**
 * Worker answer status discriminant values.
 */
export type WorkerAnswerStatus = "pending" | "answered" | "failed"

/**
 * A pending answer - worker has claimed but not yet answered.
 */
export interface PendingAnswer {
  status: "pending"
  claimedAt: number
}

/**
 * A successful answer from a worker.
 */
export interface AnsweredAnswer<T> {
  status: "answered"
  data: T
  answeredAt: number
}

/**
 * A failed answer from a worker.
 */
export interface FailedAnswer {
  status: "failed"
  reason: string
  failedAt: number
}

/**
 * Union of all worker answer states.
 */
export type WorkerAnswer<T> = PendingAnswer | AnsweredAnswer<T> | FailedAnswer

/**
 * An ask entry in the queue.
 */
export interface AskEntry<Q, A> {
  id: string
  question: Q
  askedAt: number
  askedBy: string
  answers: Record<string, WorkerAnswer<A>>
}

/**
 * Options for creating an Askforce instance.
 */
export interface AskforceOptions {
  /**
   * The peer ID of this instance.
   */
  peerId: string

  /**
   * The mode of operation.
   * - "rpc": Assumes exactly one worker will answer each ask. Handlers do NOT need to be idempotent.
   * - "pool": Multiple workers may answer the same ask. Handlers MUST be idempotent.
   */
  mode: "rpc" | "pool"

  /**
   * Time in milliseconds that non-priority workers wait before claiming an ask in Pool mode.
   * Only applies to Pool mode. Default: 500ms.
   */
  claimWindowMs?: number
}

/**
 * Options for the onAsk subscription.
 */
export interface OnAskOptions {
  /**
   * Optional checkpoint to resume from. Only asks created after this timestamp will be processed.
   */
  since?: number
}

/**
 * Handler function for processing asks.
 */
export type AskHandler<Q, A> = (askId: string, question: Q) => Promise<A> | A

/**
 * Worker presence information stored in EphemeralStore.
 */
export interface WorkerPresence {
  workerId: string
  activeAsks: string[]
  lastHeartbeat: number
}

/**
 * Context information for Askforce errors.
 */
export interface AskforceErrorContext {
  askId?: string
  peerId?: string
  mode?: "rpc" | "pool"
  timeoutMs?: number
  failureReasons?: string[]
}

/**
 * Error class for Askforce operations with structured context.
 * Enables better debugging and programmatic error handling.
 */
export class AskforceError extends Error {
  public readonly context: AskforceErrorContext

  constructor(message: string, context: AskforceErrorContext = {}) {
    const contextStr = Object.entries(context)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
      .join(", ")
    const fullMessage = contextStr ? `${message} (${contextStr})` : message
    super(fullMessage)
    this.name = "AskforceError"
    this.context = context
  }
}
