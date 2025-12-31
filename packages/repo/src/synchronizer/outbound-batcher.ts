import type {
  AddressedEstablishedEnvelope,
  BatchableMsg,
  ChannelMsgBatch,
} from "../channel.js"
import type { ChannelId } from "../types.js"

/**
 * OutboundBatcher - Batches outbound messages by channel for efficient transmission
 *
 * Messages are aggregated by channel and flushed at quiescence.
 * Single messages are sent directly; multiple messages are wrapped in a batch.
 *
 * @example
 * ```typescript
 * const batcher = new OutboundBatcher()
 *
 * // Queue messages during processing
 * batcher.queue(channelId1, syncResponse1)
 * batcher.queue(channelId1, syncResponse2)
 * batcher.queue(channelId2, ephemeralMsg)
 *
 * // Flush at quiescence
 * batcher.flush((envelope) => adapters.send(envelope))
 * // channelId1 gets a batch with 2 messages
 * // channelId2 gets a single message (no batch wrapper)
 * ```
 */
export class OutboundBatcher {
  #buffer: Map<ChannelId, BatchableMsg[]> = new Map()

  /**
   * Queue a message to be sent to a channel.
   * Messages are aggregated by channel and flushed at quiescence.
   */
  queue(channelId: ChannelId, message: BatchableMsg): void {
    const queue = this.#buffer.get(channelId) ?? []
    queue.push(message)
    this.#buffer.set(channelId, queue)
  }

  /**
   * Flush all buffered outbound messages, aggregating by channel.
   * Single messages are sent directly; multiple messages are wrapped in a batch.
   *
   * The buffer is cleared before sending to handle reentrancy safely
   * (synchronous adapter replies will queue to a fresh buffer).
   *
   * @param send - Function to send an addressed envelope
   */
  flush(send: (envelope: AddressedEstablishedEnvelope) => void): void {
    // Snapshot and clear to handle reentrancy safely
    // (synchronous adapter replies will queue to a fresh buffer)
    const toSend = new Map(this.#buffer)
    this.#buffer.clear()

    for (const [channelId, messages] of toSend) {
      if (messages.length === 0) continue

      if (messages.length === 1) {
        // Single message - send directly without batch wrapper
        send({ toChannelIds: [channelId], message: messages[0] })
      } else {
        // Multiple messages - wrap in batch
        const batchMessage: ChannelMsgBatch = {
          type: "channel/batch",
          messages,
        }
        send({ toChannelIds: [channelId], message: batchMessage })
      }
    }
  }

  /**
   * Get the number of channels with pending messages.
   * Useful for testing and debugging.
   */
  get pendingChannelCount(): number {
    return this.#buffer.size
  }

  /**
   * Get the total number of pending messages across all channels.
   * Useful for testing and debugging.
   */
  get pendingMessageCount(): number {
    let count = 0
    for (const messages of this.#buffer.values()) {
      count += messages.length
    }
    return count
  }

  /**
   * Check if there are any pending messages.
   */
  get hasPending(): boolean {
    return this.#buffer.size > 0
  }
}
