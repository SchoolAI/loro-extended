import { loro, type RecordRef, type ValueShape } from "@loro-extended/change"
import { generateUUID, type TypedEphemeral } from "@loro-extended/repo"
import {
  allHaveStatus,
  firstAnswer,
  hasStatus,
  pickOne,
} from "./aggregation.js"
import {
  addActiveAsk,
  createWorkerPresence,
  DEFAULT_HEARTBEAT_INTERVAL,
  removeActiveAsk,
} from "./presence.js"
import {
  AskforceError,
  type AskforceOptions,
  type AskHandler,
  type AskStatus,
  type OnAskOptions,
  type WorkerAnswer,
  type WorkerPresence,
} from "./types.js"

/**
 * Generates a unique ask ID using a cryptographically secure UUID.
 */
function generateAskId(): string {
  return `ask_${generateUUID()}`
}

/**
 * The shape of an ask entry in the record.
 */
interface AskEntryShape {
  id: string
  question: unknown
  askedAt: number
  askedBy: string
  answers: Record<string, WorkerAnswer<unknown>>
}

/**
 * Type guard to check if a value is a valid AskEntryShape.
 * Used to safely convert CRDT data to typed objects.
 */
function isAskEntryShape(value: unknown): value is AskEntryShape {
  if (typeof value !== "object" || value === null) {
    return false
  }
  const obj = value as Record<string, unknown>
  return (
    typeof obj.id === "string" &&
    typeof obj.askedAt === "number" &&
    typeof obj.askedBy === "string" &&
    typeof obj.answers === "object" &&
    obj.answers !== null
  )
}

/**
 * Safely access the answers record from a CRDT entry.
 * Returns undefined if the entry doesn't have an answers property.
 */
function getAnswersRef(
  entry: unknown,
): { set: (key: string, value: unknown) => void } | undefined {
  if (typeof entry !== "object" || entry === null) {
    return undefined
  }
  const obj = entry as Record<string, unknown>
  if (
    typeof obj.answers === "object" &&
    obj.answers !== null &&
    typeof (obj.answers as Record<string, unknown>).set === "function"
  ) {
    return obj.answers as { set: (key: string, value: unknown) => void }
  }
  return undefined
}

/**
 * Askforce - P2P-native work exchange using the question/answer metaphor.
 *
 * @typeParam Q - The question value shape
 * @typeParam A - The answer value shape
 *
 * @example
 * ```typescript
 * const askforce = new Askforce(
 *   recordRef,
 *   ephemeral,
 *   { peerId: "peer-1", mode: "rpc" }
 * );
 *
 * // Ask a question
 * const askId = askforce.ask({ query: "What is 2+2?" });
 *
 * // Wait for an answer
 * const answer = await askforce.waitFor(askId);
 * ```
 */
/**
 * Default claim window in milliseconds.
 * Non-priority workers wait this long before claiming an ask.
 */
export const DEFAULT_CLAIM_WINDOW_MS = 500

export class Askforce<
  Q extends ValueShape = ValueShape,
  A extends ValueShape = ValueShape,
> {
  // RecordRef is generic over any shape
  private readonly recordRef: RecordRef<any>
  private readonly ephemeral: TypedEphemeral<WorkerPresence>
  private readonly peerId: string
  private readonly mode: "rpc" | "pool"
  private readonly claimWindowMs: number
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null
  private subscriptions: Array<() => void> = []
  private pendingClaimTimeouts: Map<string, ReturnType<typeof setTimeout>> =
    new Map()

  constructor(
    recordRef: RecordRef<any>,
    ephemeral: TypedEphemeral<WorkerPresence>,
    options: AskforceOptions,
  ) {
    this.recordRef = recordRef
    this.ephemeral = ephemeral
    this.peerId = options.peerId
    this.mode = options.mode
    this.claimWindowMs = options.claimWindowMs ?? DEFAULT_CLAIM_WINDOW_MS
  }

  /**
   * Ask a question and return the ask ID.
   *
   * @param question - The question data (must match the question schema)
   * @returns The unique ask ID
   */
  ask(question: Q["_plain"]): string {
    const askId = generateAskId()

    const entry: AskEntryShape = {
      id: askId,
      question,
      askedAt: Date.now(),
      askedBy: this.peerId,
      answers: {},
    }

    this.recordRef.set(askId, entry)

    return askId
  }

  /**
   * Subscribe to incoming asks and process them with the handler.
   *
   * @param handler - Function to process each ask and return an answer
   * @param options - Optional configuration (e.g., checkpoint resumption)
   * @returns Unsubscribe function
   */
  onAsk(
    handler: AskHandler<Q["_plain"], A["_plain"]>,
    options?: OnAskOptions,
  ): () => void {
    const since = options?.since ?? 0

    // Track which asks we've already started processing to avoid duplicates
    const processedAsks = new Set<string>()

    // Start heartbeat for worker presence
    this.startHeartbeat()

    // Helper to process an ask if it meets criteria
    const maybeProcessAsk = (askId: string) => {
      // Skip if already processed
      if (processedAsks.has(askId)) {
        return
      }

      const entry = this.getEntry(askId)
      if (entry && entry.askedAt >= since) {
        processedAsks.add(askId)
        this.scheduleProcessAsk(askId, handler)
      }
    }

    // Process existing asks that match criteria
    const existingAsks = this.recordRef.keys()
    for (const askId of existingAsks) {
      maybeProcessAsk(askId)
    }

    // Subscribe to new asks using loro(recordRef).subscribe()
    const unsub = loro(this.recordRef).subscribe(() => {
      // Check for new asks
      const currentAsks = this.recordRef.keys()
      for (const askId of currentAsks) {
        maybeProcessAsk(askId)
      }
    })

    this.subscriptions.push(unsub)

    return () => {
      unsub()
      const idx = this.subscriptions.indexOf(unsub)
      if (idx !== -1) {
        this.subscriptions.splice(idx, 1)
      }
      this.stopHeartbeat()
      this.clearPendingClaimTimeouts()
    }
  }

  /**
   * Wait for an answer to an ask.
   *
   * @param askId - The ask ID to wait for
   * @param timeoutMs - Optional timeout in milliseconds (default: 30000)
   * @returns Promise that resolves with the answer
   */
  async waitFor(askId: string, timeoutMs = 30000): Promise<A["_plain"]> {
    return new Promise((resolve, reject) => {
      let unsub: (() => void) | null = null
      let timeoutId: ReturnType<typeof setTimeout> | null = null
      let resolved = false

      const cleanup = () => {
        if (unsub) {
          unsub()
          unsub = null
        }
        if (timeoutId) {
          clearTimeout(timeoutId)
          timeoutId = null
        }
      }

      const checkAnswer = (): boolean => {
        if (resolved) return true

        const entry = this.getEntry(askId)
        if (!entry) {
          resolved = true
          cleanup()
          reject(
            new AskforceError("Ask not found", {
              askId,
              peerId: this.peerId,
              mode: this.mode,
            }),
          )
          return true
        }

        const answers = entry.answers as Record<
          string,
          WorkerAnswer<A["_plain"]>
        >

        // In RPC mode, return the first answer
        // In Pool mode, use pickOne for deterministic selection
        const answer =
          this.mode === "rpc" ? firstAnswer(answers) : pickOne(answers)

        if (answer !== undefined) {
          resolved = true
          cleanup()
          resolve(answer)
          return true
        }

        // Check for all failed
        if (
          allHaveStatus(answers, "failed") &&
          Object.keys(answers).length > 0
        ) {
          const failureReasons = Object.values(answers)
            .filter(a => a.status === "failed")
            .map(
              a =>
                (a as { status: "failed"; reason: string; failedAt: number })
                  .reason,
            )
          resolved = true
          cleanup()
          reject(
            new AskforceError("All workers failed", {
              askId,
              peerId: this.peerId,
              mode: this.mode,
              failureReasons,
            }),
          )
          return true
        }

        return false
      }

      // Check immediately in case answer already exists
      if (checkAnswer()) {
        return
      }

      // Set up timeout
      timeoutId = setTimeout(() => {
        if (!resolved) {
          resolved = true
          cleanup()
          reject(
            new AskforceError("Timeout waiting for answer", {
              askId,
              peerId: this.peerId,
              mode: this.mode,
              timeoutMs,
            }),
          )
        }
      }, timeoutMs)

      // Subscribe to changes on the recordRef
      unsub = loro(this.recordRef).subscribe(() => {
        checkAnswer()
      })
    })
  }

  /**
   * Get the current status of an ask.
   *
   * @param askId - The ask ID
   * @returns The derived status
   */
  getStatus(askId: string): AskStatus {
    const entry = this.getEntry(askId)
    if (!entry) {
      return "pending"
    }

    const answers = entry.answers as Record<string, WorkerAnswer<unknown>>
    const answerCount = Object.keys(answers).length

    if (answerCount === 0) {
      return "pending"
    }

    if (hasStatus(answers, "answered")) {
      return "answered"
    }

    if (hasStatus(answers, "pending")) {
      return "claimed"
    }

    if (allHaveStatus(answers, "failed")) {
      return "failed"
    }

    return "pending"
  }

  /**
   * Get all answers for an ask.
   * Useful in Pool mode when duplicates are meaningful.
   *
   * @param askId - The ask ID
   * @returns Array of all answered results with worker IDs
   */
  allAnswers(
    askId: string,
  ): Array<{ workerId: string; data: A["_plain"]; answeredAt: number }> {
    const entry = this.getEntry(askId)
    if (!entry) {
      return []
    }

    const answers = entry.answers as Record<string, WorkerAnswer<A["_plain"]>>
    return Object.entries(answers)
      .filter(
        (
          e,
        ): e is [
          string,
          { status: "answered"; data: A["_plain"]; answeredAt: number },
        ] => e[1].status === "answered",
      )
      .map(([workerId, answer]) => ({
        workerId,
        data: answer.data,
        answeredAt: answer.answeredAt,
      }))
  }

  /**
   * Dispose of the Askforce instance.
   * Stops heartbeat and cleans up subscriptions.
   */
  dispose(): void {
    this.stopHeartbeat()
    this.clearPendingClaimTimeouts()
    for (const unsub of this.subscriptions) {
      unsub()
    }
    this.subscriptions = []
  }

  // ═══════════════════════════════════════════════════════════════
  // Private Methods
  // ═══════════════════════════════════════════════════════════════

  private getEntry(askId: string): AskEntryShape | undefined {
    const entry = this.recordRef.get(askId)
    if (!entry) {
      return undefined
    }
    // Convert StructRef to plain object using toJSON if available
    const plainEntry =
      typeof entry === "object" &&
      entry !== null &&
      "toJSON" in entry &&
      typeof entry.toJSON === "function"
        ? entry.toJSON()
        : entry
    // Validate the shape before returning
    return isAskEntryShape(plainEntry) ? plainEntry : undefined
  }

  /**
   * Schedule processing of an ask with staggered claiming for Pool mode.
   * In RPC mode, claims immediately. In Pool mode, uses priority-based claiming.
   */
  private scheduleProcessAsk(
    askId: string,
    handler: AskHandler<Q["_plain"], A["_plain"]>,
  ): void {
    // In RPC mode, process immediately
    if (this.mode === "rpc") {
      this.processAsk(askId, handler)
      return
    }

    // Pool mode: use staggered claiming
    const isPriority = this.isPriorityWorker(askId)

    if (isPriority) {
      // Priority worker claims immediately
      this.processAsk(askId, handler)
    } else {
      // Non-priority workers wait, then check if still unclaimed
      const timeoutId = setTimeout(() => {
        this.pendingClaimTimeouts.delete(askId)
        // Check if ask is still unclaimed before processing
        if (!this.hasBeenClaimed(askId)) {
          this.processAsk(askId, handler)
        }
      }, this.claimWindowMs)

      this.pendingClaimTimeouts.set(askId, timeoutId)
    }
  }

  private async processAsk(
    askId: string,
    handler: AskHandler<Q["_plain"], A["_plain"]>,
  ): Promise<void> {
    // Always read fresh from the CRDT to get complete data
    // (subscription may fire before all nested properties are written)
    const entry = this.getEntry(askId)
    if (!entry) {
      return
    }

    // Check if we've already answered
    const answers = entry.answers as Record<string, WorkerAnswer<unknown>>
    if (this.peerId in answers) {
      return
    }

    // In RPC mode, skip if anyone has already answered
    if (this.mode === "rpc" && hasStatus(answers, "answered")) {
      return
    }

    // Claim the ask
    this.claimAsk(askId)

    try {
      const answer = await handler(askId, entry.question as Q["_plain"])
      this.completeAsk(askId, answer)
    } catch (error) {
      this.failAsk(
        askId,
        error instanceof Error ? error.message : String(error),
      )
    } finally {
      this.releaseAsk(askId)
    }
  }

  private claimAsk(askId: string): void {
    // Update presence
    const currentPresence =
      this.ephemeral.self ?? createWorkerPresence(this.peerId)
    this.ephemeral.setSelf(addActiveAsk(currentPresence, askId))

    // Write pending answer to CRDT
    const entry = this.recordRef.get(askId)
    const answersRef = getAnswersRef(entry)
    if (answersRef) {
      answersRef.set(this.peerId, {
        status: "pending",
        claimedAt: Date.now(),
      })
    }
  }

  private completeAsk(askId: string, data: A["_plain"]): void {
    const entry = this.recordRef.get(askId)
    const answersRef = getAnswersRef(entry)
    if (answersRef) {
      answersRef.set(this.peerId, {
        status: "answered",
        data,
        answeredAt: Date.now(),
      })
    }
  }

  private failAsk(askId: string, reason: string): void {
    const entry = this.recordRef.get(askId)
    const answersRef = getAnswersRef(entry)
    if (answersRef) {
      answersRef.set(this.peerId, {
        status: "failed",
        reason,
        failedAt: Date.now(),
      })
    }
  }

  private releaseAsk(askId: string): void {
    const currentPresence = this.ephemeral.self
    if (currentPresence) {
      this.ephemeral.setSelf(removeActiveAsk(currentPresence, askId))
    }
  }

  private startHeartbeat(): void {
    if (this.heartbeatInterval) {
      return
    }

    // Set initial presence
    this.ephemeral.setSelf(createWorkerPresence(this.peerId))

    this.heartbeatInterval = setInterval(() => {
      const currentPresence = this.ephemeral.self
      if (currentPresence) {
        this.ephemeral.setSelf({
          ...currentPresence,
          lastHeartbeat: Date.now(),
        })
      }
    }, DEFAULT_HEARTBEAT_INTERVAL)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
      this.heartbeatInterval = null
    }

    // Clear presence
    this.ephemeral.delete(this.peerId)
  }

  /**
   * Clear all pending claim timeouts.
   */
  private clearPendingClaimTimeouts(): void {
    for (const timeoutId of this.pendingClaimTimeouts.values()) {
      clearTimeout(timeoutId)
    }
    this.pendingClaimTimeouts.clear()
  }

  /**
   * Get the list of known workers from ephemeral presence, sorted for deterministic ordering.
   */
  private getKnownWorkers(): string[] {
    const workers = new Set<string>()

    // Add self
    workers.add(this.peerId)

    // Add all peers from ephemeral store
    for (const [peerId] of this.ephemeral.peers) {
      workers.add(peerId)
    }

    return Array.from(workers).sort()
  }

  /**
   * Calculate a simple hash of a string for deterministic priority assignment.
   */
  private hashString(str: string): number {
    let hash = 0
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i)
      hash = (hash << 5) - hash + char
      hash = hash & hash // Convert to 32bit integer
    }
    return Math.abs(hash)
  }

  /**
   * Determine if this worker is the priority worker for a given ask.
   * Uses deterministic hashing to assign priority based on ask ID.
   */
  private isPriorityWorker(askId: string): boolean {
    const workers = this.getKnownWorkers()
    if (workers.length === 0) {
      return true // If no workers known, we're priority by default
    }

    const askIndex = this.hashString(askId) % workers.length
    const priorityWorker = workers[askIndex]

    return priorityWorker === this.peerId
  }

  /**
   * Check if an ask has been claimed by any worker.
   */
  private hasBeenClaimed(askId: string): boolean {
    const entry = this.getEntry(askId)
    if (!entry) {
      return false
    }

    const answers = entry.answers as Record<string, WorkerAnswer<unknown>>
    return Object.keys(answers).length > 0
  }
}
