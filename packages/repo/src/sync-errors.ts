import type { ReadyState } from "./types.js"

/**
 * Error thrown when waitForSync() times out.
 */
export class SyncTimeoutError extends Error {
  constructor(
    public readonly kind: "network" | "storage",
    public readonly timeoutMs: number,
    public readonly docId: string,
    public readonly lastSeenStates?: ReadyState[],
  ) {
    super(
      `waitForSync({ kind: '${kind}' }) timed out after ${timeoutMs}ms for document '${docId}'. ` +
        `No ${kind} peer completed sync within the timeout period.`,
    )
    this.name = "SyncTimeoutError"
  }
}

/**
 * Error thrown when waitForSync() is called but no adapters of the requested kind exist.
 */
export class NoAdaptersError extends Error {
  constructor(
    public readonly kind: "network" | "storage",
    public readonly docId: string,
  ) {
    super(
      `waitForSync({ kind: '${kind}' }) called for document '${docId}' but no ${kind} adapters are configured. ` +
        `Add a ${kind} adapter to the Repo before calling waitForSync().`,
    )
    this.name = "NoAdaptersError"
  }
}
