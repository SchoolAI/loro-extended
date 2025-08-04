import { change, type AsLoro, type LoroProxyDoc } from "@loro-extended/change"
import Emittery from "emittery"
import { LoroDoc } from "loro-crdt"

import type { DocumentId } from "./types.js"

/** The possible states a DocHandle can be in. */
export type HandleState =
  /** The handle has been created but not yet loaded or requested. */
  | "idle"
  /** We are waiting for storage to finish loading. */
  | "loading"
  /** We are searching for the document on the network. */
  | "searching"
  /** A peer has announced they have the document, and we are waiting for them to send it. */
  | "syncing"
  /** The document is available and ready for interaction. */
  | "ready"
  /** The document was not found in storage or from any connected peers. */
  | "unavailable"
  /** The document has been marked as deleted. */
  | "deleted"

// Define the events that the DocHandle can emit, with their expected payload
type DocHandleEvents<T extends Record<string, any>> = {
  "state-change": { oldState: HandleState; newState: HandleState }
  change: { doc: LoroProxyDoc<AsLoro<T>> }
  "sync-message": Uint8Array
}

/**
 * Manages the lifecycle of a Loro document, providing a state machine,
 * a mutation API, and event handling for changes and synchronization.
 *
 * @typeParam T - The plain JavaScript object schema for the document.
 */
export class DocHandle<T extends Record<string, any>> {
  /** The unique identifier for the document. */
  public readonly documentId: DocumentId
  #state: HandleState = "idle"
  #doc?: LoroProxyDoc<AsLoro<T>>

  /**
   * The ID of a timeout that is running to transition the handle to a new state.
   * This is used by the CollectionSynchronizer to manage timers.
   * @internal
   */
  public _stateTimeoutId?: NodeJS.Timeout

  /** @internal */
  _emitter = new Emittery<DocHandleEvents<T>>()

  public on = this._emitter.on.bind(this._emitter)
  public once = this._emitter.once.bind(this._emitter)
  public off = this._emitter.off.bind(this._emitter)

  constructor(documentId: DocumentId) {
    this.documentId = documentId
    // DocHandles should be created by a Repo, which will call load().
    // We do not call load() here automatically.
  }

  /** The current state of the handle. */
  public get state(): HandleState {
    return this.#state
  }

  /**
   * Returns a promise that resolves when the document is in a terminal state
   * ('ready', 'unavailable', or 'deleted'). Unlike the old `whenReady`, this
   * method does not throw an exception if the document becomes unavailable or is
   * deleted.
   *
   * @returns A promise that resolves with the handle's terminal state.
   */
  public async whenReady(): Promise<{
    status: "ready" | "unavailable" | "deleted"
  }> {
    for await (const state of this.stateStream()) {
      if (state === "ready") return { status: "ready" }
      if (state === "unavailable") return { status: "unavailable" }
      if (state === "deleted") return { status: "deleted" }
    }
    // This line should be unreachable if the state machine is correct.
    return { status: this.state as "ready" | "unavailable" | "deleted" }
  }

  /**
   * Returns an async iterable that yields the handle's state as it changes.
   * The first value yielded is always the current state.
   * @internal
   */
  async *stateStream(): AsyncIterable<HandleState> {
    const events = this._emitter.events("state-change")
    try {
      yield this.state
      for await (const { newState } of events) {
        yield newState
      }
    } finally {
      // This is crucial to ensure the event listener is removed when the
      // consumer of the stream is finished.
      events.return?.()
    }
  }

  /**
   * Kicks off the loading process by calling the provided async function.
   * The handle will transition to 'loading', then to 'ready' if the
   * document is successfully loaded, or 'searching' if not found.
   *
   * @param getDoc A function that returns a promise resolving to the Loro document.
   */
  public async load(getDoc: () => Promise<LoroProxyDoc<AsLoro<T>> | null>) {
    if (this.state !== "idle") {
      return
    }

    this._setState("loading")

    const doc = await getDoc()
    if (this.#state !== "loading") {
      // This could happen if the handle was deleted while loading
      return
    }

    if (doc === null) {
      // If the document is not in storage, we need to ask the network.
      // The Repo will trigger this by listening for the state change.
      this._setState("searching")
      return
    }

    this.#init(doc)
  }

  /**
   * Returns the underlying LoroDoc's content.
   * @throws If the document is not in the 'ready' state.
   */
  public doc(): LoroProxyDoc<AsLoro<T>> {
    if (this.state !== "ready" || !this.#doc) {
      throw new Error(`DocHandle is not ready. Current state: '${this.state}'`)
    }
    return this.#doc
  }

  /** Marks the document as deleted. */
  public delete() {
    this._setState("deleted")
    // In the future, this will trigger deletion from storage and notify peers.
  }

  /**
   * The primary method for mutating the document.
   * @param mutator A function that receives a draft of the document to modify.
   */
  public change(mutator: (doc: AsLoro<T>) => void) {
    if (this.state !== "ready") {
      throw new Error(`Cannot change a document that is not ready.`)
    }

    const doc = this.doc()
    // The type assertion is safe because the `change` function from `loro-change`
    // provides the correctly typed proxy to the user's mutator.
    change(doc, mutator as (d: any) => void)
    this._emitter.emit("change", { doc })
  }

  /**
   * Applies a sync message from a remote peer to this document.
   * @param message The binary sync message.
   */
  public applySyncMessage(message: Uint8Array) {
    if (this.state === "deleted") {
      return // Don't apply changes to a deleted doc
    }

    // If we're idle, loading, or searching, this sync message is the doc's initial state
    if (!this.#doc) {
      const doc = new LoroDoc()
      doc.import(message)
      // The `change` function returns a proxy, which is what we need.
      const proxy = change(doc, () => {}) as LoroProxyDoc<AsLoro<T>>
      this.#init(proxy)
      return
    }

    // If we already have a doc, just import the new changes
    const doc = this.doc()
    doc.import(message)
    this._emitter.emit("change", { doc })
  }

  /**
   * Sets the handle's state and emits a 'state-change' event.
   * @param newState The state to transition to.
   */
  _setState(newState: HandleState) {
    if (this.#state === newState) {
      return
    }

    const oldState = this.#state
    this.#state = newState
    this._emitter.emit("state-change", {
      oldState,
      newState,
    })
  }

  #init(doc: LoroProxyDoc<AsLoro<T>>) {
    if (this.#doc) {
      throw new Error("DocHandle already has a document.")
    }
    this.#doc = doc
    this.#doc.subscribeLocalUpdates(update => {
      this._emitter.emit("sync-message", update)
    })
    this._setState("ready")
  }
}
