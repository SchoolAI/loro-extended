import type { Logger } from "@logtape/logtape"
import type Emittery from "emittery"
import type { EphemeralStore, VersionVector } from "loro-crdt"
import type { AdapterManager } from "../adapter/adapter-manager.js"
import type { BatchableMsg } from "../channel.js"
import type {
  Command,
  SynchronizerMessage,
  SynchronizerModel,
} from "../synchronizer-program.js"
import type {
  ChannelId,
  DocId,
  PeerID,
  PeerIdentityDetails,
  ReadyState,
} from "../types.js"
import type { EphemeralStoreManager } from "./ephemeral-store-manager.js"
import type { OutboundBatcher } from "./outbound-batcher.js"

// =-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=
// TYPES
// =-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=

/**
 * Events that the Synchronizer can emit.
 * This type is used by command handlers to emit events.
 */
export type SynchronizerEvents = {
  "ready-state-changed": {
    docId: string
    readyStates: ReadyState[]
  }
  "ephemeral-change": {
    docId: string
    source: "local" | "remote"
    keys?: string[]
    peerId?: string
  }
}

/**
 * Context provided to command handlers.
 *
 * This contains all the dependencies a command handler might need to execute.
 * The context is created fresh for each command execution to ensure handlers
 * always have access to the latest state.
 */
export type CommandContext = {
  // Model access (read-only snapshot)
  readonly model: SynchronizerModel

  // Services
  readonly adapters: AdapterManager
  readonly ephemeralManager: EphemeralStoreManager
  readonly outboundBatcher: OutboundBatcher
  readonly emitter: Emittery<SynchronizerEvents>

  // Identity
  readonly identity: PeerIdentityDetails

  // Utilities
  readonly logger: Logger
  readonly dispatch: (msg: SynchronizerMessage) => void
  readonly executeCommand: (cmd: Command) => void // For recursive commands

  // Helper functions extracted from Synchronizer
  readonly validateChannelForSend: (channelId: ChannelId) => boolean
  readonly queueSend: (channelId: ChannelId, message: BatchableMsg) => void
  readonly getNamespacedStore: (
    docId: DocId,
    namespace: string,
  ) => EphemeralStore | undefined
  readonly getOrCreateNamespacedStore: (
    docId: DocId,
    namespace: string,
  ) => EphemeralStore
  readonly encodeAllPeerStores: (
    docId: DocId,
  ) => { docId: DocId; peerId: PeerID; data: Uint8Array; namespace: string }[]
  readonly buildSyncResponseMessage: (
    docId: DocId,
    requesterDocVersion: VersionVector,
    toChannelId: ChannelId,
    includeEphemeral?: boolean,
  ) => import("../channel.js").ChannelMsgSyncResponse | undefined
  readonly buildSyncRequestMessage: (
    doc: { docId: DocId; requesterDocVersion: VersionVector },
    bidirectional: boolean,
    includeEphemeral?: boolean,
  ) => import("../channel.js").ChannelMsgSyncRequest

  // Access to docNamespacedStores for cmd/broadcast-ephemeral-batch and cmd/remove-ephemeral-peer
  readonly docNamespacedStores: Map<DocId, Map<string, EphemeralStore>>
}

/**
 * A command handler function.
 *
 * Handlers are pure functions that take a command and context,
 * and perform side effects through the context's services.
 *
 * @template T - The specific command type this handler processes
 */
export type CommandHandler<T extends Command = Command> = (
  command: T,
  ctx: CommandContext,
) => void

// =-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=
// COMMAND EXECUTOR
// =-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=

/**
 * CommandExecutor - Executes commands using a registry of handlers.
 *
 * This class decouples command execution from the Synchronizer class,
 * allowing handlers to be tested in isolation and new commands to be
 * added without modifying the Synchronizer.
 *
 * @example
 * ```typescript
 * const executor = new CommandExecutor(
 *   commandHandlers,
 *   () => synchronizer.buildCommandContext(),
 * )
 *
 * executor.execute({ type: "cmd/stop-channel", channel })
 * ```
 */
export class CommandExecutor {
  readonly #handlers: Map<Command["type"], CommandHandler>
  readonly #contextProvider: () => CommandContext

  constructor(
    handlers: Map<Command["type"], CommandHandler>,
    contextProvider: () => CommandContext,
  ) {
    this.#handlers = handlers
    this.#contextProvider = contextProvider
  }

  /**
   * Execute a command by looking up its handler and invoking it.
   *
   * @param command - The command to execute
   * @throws Error if no handler is registered for the command type
   */
  execute(command: Command): void {
    const handler = this.#handlers.get(command.type)
    if (!handler) {
      throw new Error(`Unknown command type: ${command.type}`)
    }
    handler(command, this.#contextProvider())
  }

  /**
   * Check if a handler is registered for a command type.
   */
  hasHandler(type: Command["type"]): boolean {
    return this.#handlers.has(type)
  }

  /**
   * Get the number of registered handlers.
   */
  get handlerCount(): number {
    return this.#handlers.size
  }
}
