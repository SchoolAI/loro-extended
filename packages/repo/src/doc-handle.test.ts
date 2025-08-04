/** biome-ignore-all lint/suspicious/noExplicitAny: ok for tests */

import type { AsLoro, LoroProxyDoc } from "@loro-extended/change"
import { LoroDoc } from "loro-crdt"
import { describe, expect, it, vi } from "vitest"

import { DocHandle } from "./doc-handle.js"

// Helper to wait for a specific event
const waitForEvent = (handle: DocHandle<any>, eventName: string) => {
  return handle.once(eventName as any)
}

describe("DocHandle", () => {
  it("should initialize in an idle state", () => {
    const handle = new DocHandle("test-doc")
    expect(handle.state).toBe("idle")
  })

  it("should transition to loading and then ready state", async () => {
    const handle = new DocHandle("test-doc")
    expect(handle.state).toBe("idle")
    const loadPromise = handle.load(
      async () => new LoroDoc() as LoroProxyDoc<any>,
    )
    expect(handle.state).toBe("loading")
    await loadPromise
    expect(handle.state).toBe("ready")
  })

  it("whenReady() should wait for load, and resolve immediately once ready", async () => {
    const handle = new DocHandle("test-doc")

    // 1. Create a loader that we can resolve manually
    let resolveLoad!: (doc: LoroProxyDoc<any>) => void
    const loadingPromise = new Promise<LoroProxyDoc<any>>(resolve => {
      resolveLoad = resolve
    })
    const getDoc = () => loadingPromise

    // 2. Start loading. The handle should transition to the 'loading' state.
    handle.load(getDoc)
    expect(handle.state).toBe("loading")

    // 3. The first call to whenReady()
    const readyPromise = handle.whenReady()

    // 4. Manually resolve the loader, fulfilling the loading promise
    resolveLoad(new LoroDoc() as LoroProxyDoc<any>)
    await readyPromise // This should now resolve
    expect(handle.state).toBe("ready")

    // 5. Call whenReady() again now that the handle is already 'ready'
    const alreadyReadyPromise = handle.whenReady()
    await alreadyReadyPromise
    // check that it resolves immediately
    expect(handle.state).toBe("ready")
  })

  it("should emit a 'state-change' event when state changes", async () => {
    const handle = new DocHandle("test-doc")
    const listener = vi.fn()
    handle.on("state-change", listener)

    await handle.load(async () => new LoroDoc() as LoroProxyDoc<any>)

    // Expect idle -> loading and loading -> ready
    expect(listener).toHaveBeenCalledWith({
      oldState: "idle",
      newState: "loading",
    })
    expect(listener).toHaveBeenCalledWith({
      oldState: "loading",
      newState: "ready",
    })
  })

  it("should allow changing a document", async () => {
    type TestSchema = { text: string }
    const handle = new DocHandle<TestSchema>("test-doc")
    await handle.load(
      async () => new LoroDoc() as LoroProxyDoc<AsLoro<TestSchema>>,
    )

    const changePromise = waitForEvent(handle, "change")

    handle.change(doc => {
      doc.text = "hello world"
    })

    await changePromise

    const loroDoc = handle.doc()
    const jsDoc = loroDoc.getMap("root").toJSON()
    expect(jsDoc.text).toBe("hello world")
  })

  it("should emit a 'sync-message' after a change", async () => {
    type TestSchema = { text: string }
    const handle = new DocHandle<TestSchema>("test-doc")
    await handle.load(
      async () => new LoroDoc() as LoroProxyDoc<AsLoro<TestSchema>>,
    )

    const syncPromise = waitForEvent(handle, "sync-message")
    const listener = vi.fn()
    handle.on("sync-message", listener)

    handle.change((doc: TestSchema) => {
      doc.text = "hello"
    })

    await syncPromise
    expect(listener).toHaveBeenCalledOnce()
    expect(listener.mock.calls[0][0]).toBeInstanceOf(Uint8Array)
  })

  it("should throw an error when trying to change a non-ready document", () => {
    const handle = new DocHandle("test-doc")
    // Do not call load(), so handle remains 'idle'
    expect(() => {
      handle.change(() => {
        // this should not run
      })
    }).toThrow("Cannot change a document that is not ready.")
  })

  it("should transition to deleted state", async () => {
    const handle = new DocHandle("test-doc")
    const listener = vi.fn()
    handle.on("state-change", listener)
    const stateChangePromise = waitForEvent(handle, "state-change")
    handle.delete()
    await stateChangePromise
    expect(handle.state).toBe("deleted")
    expect(listener).toHaveBeenCalledWith({
      oldState: "idle",
      newState: "deleted",
    })
  })

  it("should sync changes between two handles", async () => {
    type TestSchema = { text?: string }
    const handleA = new DocHandle<TestSchema>("sync-doc")
    const handleB = new DocHandle<TestSchema>("sync-doc")

    const docA = new LoroDoc() as LoroProxyDoc<AsLoro<TestSchema>>
    const docB = new LoroDoc() as LoroProxyDoc<AsLoro<TestSchema>>

    // Simulate the repo loading the docs and initializing the handles
    const loadAPromise = handleA.load(async () => docA)
    const loadBPromise = handleB.load(async () => docB)

    await Promise.all([loadAPromise, loadBPromise])

    // Pipe messages from A to B
    handleA.on("sync-message", message => {
      handleB.applySyncMessage(message)
    })

    const changePromise = waitForEvent(handleB, "change")
    handleA.change(doc => {
      doc.text = "synced"
    })

    await changePromise

    const retrievedDocB = handleB.doc()
    const jsDocB = retrievedDocB.getMap("root").toJSON()
    expect(jsDocB.text).toBe("synced")
  })

  it("should transition to searching state if load returns null", async () => {
    const handle = new DocHandle("test-doc")
    const listener = vi.fn()
    handle.on("state-change", listener)

    await handle.load(async () => null)

    expect(handle.state).toBe("searching")
    expect(listener).toHaveBeenCalledWith({
      oldState: "idle",
      newState: "loading",
    })
    expect(listener).toHaveBeenCalledWith({
      oldState: "loading",
      newState: "searching",
    })
  })

  it("whenReady() should not resolve while the document is searching", async () => {
    const handle = new DocHandle("test-doc")

    let isReady = false
    handle.whenReady().then(() => {
      isReady = true
    })

    // a load that returns null will put the handle in a 'searching' state
    await handle.load(async () => null)
    expect(handle.state).toBe("searching")

    // Give a chance for the promise to resolve if it were to do so incorrectly
    await new Promise(r => setTimeout(r, 0))

    // whenReady() promise should not have resolved
    expect(isReady).toBe(false)
  })
})
