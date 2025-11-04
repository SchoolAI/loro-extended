import { getLogger, type Logger } from "@logtape/logtape"
import type {
  AddressedEstablishedEnvelope,
  AddressedEstablishmentEnvelope,
} from "../channel.js"
import type { AnyAdapter } from "./adapter.js"
import type { HandleSendFn } from "./types.js"

type AdapterManagerParams = {
  adapters: AnyAdapter[]
  onReset: (adapter: AnyAdapter) => void
  onSend?: HandleSendFn
  logger?: Logger
}

/**
 * The AdapterManager is responsible for sending an AddressedEnvelope to its addressee
 * via the adapters it is given.
 */
export class AdapterManager {
  readonly adapters: AnyAdapter[]
  readonly onReset: (adapter: AnyAdapter) => void
  readonly logger: Logger

  constructor({ adapters, onReset, onSend, logger }: AdapterManagerParams) {
    if (onSend) {
      for (const adapter of adapters) {
        adapter.onSend = onSend
      }
    }

    this.adapters = adapters
    this.onReset = onReset
    this.logger = logger ?? getLogger(["@loro-extended", "repo"])
  }

  /**
   * Send an establishment message (establish-request or establish-response).
   * These messages can be sent to channels that are not yet established.
   */
  sendEstablishmentMessage(envelope: AddressedEstablishmentEnvelope): number {
    let sentCount = 0

    for (const adapter of this.adapters) {
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

    for (const adapter of this.adapters) {
      sentCount += adapter._send(envelope)
    }

    return sentCount
  }

  reset() {
    for (const adapter of this.adapters) {
      // Let the adapter clean up its part
      adapter._stop()

      // Clean up our per-adapter part
      this.onReset(adapter)
    }

    this.adapters.length = 0
  }
}
