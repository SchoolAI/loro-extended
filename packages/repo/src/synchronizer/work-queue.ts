/**
 * WorkQueue - Unified work queue for deferred execution
 *
 * Prevents recursion when adapters deliver messages synchronously
 * (e.g., BridgeAdapter, StorageAdapter). Work items are queued and
 * processed iteratively rather than recursively.
 *
 * @example
 * ```typescript
 * const queue = new WorkQueue(() => {
 *   // Called at quiescence (when queue is empty)
 *   flushOutboundMessages()
 * })
 *
 * queue.enqueue(() => processMessage(msg1))
 * queue.enqueue(() => processMessage(msg2))
 * // Both messages processed, then onQuiescent called
 * ```
 */
export class WorkQueue {
  #queue: Array<() => void> = []
  #isProcessing = false
  readonly #onQuiescent: () => void

  /**
   * Create a new WorkQueue.
   *
   * @param onQuiescent - Callback invoked when the queue becomes empty.
   *                      Use this to flush batched operations.
   */
  constructor(onQuiescent: () => void) {
    this.#onQuiescent = onQuiescent
  }

  /**
   * Enqueue work to be processed.
   *
   * If not currently processing, starts processing immediately.
   * If already processing, work is added to the queue and will be
   * processed in order.
   */
  enqueue(work: () => void): void {
    this.#queue.push(work)
    this.#processUntilQuiescent()
  }

  /**
   * Returns true if currently processing the queue.
   *
   * Use this to decide whether to enqueue work or execute inline:
   * - If processing, execute inline to avoid unnecessary queueing
   * - If not processing, enqueue to ensure proper batching
   */
  get isProcessing(): boolean {
    return this.#isProcessing
  }

  /**
   * Process all queued work until quiescence, then call onQuiescent.
   * Uses a guard flag to prevent recursive processing.
   */
  #processUntilQuiescent(): void {
    if (this.#isProcessing) return

    this.#isProcessing = true
    try {
      let work = this.#queue.shift()
      while (work) {
        work()
        work = this.#queue.shift()
      }
      // Quiescent: invoke callback
      this.#onQuiescent()
    } finally {
      this.#isProcessing = false
    }

    // If onQuiescent generated new work (via synchronous adapter replies), process it
    if (this.#queue.length > 0) {
      this.#processUntilQuiescent()
    }
  }
}
