/** biome-ignore-all lint/suspicious/noExplicitAny: simplify tests */

import { LoroDoc, type LoroMap } from "loro-crdt"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { DocHandle, type DocHandleServices } from "./doc-handle.js"

// Helper to wait for one or more events
const waitForEvents = (
  handle: DocHandle<any>,
  eventName: string,
  count: number,
) => {
  return new Promise<void>(resolve => {
    let events = 0
    const listener = () => {
      events++
      if (events === count) {
        handle.off(eventName as any, listener)
        resolve()
      }
    }
    handle.on(eventName as any, listener)
  })
}

const waitForEvent = (handle: DocHandle<any>, eventName: string) =>
  waitForEvents(handle, eventName, 1)

describe("DocHandle Integration Tests", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it("should initialize in an idle state", () => {
    const handle = new DocHandle("test-doc")
    expect(handle.state).toBe("idle")
  })

  it("should become 'unavailable' if find() is unsuccessful (no return)", async () => {
    const services: DocHandleServices<any> = {
      loadFromStorage: vi.fn().mockResolvedValue(null),
      queryNetwork: vi.fn(),
    }
    const handle = new DocHandle("test-doc", services)

    // We don't await the promise here because we want to inspect the intermediate state
    handle.find()
    expect(handle.state).toBe("storage-loading")
    await vi.runAllTimersAsync()

    // The state transition to storage-loading is synchronous
    expect(handle.state).toBe("unavailable")
    expect(services.loadFromStorage).toHaveBeenCalledWith("test-doc")
  })

  it("should transition through the find flow to ready", async () => {
    const doc = new LoroDoc()
    const services: DocHandleServices<any> = {
      loadFromStorage: vi.fn().mockResolvedValue(doc),
      queryNetwork: vi.fn(),
    }
    const handle = new DocHandle("test-doc", services)

    const resolvedHandle = await handle.find()

    expect(resolvedHandle.state).toBe("ready")
    expect(resolvedHandle.doc()).toBe(doc)
    expect(services.loadFromStorage).toHaveBeenCalledOnce()
    expect(handle).toBe(resolvedHandle) // The resolved handle should be the same instance
  })

  it("should create a document if findOrCreate times out", async () => {
    const services: DocHandleServices<any> = {
      loadFromStorage: vi.fn().mockResolvedValue(null),
      queryNetwork: vi.fn().mockResolvedValue(null),
    }

    const handle = new DocHandle("test-doc", services)
    await handle.findOrCreate()

    expect(handle.state).toBe("ready")
    expect(handle.doc()).toBeInstanceOf(LoroDoc)
  })

  it("should allow changing a document once ready", async () => {
    type TestSchema = { root: LoroMap<{ text: string }> }
    const doc = new LoroDoc<TestSchema>()
    const services: DocHandleServices<TestSchema> = {
      loadFromStorage: async () => doc,
      queryNetwork: async () => null,
    }
    const handle = new DocHandle<TestSchema>("test-doc", services)

    await handle.find()

    const changePromise = waitForEvent(handle, "doc-handle-change")

    handle.change(doc => {
      const root = doc.getMap("root")
      root.set("text", "hello world")
    })

    await changePromise
    const loroDoc = handle.doc()
    const jsDoc = loroDoc.getMap("root").toJSON()
    expect(jsDoc.text).toBe("hello world")
  })

  it("should emit a 'sync-message' after a local change", async () => {
    const doc = new LoroDoc()
    const services = {
      loadFromStorage: async () => doc,
    }
    const handle = new DocHandle("test-doc", services)

    await handle.find()

    const syncPromise = waitForEvent(handle, "doc-handle-local-change")
    const listener = vi.fn()
    handle.on("doc-handle-local-change", listener)

    handle.change(doc => {
      const root = doc.getMap("root")
      root.set("text", "hello")
    })

    await syncPromise
    expect(listener).toHaveBeenCalledOnce()
    expect(listener.mock.calls[0][0]).toBeInstanceOf(Uint8Array)
  })

  it("should throw when trying to change a non-ready document", () => {
    const handle = new DocHandle("test-doc")
    expect(handle.state).not.toBe("ready")
    expect(() => {
      handle.change(() => {})
    }).toThrow()
  })

  it("should sync changes between two handles", async () => {
    // Setup handle A
    const handleA = new DocHandle<any>("sync-doc")
    await handleA.create()

    // Setup handle B
    const handleB = new DocHandle<any>("sync-doc")
    await handleB.create()

    // Pipe messages from A to B
    handleA.on("doc-handle-local-change", message => {
      handleB.applySyncMessage(message)
    })

    const changePromise = waitForEvent(handleB, "doc-handle-change")
    handleA.change(doc => {
      const root = doc.getMap("root")
      root.set("text", "synced")
    })

    await changePromise

    const retrievedDocB = handleB.doc()
    const jsDocB = retrievedDocB.getMap("root").toJSON()
    expect(jsDocB.text).toBe("synced")
  })
})
