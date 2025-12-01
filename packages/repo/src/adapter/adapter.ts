import { getLogger, type Logger } from "@logtape/logtape"
import type {
  AddressedEnvelope,
  Channel,
  ChannelId,
  ChannelMsg,
  ConnectedChannel,
  GeneratedChannel,
} from "../channel.js"
import { ChannelDirectory } from "../channel-directory.js"
import type { AdapterType, PeerIdentityDetails } from "../types.js"
import type { HandleSendFn } from "./types.js"

export type AnyAdapter = Adapter<any>

type AdapterParams = {
  adapterType: AdapterType
  logger?: Logger
}

export type AdapterHooks = {
  identity: PeerIdentityDetails
  onChannelReceive: (channel: Channel, message: ChannelMsg) => void
  onChannelAdded: (channel: ConnectedChannel) => void
  onChannelRemoved: (channel: Channel) => void
  onChannelEstablish: (channel: ConnectedChannel) => void
}

type AdapterLifecycleCreatedState = { state: "created" } // Constructor finished, not initialized

// biome-ignore format: left-align
type AdapterLifecycleInitializedState =
 & { state: "initialized" }
 & AdapterHooks

// biome-ignore format: left-align
type AdapterLifecycleStartedState =
 & { state: "started" }
 & AdapterHooks

type AdapterLifecycleStoppedState = { state: "stopped" }

type AdapterLifecycleState =
  | AdapterLifecycleCreatedState
  | AdapterLifecycleInitializedState
  | AdapterLifecycleStartedState
  | AdapterLifecycleStoppedState

export abstract class Adapter<G> {
  readonly adapterType: AdapterType
  readonly logger: Logger
  readonly channels: ChannelDirectory<G>

  // Used for debugging; set by AdapterManager
  onSend: HandleSendFn | undefined

  // Identity provided during initialization
  protected identity?: PeerIdentityDetails

  #lifecycle: AdapterLifecycleState = { state: "created" }

  constructor({ adapterType, logger }: AdapterParams) {
    this.adapterType = adapterType
    this.logger = (logger ?? getLogger())
      .getChild("adapter")
      .with({ adapterType })
    this.channels = new ChannelDirectory(this.generate.bind(this))
  }

  // ============================================================================
  // PROTECTED API - For Subclasses
  // ============================================================================

  /**
   * Create a channel. Only callable during "started" state.
   * The channel must be ready to send/receive immediately.
   */
  protected addChannel(context: G): ConnectedChannel {
    const lifecycle = this.#lifecycle

    if (lifecycle.state !== "started") {
      throw new Error(
        `can't add channel in '${lifecycle.state}' state (must be 'started')`,
      )
    }

    const channel = this.channels.create(context, message =>
      lifecycle.onChannelReceive(channel, message),
    )

    lifecycle.onChannelAdded(channel)

    return channel
  }

  /**
   * Remove a channel. Only callable during "started" state.
   */
  protected removeChannel(channelId: ChannelId): Channel | undefined {
    const lifecycle = this.#lifecycle

    if (lifecycle.state !== "started") {
      throw new Error(
        `can't remove channel in '${lifecycle.state}' state (must be 'started')`,
      )
    }

    const channel = this.channels.remove(channelId)

    if (channel) {
      lifecycle.onChannelRemoved(channel)
    }

    return channel
  }

  /**
   * Establish a channel by triggering the establishment handshake.
   * This should be called after addChannel() to initiate communication.
   * Only callable during "started" state.
   */
  protected establishChannel(channelId: ChannelId): void {
    const lifecycle = this.#lifecycle

    if (lifecycle.state !== "started") {
      throw new Error(
        `can't establish channel in '${lifecycle.state}' state (must be 'started')`,
      )
    }

    const channel = this.channels.get(channelId)
    if (!channel) {
      throw new Error(`can't establish channel ${channelId}: channel not found`)
    }

    // Only establish if channel is still in connected state
    if (channel.type === "connected") {
      lifecycle.onChannelEstablish(channel)
    }
  }

  /**
   * Generate a GeneratedChannel for the given context.
   * The returned channel must be ready to use immediately.
   */
  protected abstract generate(context: G): GeneratedChannel

  /**
   * Start the adapter. Create initial channels here.
   * For dynamic adapters (servers), set up listeners that will
   * call addChannel() when new connections arrive.
   */
  abstract onStart(): Promise<void>

  /**
   * Stop the adapter. Clean up resources and remove channels.
   */
  abstract onStop(): Promise<void>

  // ============================================================================
  // INTERNAL API - For Synchronizer
  // ============================================================================

  _initialize(hooks: AdapterHooks): void {
    if (
      this.#lifecycle.state !== "created" &&
      // Allow re-initialization if adapter was stopped (for adapter reuse in tests)
      this.#lifecycle.state !== "stopped"
    ) {
      throw new Error(`Adapter ${this.adapterType} already initialized`)
    }
    // Store identity for subclasses to access
    this.identity = hooks.identity
    this.#lifecycle = { state: "initialized", ...hooks }
  }

  async _start(): Promise<void> {
    if (this.#lifecycle.state !== "initialized") {
      throw new Error(
        `Cannot start adapter ${this.adapterType} in state ${this.#lifecycle.state}`,
      )
    }
    // Transition to started state BEFORE calling onStart so that
    // subclasses can call addChannel() during their onStart() implementation
    this.#lifecycle = { ...this.#lifecycle, state: "started" }
    await this.onStart()
  }

  async _stop(): Promise<void> {
    if (this.#lifecycle.state !== "started") {
      this.logger.warn(
        "Stopping adapter {adapterType} in unexpected state: {state.state}",
        {
          adapterType: this.adapterType,
          state: this.#lifecycle,
        },
      )
    }
    await this.onStop()
    this.channels.reset()
    this.#lifecycle = { state: "stopped" }
  }

  /**
   * Given an envelope with zero or more toChannelIds, attempts to send the
   * message (in the envelope) through this adapter's channels. Note that this
   * does NOT guarantee delivery, only sending will be attempted through any
   * matching channels.
   *
   * @param envelope an AddressedEnvelope with message inside
   * @returns the number of channels to which the message was sent
   */
  _send(envelope: AddressedEnvelope): number {
    let sentCount = 0

    for (const toChannelId of envelope.toChannelIds) {
      const channel = this.channels.get(toChannelId)
      if (channel) {
        this.onSend?.(this.adapterType, toChannelId, envelope.message)
        channel.send(envelope.message)
        sentCount++
      }
    }

    return sentCount
  }
}
