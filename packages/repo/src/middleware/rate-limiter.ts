/**
 * Rate Limiter Middleware
 *
 * Provides configurable rate limiting for incoming messages.
 * Uses a sliding window algorithm for smooth rate limiting.
 *
 * ## Features
 *
 * - **Per-peer rate limiting** - Each peer has their own rate limit
 * - **Sliding window** - Smooth rate limiting without burst issues
 * - **Configurable limits** - Set max requests per time window
 * - **Burst allowance** - Optional burst capacity for legitimate spikes
 * - **Auto-cleanup** - Removes stale peer data to prevent memory leaks
 *
 * ## Usage
 *
 * ```typescript
 * import { createRateLimiter } from '@loro-extended/repo'
 *
 * const repo = new Repo({
 *   middleware: [
 *     createRateLimiter({
 *       maxRequests: 100,      // Max 100 requests
 *       windowMs: 60000,       // Per minute
 *       burstAllowance: 10,    // Allow 10 extra in bursts
 *     })
 *   ]
 * })
 * ```
 *
 * @module
 */

import type {
  Middleware,
  MiddlewareContext,
  MiddlewareResult,
} from "../middleware.js"

/**
 * Configuration options for the rate limiter.
 */
export type RateLimiterOptions = {
  /**
   * Maximum number of requests allowed per window.
   * @default 100
   */
  maxRequests?: number

  /**
   * Time window in milliseconds.
   * @default 60000 (1 minute)
   */
  windowMs?: number

  /**
   * Additional burst capacity above maxRequests.
   * Allows short bursts of traffic without rejection.
   * @default 0
   */
  burstAllowance?: number

  /**
   * How often to clean up stale peer data (in milliseconds).
   * Set to 0 to disable auto-cleanup.
   * @default 300000 (5 minutes)
   */
  cleanupIntervalMs?: number

  /**
   * Custom key function to determine rate limit grouping.
   * By default, rate limits are per-peer.
   * @default (ctx) => ctx.peer.peerId
   */
  keyFn?: (ctx: MiddlewareContext) => string

  /**
   * Custom handler for rate-limited requests.
   * Called when a request is rejected due to rate limiting.
   */
  onRateLimited?: (ctx: MiddlewareContext, info: RateLimitInfo) => void
}

/**
 * Information about the current rate limit state.
 */
export type RateLimitInfo = {
  /** Current request count in the window */
  current: number
  /** Maximum allowed requests */
  limit: number
  /** Milliseconds until the window resets */
  resetMs: number
  /** Whether this request was allowed */
  allowed: boolean
}

/**
 * Internal state for tracking request counts.
 */
type PeerRateState = {
  /** Timestamps of requests in the current window */
  timestamps: number[]
  /** Last activity time (for cleanup) */
  lastActivity: number
}

/**
 * Extended middleware interface with internal state access for testing.
 */
export interface RateLimiterMiddleware extends Middleware {
  /** Internal state map (for testing) */
  getState(): Map<string, PeerRateState>
  /** Cleanup function to stop intervals and clear state */
  cleanup(): void
}

/**
 * Creates a rate limiter middleware with the specified options.
 *
 * @param options - Configuration options
 * @returns A middleware that enforces rate limits
 *
 * @example
 * ```typescript
 * // Basic usage: 100 requests per minute
 * const rateLimiter = createRateLimiter({
 *   maxRequests: 100,
 *   windowMs: 60000,
 * })
 *
 * // With burst allowance
 * const rateLimiter = createRateLimiter({
 *   maxRequests: 100,
 *   windowMs: 60000,
 *   burstAllowance: 20, // Allow up to 120 in bursts
 * })
 *
 * // Custom key function (rate limit by document instead of peer)
 * const rateLimiter = createRateLimiter({
 *   maxRequests: 50,
 *   windowMs: 60000,
 *   keyFn: (ctx) => ctx.document?.id ?? 'unknown',
 * })
 * ```
 */
export function createRateLimiter(
  options: RateLimiterOptions = {},
): RateLimiterMiddleware {
  const {
    maxRequests = 100,
    windowMs = 60000,
    burstAllowance = 0,
    cleanupIntervalMs = 300000,
    keyFn = (ctx: MiddlewareContext) => ctx.peer?.peerId ?? "unknown",
    onRateLimited,
  } = options

  // State: Map of key -> rate state
  const state = new Map<string, PeerRateState>()

  // Effective limit including burst
  const effectiveLimit = maxRequests + burstAllowance

  // Cleanup interval handle
  let cleanupInterval: ReturnType<typeof setInterval> | undefined

  // Start cleanup if enabled
  if (cleanupIntervalMs > 0) {
    cleanupInterval = setInterval(() => {
      const now = Date.now()
      const staleThreshold = now - windowMs * 2 // Remove if inactive for 2 windows

      for (const [key, peerState] of state) {
        if (peerState.lastActivity < staleThreshold) {
          state.delete(key)
        }
      }
    }, cleanupIntervalMs)

    // Don't prevent process exit
    if (cleanupInterval.unref) {
      cleanupInterval.unref()
    }
  }

  /**
   * Check if a request should be allowed and update state.
   */
  function checkRateLimit(key: string): RateLimitInfo {
    const now = Date.now()
    const windowStart = now - windowMs

    // Get or create state for this key
    let peerState = state.get(key)
    if (!peerState) {
      peerState = { timestamps: [], lastActivity: now }
      state.set(key, peerState)
    }

    // Remove timestamps outside the window
    peerState.timestamps = peerState.timestamps.filter(ts => ts > windowStart)
    peerState.lastActivity = now

    // Check if under limit
    const current = peerState.timestamps.length
    const allowed = current < effectiveLimit

    if (allowed) {
      // Record this request
      peerState.timestamps.push(now)
    }

    // Calculate reset time (when oldest request falls out of window)
    const oldestTimestamp = peerState.timestamps[0] ?? now
    const resetMs = Math.max(0, oldestTimestamp + windowMs - now)

    return {
      current: current + (allowed ? 1 : 0),
      limit: effectiveLimit,
      resetMs,
      allowed,
    }
  }

  function cleanup(): void {
    if (cleanupInterval) {
      clearInterval(cleanupInterval)
      cleanupInterval = undefined
    }
    state.clear()
  }

  return {
    name: "rate-limiter",
    requires: ["peer"],

    check(ctx: MiddlewareContext): MiddlewareResult {
      // Skip if no peer context (shouldn't happen with requires: ['peer'])
      if (!ctx.peer) {
        return { allow: true }
      }

      const key = keyFn(ctx)
      const info = checkRateLimit(key)

      if (!info.allowed) {
        // Call custom handler if provided
        onRateLimited?.(ctx, info)

        return {
          allow: false,
          reason: `Rate limit exceeded: ${info.current}/${info.limit} requests (resets in ${Math.ceil(info.resetMs / 1000)}s)`,
        }
      }

      return { allow: true }
    },

    // Expose for testing and manual cleanup
    getState: () => state,
    cleanup,
  }
}

/**
 * Extended middleware interface for message type rate limiter.
 */
export interface MessageTypeRateLimiterMiddleware extends Middleware {
  /** Cleanup function to stop intervals and clear state */
  cleanup(): void
}

/**
 * Creates a rate limiter that limits by message type.
 * Useful for limiting specific operations (e.g., sync-requests).
 *
 * @param messageTypes - Array of message types to rate limit
 * @param options - Rate limiter options
 * @returns A middleware that only rate limits specified message types
 *
 * @example
 * ```typescript
 * // Limit sync-requests to 10 per minute
 * const syncLimiter = createMessageTypeRateLimiter(
 *   ['channel/sync-request'],
 *   { maxRequests: 10, windowMs: 60000 }
 * )
 * ```
 */
export function createMessageTypeRateLimiter(
  messageTypes: string[],
  options: RateLimiterOptions = {},
): MessageTypeRateLimiterMiddleware {
  const baseLimiter = createRateLimiter(options)
  const messageTypeSet = new Set(messageTypes)

  return {
    name: `rate-limiter:${messageTypes.join(",")}`,
    requires: ["peer"],

    async check(ctx: MiddlewareContext): Promise<MiddlewareResult> {
      // Only rate limit specified message types
      if (!messageTypeSet.has(ctx.message.type)) {
        return { allow: true }
      }

      // Await the result in case baseLimiter.check returns a Promise
      return await baseLimiter.check(ctx)
    },

    // Expose cleanup from base limiter
    cleanup: () => baseLimiter.cleanup(),
  }
}
