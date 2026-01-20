// ═══════════════════════════════════════════════════════════════════════════
// Configuration Constants
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Timeout values in milliseconds
 */
export const TIMEOUTS = {
  /** Time to wait for network sync before making RPC call */
  SYNC: 5000,
  /** Time to wait for RPC response */
  RPC_RESPONSE: 10000,
  /** Time to display each queued result before processing next */
  QUEUE_RESULT_DISPLAY: 2000,
  /** Time to wait before cleaning up completed/failed claims */
  CLEANUP_DELAY: 3000,
} as const

/**
 * Display limits
 */
export const LIMITS = {
  /** Maximum number of recently claimed usernames to display */
  RECENT_USERNAMES_DISPLAY: 10,
  /** Number of username suggestions to show */
  SUGGESTIONS_COUNT: 3,
} as const
