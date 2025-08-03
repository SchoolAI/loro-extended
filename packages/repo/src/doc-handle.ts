import { change, type AsLoro, type LoroProxyDoc } from "@loro-extended/change"
import Emittery from "emittery"
import { LoroDoc } from "loro-crdt"

import type { DocumentId } from "./types.js"

/** The possible states a DocHandle can be in. */
export type HandleState =
  /** The handle has been created but not yet loaded or requested. */
  | "idle"
  /** We are waiting for storage to finish loading or a peer to respond. */
  | "loading"
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
   * Returns a promise that resolves when the handle is in the 'ready' state.
   * If the handle is already 'ready', the promise resolves immediately.
   */
  public whenReady(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.state === "ready") {
        resolve()
        return
      }
      if (this.state === "unavailable" || this.state === "deleted") {
        reject(new Error(`Document is in state: ${this.state}`))
        return
      }

      const listener = ({ newState }: { newState: HandleState }) => {
        if (newState === "ready") {
          this._emitter.off("state-change", listener)
          resolve()
        } else if (newState === "unavailable" || newState === "deleted") {
          this._emitter.off("state-change", listener)
          reject(new Error(`Document entered state: ${newState}`))
        }
      }

      this._emitter.on("state-change", listener)
    })
  }

  /**
   * Kicks off the loading process by calling the provided async function.
   * The handle will transition to 'loading', then to 'ready' if the
   * document is successfully loaded, or 'unavailable' if an error occurs.
   *
   * @param getDoc A function that returns a promise resolving to the Loro document.
   */
  public async load(getDoc: () => Promise<LoroProxyDoc<AsLoro<T>> | null>) {
    if (this.state !== "idle") {
      return
    }

    this.#setState("loading")

    try {
      const doc = await getDoc()
      if (this.#state !== "loading") {
        // This could happen if the handle was deleted while loading
        return
      }

      if (doc === null) {
        // If the document is not in storage, it might be available
        // in another storage adapter, or via network. But we return
        // `unavailable` here for now until we support searching.
        this.#setState("unavailable")
        return
      }

      this.#doc = doc
      this.#doc.subscribeLocalUpdates(update => {
        this._emitter.emit("sync-message", update)
      })

      this.#setState("ready")
    } catch (error) {
      console.error("Error loading document:", error)
      this.#setState("unavailable")
    }
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
    this.#setState("deleted")
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

    // If we're idle/loading, this sync message is the doc's initial state
    if (!this.#doc) {
      this.#setState("loading")
      const doc = new LoroDoc()
      // Note: `change` sets up the proxy, but doesn't apply changes itself.
      // The proxy is needed so the user can interact with the doc later.
      this.#doc = change(doc, () => {}) as LoroProxyDoc<AsLoro<T>>
      doc.import(message)
      this.#doc.subscribeLocalUpdates(update => {
        this._emitter.emit("sync-message", update)
      })
      this.#setState("ready")
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
  #setState(newState: HandleState) {
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
}
