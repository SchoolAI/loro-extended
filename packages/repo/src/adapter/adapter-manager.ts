import { getLogger, type Logger } from "@logtape/logtape"
import type {
  AddressedEstablishedEnvelope,
  AddressedEstablishmentEnvelope,
} from "../channel.js"
import type { AdapterContext, AnyAdapter } from "./adapter.js"
import type { HandleSendFn } from "./types.js"

type AdapterManagerParams = {
  adapters?: AnyAdapter[]
  context: AdapterContext
  onReset: (adapter: AnyAdapter) => void
  onSend?: HandleSendFn
  logger?: Logger
}

/**
 * The AdapterManager is responsible for managing adapters and sending
 * AddressedEnvelopes to their addressees via the adapters.
 *
 * Supports dynamic add/remove of adapters at runtime.
 */
export class AdapterManager {
  readonly #adapters = new Map<string, AnyAdapter>()
  readonly #context: AdapterContext
  readonly #onReset: (adapter: AnyAdapter) => void
  readonly #onSend?: HandleSendFn
  readonly logger: Logger

  constructor({
    adapters = [],
    context,
    onReset,
    onSend,
    logger,
  }: AdapterManagerParams) {
    this.#context = context
    this.#onReset = onReset
    this.#onSend = onSend
    this.logger = logger ?? getLogger(["@loro-extended", "repo"])

    // Initialize provided adapters synchronously (existing behavior)
    for (const adapter of adapters) {
      this.#initializeAdapter(adapter)
    }

    // Note: Adapters are NOT started here. Call startAll() after construction
    // to start all adapters. This allows the Synchronizer to finish initialization
    // before adapters start triggering callbacks.
  }

  /**
   * Start all adapters that were provided in the constructor.
   * This should be called after the Synchronizer is fully initialized.
   */
  startAll(): void {
    for (const adapter of this.#adapters.values()) {
      void adapter._start()
    }
  }

  #initializeAdapter(adapter: AnyAdapter): void {
    if (this.#onSend) {
      adapter.onSend = this.#onSend
    }
    adapter._initialize(this.#context)
    this.#adapters.set(adapter.adapterId, adapter)
  }

  /**
   * Get all adapters as an array.
   */
  get adapters(): AnyAdapter[] {
    return Array.from(this.#adapters.values())
  }

  /**
   * Check if an adapter exists by ID.
   */
  hasAdapter(adapterId: string): boolean {
    return this.#adapters.has(adapterId)
  }

  /**
   * Get an adapter by ID.
   */
  getAdapter(adapterId: string): AnyAdapter | undefined {
    return this.#adapters.get(adapterId)
  }

  /**
   * Add an adapter at runtime.
   * Idempotent: adding an adapter with the same adapterId is a no-op.
   */
  async addAdapter(adapter: AnyAdapter): Promise<void> {
    if (this.#adapters.has(adapter.adapterId)) {
      this.logger.debug("Adapter {adapterId} already exists, skipping add", {
        adapterId: adapter.adapterId,
      })
      return
    }

    // Initialize and start the adapter
    this.#initializeAdapter(adapter)
    await adapter._start()

    this.logger.info("Added adapter {adapterId} of type {adapterType}", {
      adapterId: adapter.adapterId,
      adapterType: adapter.adapterType,
    })
  }

  /**
   * Remove an adapter at runtime.
   * Idempotent: removing a non-existent adapter is a no-op.
   *
   * The sync protocol will naturally recover any "lost" state on the next
   * heartbeat or user-initiated sync.
   */
  async removeAdapter(adapterId: string): Promise<void> {
    const adapter = this.#adapters.get(adapterId)
    if (!adapter) {
      this.logger.debug("Adapter {adapterId} not found, skipping remove", {
        adapterId,
      })
      return
    }

    // Clean up channels via callback
    this.#onReset(adapter)

    // Stop the adapter
    await adapter._stop()

    // Remove from our map
    this.#adapters.delete(adapterId)

    this.logger.info("Removed adapter {adapterId}", { adapterId })
  }

  /**
   * Send an establishment message (establish-request or establish-response).
   * These messages can be sent to channels that are not yet established.
   */
  sendEstablishmentMessage(envelope: AddressedEstablishmentEnvelope): number {
    let sentCount = 0

    for (const adapter of this.#adapters.values()) {
      sentCount += adapter._send(envelope)
    }

    return sentCount
  }

  /**
   * Send an established message (sync, directory, delete).
   * These messages can only be sent to channels that have been established.
   */
  send(envelope: AddressedEstablishedEnvelope): number {
    let sentCount = 0

    for (const adapter of this.#adapters.values()) {
      sentCount += adapter._send(envelope)
    }

    return sentCount
  }

  /**
   * Await all pending async operations across all adapters.
   *
   * This is useful for ensuring all storage saves have completed
   * before shutting down. Does NOT disconnect adapters.
   */
  async flush(): Promise<void> {
    await Promise.all(
      Array.from(this.#adapters.values()).map(adapter => adapter.flush()),
    )
  }

  /**
   * Reset all adapters and clear the manager.
   */
  reset() {
    for (const adapter of this.#adapters.values()) {
      // Let the adapter clean up its part
      adapter._stop()

      // Clean up our per-adapter part
      this.#onReset(adapter)
    }

    this.#adapters.clear()
  }

  /**
   * Gracefully shut down all adapters: flush pending operations, then reset.
   *
   * This ensures all in-flight storage saves complete before adapters
   * are disconnected and removed.
   */
  async shutdown(): Promise<void> {
    // First, flush all pending operations (especially storage saves)
    await this.flush()

    // Then reset (stop adapters and clear)
    for (const adapter of this.#adapters.values()) {
      // Let the adapter clean up its part
      await adapter._stop()

      // Clean up our per-adapter part
      this.#onReset(adapter)
    }

    this.#adapters.clear()
  }
}
