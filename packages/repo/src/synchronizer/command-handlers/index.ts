/**
 * Command Handler Registry
 *
 * This module exports a Map of command types to their handlers.
 * The registry is used by CommandExecutor to dispatch commands.
 *
 * To add a new command:
 * 1. Create a handler file: handle-<command-name>.ts
 * 2. Import the handler here
 * 3. Add it to the commandHandlers Map
 */

import type { Command } from "../../synchronizer-program.js"
import type { CommandHandler } from "../command-executor.js"

// Import individual handlers
import { handleApplyEphemeral } from "./handle-apply-ephemeral.js"
import { handleBatch } from "./handle-batch.js"
import { handleBroadcastEphemeralBatch } from "./handle-broadcast-ephemeral-batch.js"
import { handleBroadcastEphemeralNamespace } from "./handle-broadcast-ephemeral-namespace.js"
import { handleDispatch } from "./handle-dispatch.js"
import { handleEmitEphemeralChange } from "./handle-emit-ephemeral-change.js"
import { handleImportDocData } from "./handle-import-doc-data.js"
import { handleRemoveEphemeralPeer } from "./handle-remove-ephemeral-peer.js"
import { handleSendEstablishmentMessage } from "./handle-send-establishment-message.js"
import { handleSendMessage } from "./handle-send-message.js"
import { handleSendSyncRequest } from "./handle-send-sync-request.js"
import { handleSendSyncResponse } from "./handle-send-sync-response.js"
import { handleStopChannel } from "./handle-stop-channel.js"
import { handleSubscribeDoc } from "./handle-subscribe-doc.js"

/**
 * Registry of command handlers.
 *
 * Each entry maps a command type to its handler function.
 * The CommandExecutor uses this registry to dispatch commands.
 */
export const commandHandlers: Map<Command["type"], CommandHandler> = new Map([
  ["cmd/stop-channel", handleStopChannel as CommandHandler],
  [
    "cmd/send-establishment-message",
    handleSendEstablishmentMessage as CommandHandler,
  ],
  ["cmd/send-message", handleSendMessage as CommandHandler],
  ["cmd/send-sync-response", handleSendSyncResponse as CommandHandler],
  ["cmd/send-sync-request", handleSendSyncRequest as CommandHandler],
  ["cmd/subscribe-doc", handleSubscribeDoc as CommandHandler],
  ["cmd/import-doc-data", handleImportDocData as CommandHandler],
  ["cmd/emit-ephemeral-change", handleEmitEphemeralChange as CommandHandler],
  ["cmd/apply-ephemeral", handleApplyEphemeral as CommandHandler],
  [
    "cmd/broadcast-ephemeral-batch",
    handleBroadcastEphemeralBatch as CommandHandler,
  ],
  [
    "cmd/broadcast-ephemeral-namespace",
    handleBroadcastEphemeralNamespace as CommandHandler,
  ],
  ["cmd/remove-ephemeral-peer", handleRemoveEphemeralPeer as CommandHandler],
  ["cmd/dispatch", handleDispatch as CommandHandler],
  ["cmd/batch", handleBatch as CommandHandler],
])

// Re-export types for convenience
export type { CommandContext, CommandHandler } from "../command-executor.js"
export { CommandExecutor } from "../command-executor.js"
