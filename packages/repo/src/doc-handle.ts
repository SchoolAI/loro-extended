import { type AsLoro, change, type LoroProxyDoc } from "@loro-extended/change"
import Emittery from "emittery"
import { LoroDoc } from "loro-crdt"
import { v4 as uuid } from "uuid"

import {
  type Command,
  type HandleState,
  type Message,
  init as programInit,
  update as programUpdate,
} from "./doc-handle-program.js"
import type { DocContent, DocumentId, RequestId } from "./types.js"

/** A dictionary of functions that the DocHandle can use to perform side effects. */
export interface DocHandleServices<T extends DocContent> {
  /** A function that returns a promise resolving to the Loro document from storage. */
  loadFromStorage: (
    documentId: DocumentId,
  ) => Promise<LoroProxyDoc<AsLoro<T>> | null>
  /** A function that returns a promise resolving to the Loro document from the network. */
  queryNetwork: (
    documentId: DocumentId,
    timeout: number,
  ) => Promise<LoroProxyDoc<AsLoro<T>> | null>
}

// The events that the DocHandle can emit, with their expected payload.
// Note that the state-change event now emits the full state objects.
type DocHandleEvents<T extends DocContent> = {
  "doc-handle-state-transition": {
    oldState: HandleState<T>
    newState: HandleState<T>
  }
  "doc-handle-change": { doc: LoroProxyDoc<AsLoro<T>> }
  "doc-handle-local-change": Uint8Array
}

/**
 * A handle to a Loro document that manages its lifecycle and state
 * transitions according to The Elm Architecture (TEA).
 *
 * This class acts as the "runtime" for a pure state machine defined in
 * `doc-handle-program.ts`. It dispatches messages to the program, receives
 * new state and commands, and executes the commands as side effects.
 *
 * @typeParam T - The plain JavaScript object schema for the document.
 */
export class DocHandle<T extends DocContent> {
  public readonly documentId: DocumentId
  #state: HandleState<T>
  #services: Partial<DocHandleServices<T>>
  #pendingRequests = new Map<
    RequestId,
    {
      resolve: (value: DocHandle<T>) => void
      reject: (reason?: any) => void
    }
  >()

  /** @internal */
  _emitter = new Emittery<DocHandleEvents<T>>()

  // Public event API
  public on = this._emitter.on.bind(this._emitter)
  public once = this._emitter.once.bind(this._emitter)
  public off = this._emitter.off.bind(this._emitter)

  constructor(
    documentId: DocumentId,
    services: Partial<DocHandleServices<T>> = {},
  ) {
    this.documentId = documentId
    this.#services = services

    const [initialState, initialCommand] = programInit<T>()
    this.#state = initialState
    if (initialCommand) {
      this.#executeCommand(initialCommand)
    }
  }

  /** The current state of the handle (e.g., "idle", "loading", "ready"). */
  public get state(): HandleState<T>["state"] {
    return this.#state.state
  }

  /** The full state object, for more detailed inspection. */
  public get stateObject(): HandleState<T> {
    return this.#state
  }

  // =-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=
  // PUBLIC API - Methods that dispatch messages to the state machine
  // =-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=

  /**
   * Finds a document, trying local storage first, then the network.
   * Does not create the document if it's not found.
   */
  public find(): Promise<DocHandle<T>> {
    const requestId = uuid()
    const promise = new Promise<DocHandle<T>>((resolve, reject) => {
      this.#pendingRequests.set(requestId, { resolve, reject })
    })

    this.#dispatch({ type: "msg-find", requestId })
    return promise
  }

  /**
   * Finds a document, trying local storage and the network. If not found after
   * a timeout, it creates the document.
   * @param options Configuration for the findOrCreate operation.
   */
  public findOrCreate(
    options: { timeout?: number } = {},
  ): Promise<DocHandle<T>> {
    const requestId = uuid()
    const promise = new Promise<DocHandle<T>>((resolve, reject) => {
      this.#pendingRequests.set(requestId, { resolve, reject })
    })

    this.#dispatch({
      type: "msg-find-or-create",
      requestId,
      timeout: options.timeout ?? 5000,
    })

    return promise
  }

  /**
   * Creates a document immediately. If the document already exists, it will
   * be merged with the existing document later.
   * @param options Configuration for the create operation.
   */
  public create(): Promise<DocHandle<T>> {
    const requestId = uuid()
    const promise = new Promise<DocHandle<T>>((resolve, reject) => {
      this.#pendingRequests.set(requestId, { resolve, reject })
    })

    this.#dispatch({
      type: "msg-create",
      requestId,
    })

    return promise
  }

  /** Marks the document as deleted. */
  public delete(): void {
    this.#dispatch({ type: "msg-delete" })
  }

  /**
   * The primary method for an application to mutate the document.
   * @param mutator A function that receives a draft of the document to modify.
   */
  public change(mutator: (doc: AsLoro<T>) => void): DocHandle<T> {
    if (this.state !== "ready") {
      throw new Error(
        `Cannot change a document that is not ready. Current state: '${this.state}'`,
      )
    }

    this.#dispatch({ type: "msg-local-change", mutator })

    // Useful for chaining after create or findOrCreate
    return this
  }

  /**
   * Applies a sync message from a remote peer to this document.
   * This is intended for internal use by the network subsystem.
   * @param message The binary sync message.
   * @internal
   */
  public applySyncMessage(message: Uint8Array): void {
    if (this.state === "ready" && "doc" in this.#state) {
      this.#dispatch({ type: "msg-remote-change", message })
    } else {
      // If we're not ready, we need to create a temporary doc to import into.
      const doc = new LoroDoc()
      doc.import(message)
      const proxy = change(doc, () => {}) as LoroProxyDoc<AsLoro<T>>
      this.#dispatch({ type: "msg-remote-change", message, doc: proxy })
    }
  }

  /**
   * Returns the underlying LoroDoc's content.
   * @throws If the document is not in the 'ready' state.
   */
  public doc(): LoroProxyDoc<AsLoro<T>> {
    if (this.#state.state !== "ready") {
      throw new Error(`DocHandle is not ready. Current state: '${this.state}'`)
    }
    return this.#state.doc
  }

  // =-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=
  // INTERNAL RUNTIME - The "impure" part that executes effects
  // =-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=

  /**
   * The core of the runtime. It takes a message, passes it to the pure `update`
   * function, gets the new state and command, updates its own state, and then
   * executes the command.
   */
  #dispatch(message: Message<T>): void {
    const [newState, command] = programUpdate(
      message,
      this.#state,
      this.documentId,
    )

    const oldState = this.#state
    if (newState !== oldState) {
      this.#state = newState
      this._emitter.emit("doc-handle-state-transition", { oldState, newState })
    }

    if (command) {
      this.#executeCommand(command)
    }
  }

  /**
   * Executes the side effects described by commands from the `update` function.
   * This is where all interaction with the outside world (storage, network, etc.) happens.
   */
  async #executeCommand(command: Command<T>): Promise<void> {
    switch (command.type) {
      case "cmd-load-from-storage": {
        if (!this.#services.loadFromStorage) {
          console.warn(
            "No `loadFromStorage` service provided to DocHandle. Taking no action.",
          )
          this.#dispatch({ type: "msg-storage-load-failure" })
          return
        }
        const doc = await this.#services.loadFromStorage(command.documentId)
        if (doc) {
          this.#dispatch({ type: "msg-storage-load-success", doc })
        } else {
          this.#dispatch({ type: "msg-storage-load-failure" })
        }
        break
      }

      case "cmd-query-network": {
        if (!this.#services.queryNetwork) {
          console.warn(
            "No `queryNetwork` service provided. Simulating timeout.",
          )
          setTimeout(
            () => this.#dispatch({ type: "msg-network-timeout" }),
            command.timeout,
          )
          return
        }
        const doc = await this.#services.queryNetwork(
          command.documentId,
          command.timeout,
        )
        if (doc) {
          this.#dispatch({ type: "msg-network-load-success", doc })
        } else {
          this.#dispatch({ type: "msg-network-timeout" })
        }
        break
      }

      case "cmd-create-doc": {
        const proxy = change(new LoroDoc(), doc => {
          const initialValue = command.initialValue?.()
          Object.assign(doc as object, initialValue)
        })

        // Treat creation like a successful load to transition to ready state
        this.#dispatch({ type: "msg-storage-load-success", doc: proxy })
        break
      }

      case "cmd-apply-local-change": {
        if (this.#state.state !== "ready") {
          // This should not happen if the program logic is correct
          console.warn("Cannot apply local change to a non-ready document.")
          return
        }
        change(this.#state.doc, command.mutator as (d: any) => void)
        break
      }

      case "cmd-apply-remote-change": {
        if (this.#state.state !== "ready") {
          // This should not happen if the program logic is correct
          console.warn("Cannot apply remote change to a non-ready document.")
          return
        }
        this.#state.doc.import(command.message)
        break
      }

      case "cmd-subscribe-to-doc": {
        // When any change happens (local or remote), notify listeners that the handle's doc has changed.
        command.doc.subscribe(_event => {
          this._emitter.emit("doc-handle-change", { doc: command.doc })
        })

        // When a local change happens, get the specific binary sync message and emit it.
        command.doc.subscribeLocalUpdates(syncMessage => {
          this._emitter.emit("doc-handle-local-change", syncMessage)
        })
        break
      }

      case "cmd-report-success": {
        const request = this.#pendingRequests.get(command.requestId)
        if (request) {
          request.resolve(this)
          this.#pendingRequests.delete(command.requestId)
        }
        break
      }

      case "cmd-report-failure": {
        const request = this.#pendingRequests.get(command.requestId)
        if (request) {
          request.reject(command.error)
          this.#pendingRequests.delete(command.requestId)
        }
        break
      }

      case "cmd-batch": {
        for (const cmd of command.commands) {
          this.#executeCommand(cmd)
        }
        break
      }

      default: {
        const unhandled: never = command
        throw new Error(`Unhandled command: ${JSON.stringify(unhandled)}`)
      }
    }
  }
}
