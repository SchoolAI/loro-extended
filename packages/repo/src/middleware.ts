import type { Logger } from "@logtape/logtape"
import type { ChannelMsg } from "./channel.js"
import type { DocContext, PeerContext } from "./permissions.js"

/**
 * Context available to middleware.
 *
 * The available fields depend on when the middleware runs:
 * - `peer` is always available
 * - `document` is available for document-specific messages
 * - `transmission` is available for sync-response and update messages
 */
export type MiddlewareContext = {
  /** The incoming message */
  message: ChannelMsg

  /** Information about the peer sending the message */
  peer: PeerContext

  /** Document context (if message is document-specific) */
  document?: DocContext

  /** Transmission metadata (if message contains document data) */
  transmission?: {
    type: "snapshot" | "update"
    sizeBytes: number
  }
}

/**
 * Result of a middleware check.
 */
export type MiddlewareResult =
  | { allow: true }
  | { allow: false; reason?: string }

/**
 * Middleware for advanced access control and cross-cutting concerns.
 *
 * Middleware runs BEFORE the synchronizer processes messages, at the async boundary.
 * Use middleware for:
 * - Rate limiting
 * - Size limits
 * - External auth service integration
 * - Audit logging
 * - Message transformation
 *
 * For simple permission checks, use `permissions` instead.
 *
 * @example
 * ```typescript
 * // Sync middleware: rate limiting
 * const rateLimiter: Middleware = {
 *   name: 'rate-limiter',
 *   requires: ['peer'],
 *   check: (ctx) => {
 *     const count = getRequestCount(ctx.peer.peerId)
 *     return count < 100 ? { allow: true } : { allow: false, reason: 'rate-limited' }
 *   }
 * }
 *
 * // Async middleware: external auth
 * const externalAuth: Middleware = {
 *   name: 'external-auth',
 *   requires: ['peer'],
 *   check: async (ctx) => {
 *     const allowed = await authService.canAccess(ctx.peer.peerId)
 *     return allowed ? { allow: true } : { allow: false, reason: 'unauthorized' }
 *   }
 * }
 * ```
 */
export interface Middleware {
  /** Name for logging and debugging */
  name: string

  /**
   * Declare what context fields this middleware needs.
   *
   * The system uses this to determine when to run the middleware:
   * - `['peer']` or `['document']` → runs pre-receive (before payload processed)
   * - `['transmission']` → runs post-receive (after payload available)
   *
   * If not specified, middleware runs for all messages.
   */
  requires?: ("peer" | "document" | "transmission")[]

  /**
   * Check whether the message should be allowed.
   *
   * Can be sync or async - the system handles both.
   *
   * @param ctx - Context about the message and peer
   * @returns Whether to allow the message, optionally with a reason for rejection
   */
  check(ctx: MiddlewareContext): MiddlewareResult | Promise<MiddlewareResult>
}

/**
 * Run all middleware checks for a message.
 *
 * Middleware runs in registration order and short-circuits on first rejection.
 *
 * @param middleware - Array of middleware to run
 * @param ctx - Context for the middleware
 * @param logger - Logger for debugging
 * @returns The result of the middleware chain
 */
export async function runMiddleware(
  middleware: Middleware[],
  ctx: MiddlewareContext,
  logger: Logger,
): Promise<MiddlewareResult> {
  for (const mw of middleware) {
    // Check if middleware should run based on its requirements
    if (mw.requires && mw.requires.length > 0) {
      const hasRequiredContext = mw.requires.every(req => {
        switch (req) {
          case "peer":
            return ctx.peer !== undefined
          case "document":
            return ctx.document !== undefined
          case "transmission":
            return ctx.transmission !== undefined
          default:
            return false
        }
      })

      if (!hasRequiredContext) {
        // Skip this middleware - required context not available
        continue
      }
    }

    try {
      const result = await mw.check(ctx)

      if (!result.allow) {
        logger.debug("Message dropped by middleware {name}: {reason}", {
          name: mw.name,
          reason: result.reason ?? "no reason provided",
        })
        return result
      }
    } catch (error) {
      logger.error("Middleware {name} threw an error: {error}", {
        name: mw.name,
        error,
      })
      // Fail closed: if middleware throws, reject the message
      return { allow: false, reason: `middleware error: ${mw.name}` }
    }
  }

  return { allow: true }
}
