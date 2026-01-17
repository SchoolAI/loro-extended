import type { AddressedEnvelope } from "../channel.js"

/**
 * Context provided to send interceptors.
 */
export type SendInterceptorContext = {
  /** The envelope being sent */
  envelope: AddressedEnvelope
  /** The adapter type (e.g., "websocket-client") */
  adapterType: string
  /** The adapter instance ID */
  adapterId: string
}

/**
 * A send interceptor can delay, drop, log, or modify outgoing messages.
 *
 * Call `next()` to continue the chain. If `next()` is not called, the message is dropped.
 *
 * @example Delay all messages by 3 seconds
 * ```typescript
 * adapter.addSendInterceptor((ctx, next) => {
 *   setTimeout(next, 3000)
 * })
 * ```
 *
 * @example Drop 10% of messages (simulate packet loss)
 * ```typescript
 * adapter.addSendInterceptor((ctx, next) => {
 *   if (Math.random() > 0.1) next()
 * })
 * ```
 *
 * @example Log all messages
 * ```typescript
 * adapter.addSendInterceptor((ctx, next) => {
 *   console.log('Sending:', ctx.envelope.message.type)
 *   next()
 * })
 * ```
 */
export type SendInterceptor = (
  context: SendInterceptorContext,
  next: () => void,
) => void
