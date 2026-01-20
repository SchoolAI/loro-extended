import type { WorkerPresence } from "./types.js"

/**
 * Creates a worker presence object for EphemeralStore.
 *
 * @param workerId - The unique identifier for this worker
 * @param activeAsks - Array of ask IDs currently being processed
 * @returns A WorkerPresence object
 */
export function createWorkerPresence(
  workerId: string,
  activeAsks: string[] = [],
): WorkerPresence {
  return {
    workerId,
    activeAsks,
    lastHeartbeat: Date.now(),
  }
}

/**
 * Updates the heartbeat timestamp in a worker presence object.
 *
 * @param presence - The current worker presence
 * @returns A new WorkerPresence with updated heartbeat
 */
export function updateHeartbeat(presence: WorkerPresence): WorkerPresence {
  return {
    ...presence,
    lastHeartbeat: Date.now(),
  }
}

/**
 * Adds an ask ID to the active asks list.
 *
 * @param presence - The current worker presence
 * @param askId - The ask ID to add
 * @returns A new WorkerPresence with the ask added
 */
export function addActiveAsk(
  presence: WorkerPresence,
  askId: string,
): WorkerPresence {
  if (presence.activeAsks.includes(askId)) {
    return presence
  }
  return {
    ...presence,
    activeAsks: [...presence.activeAsks, askId],
    lastHeartbeat: Date.now(),
  }
}

/**
 * Removes an ask ID from the active asks list.
 *
 * @param presence - The current worker presence
 * @param askId - The ask ID to remove
 * @returns A new WorkerPresence with the ask removed
 */
export function removeActiveAsk(
  presence: WorkerPresence,
  askId: string,
): WorkerPresence {
  return {
    ...presence,
    activeAsks: presence.activeAsks.filter(id => id !== askId),
    lastHeartbeat: Date.now(),
  }
}

/**
 * Checks if a worker presence has expired based on a timeout.
 *
 * @param presence - The worker presence to check
 * @param timeoutMs - The timeout in milliseconds
 * @returns True if the presence has expired
 */
export function isPresenceExpired(
  presence: WorkerPresence,
  timeoutMs: number,
): boolean {
  return Date.now() - presence.lastHeartbeat > timeoutMs
}

/**
 * Default heartbeat interval in milliseconds.
 */
export const DEFAULT_HEARTBEAT_INTERVAL = 5000

/**
 * Default presence timeout in milliseconds.
 * Should be at least 2x the heartbeat interval.
 */
export const DEFAULT_PRESENCE_TIMEOUT = 15000
