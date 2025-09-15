/** biome-ignore-all lint/suspicious/noExplicitAny: tests */

import { LoroDoc, type LoroMap } from "loro-crdt"
import type { Patch } from "mutative"
import { describe, expect, it } from "vitest"
import { createDocHandleUpdate, init, update } from "./doc-handle-program.js"
import type { RequestId } from "./request-tracker.js"
import type { DocumentId } from "./types.js"

type TestSchema = {
  doc: LoroMap<{
    text: string
  }>
}

describe("DocHandle program", () => {
  const docId = "test-doc" as DocumentId
  const reqId: RequestId = 0

  it("init should start in idle", () => {
    const [state, command] = init()
    expect(state.state).toBe("idle")
    expect(command).toBeUndefined()
  })

  describe("find flow", () => {
    it("should transition from idle to storage-loading on find", () => {
      const [initialState] = init<TestSchema>()
      const [newState, command] = update(
        { type: "msg-find", requestId: reqId },
        initialState,
        docId,
      )

      expect(newState).toEqual({
        state: "storage-loading",
        operation: "find",
        requestId: reqId,
      })
      expect(command).toEqual({
        type: "cmd-load-from-storage",
        documentId: docId,
      })
    })

    it("should transition from storage-loading to ready on success", () => {
      const doc = new LoroDoc()
      const initialState = {
        state: "storage-loading",
        operation: "find",
        requestId: reqId,
      } as const
      const [newState, command] = update(
        { type: "msg-storage-load-success", doc },
        initialState,
        docId,
      )

      expect(newState.state).toBe("ready")
      expect(command).toEqual({
        type: "cmd-batch",
        commands: [
          { type: "cmd-subscribe-to-doc", doc },
          { type: "cmd-report-success", requestId: reqId, payload: doc },
        ],
      })
    })

    it("should transition from storage-loading to network-loading on failure", () => {
      const initialState = {
        state: "storage-loading",
        operation: "find",
        requestId: reqId,
      } as const
      const [newState, command] = update(
        { type: "msg-storage-load-failure" },
        initialState,
        docId,
      )

      expect(newState.state).toBe("network-loading")
      expect((newState as any).requestId).toBe(reqId)
      expect(command?.type).toBe("cmd-query-network")
    })

    it("should transition from network-loading to ready on success", () => {
      const doc = new LoroDoc()
      const initialState = {
        state: "network-loading",
        timeout: 5000,
        createOnTimeout: false,
        requestId: reqId,
      } as const
      const [newState, command] = update(
        { type: "msg-network-load-success", doc },
        initialState,
        docId,
      )

      expect(newState.state).toBe("ready")
      expect(command).toEqual({
        type: "cmd-batch",
        commands: [
          { type: "cmd-subscribe-to-doc", doc },
          { type: "cmd-report-success", requestId: reqId, payload: doc },
        ],
      })
    })

    it("should transition from network-loading to unavailable on timeout", () => {
      const initialState = {
        state: "network-loading",
        timeout: 5000,
        createOnTimeout: false,
        requestId: reqId,
      } as const
      const [newState, command] = update(
        { type: "msg-network-timeout" },
        initialState,
        docId,
      )

      expect(newState.state).toBe("unavailable")
      expect(command?.type).toBeUndefined()
    })
  })

  describe("findOrCreate flow", () => {
    it("should transition from idle to storage-loading on findOrCreate", () => {
      const [initialState] = init<TestSchema>()
      const [newState, command] = update(
        { type: "msg-find-or-create", timeout: 1000, requestId: reqId },
        initialState,
        docId,
      )

      expect(newState).toEqual({
        state: "storage-loading",
        operation: "find-or-create",
        requestId: reqId,
        timeout: 1000,
      })
      expect(command).toEqual({
        type: "cmd-load-from-storage",
        documentId: docId,
      })
    })

    it("should transition to network-loading if storage fails", () => {
      const initialState = {
        state: "storage-loading",
        operation: "find-or-create",
        requestId: reqId,
        timeout: 5000,
      } as const
      const [newState, command] = update(
        { type: "msg-storage-load-failure" },
        initialState,
        docId,
      )

      expect(newState.state).toBe("network-loading")
      expect((newState as any).requestId).toBe(reqId)
      expect((newState as any).createOnTimeout).toBe(true)
      expect(command).toEqual({
        type: "cmd-query-network",
        documentId: docId,
        timeout: 5000,
      })
    })

    it("should create document if network times out in findOrCreate", () => {
      const initialState = {
        state: "network-loading",
        requestId: reqId,
        timeout: 5000,
        createOnTimeout: true,
      } as const
      const [newState, command] = update(
        { type: "msg-network-timeout" },
        initialState,
        docId,
      )

      expect(newState.state).toBe("creating")
      expect((newState as any).requestId).toBe(reqId)
      expect(command).toEqual({ type: "cmd-create-doc", documentId: docId })
    })
  })

  describe("create flow", () => {
    it("should transition to creating and issue a create_doc command", () => {
      const [initialState] = init<TestSchema>()
      const [newState, command] = update(
        { type: "msg-create", requestId: reqId },
        initialState,
        docId,
      )

      expect(newState.state).toBe("creating")
      expect((newState as any).requestId).toBe(reqId)
      expect(command).toEqual({
        type: "cmd-create-doc",
        documentId: docId,
        initialValue: undefined,
      })
    })

    it("should handle an initial value function", () => {
      const [initialState] = init<TestSchema>()
      const initialize = (doc: LoroDoc) => {
        doc.getMap("doc").set("text", "hello")
      }
      const [newState, command] = update(
        { type: "msg-create", initialize, requestId: reqId },
        initialState,
        docId,
      )
      expect(newState.state).toBe("creating")
      expect((newState as any).requestId).toBe(reqId)
      expect(command).toEqual({
        type: "cmd-create-doc",
        documentId: docId,
        initialize,
      })
    })

    it("should transition to ready after creation", () => {
      const creatingState = { state: "creating", requestId: reqId } as const
      const doc = new LoroDoc()
      const [newState, command] = update(
        { type: "msg-storage-load-success", doc }, // creation is modeled as a storage success
        creatingState,
        docId,
      )

      expect(newState.state).toBe("ready")
      expect(command).toEqual({
        type: "cmd-batch",
        commands: [
          { type: "cmd-subscribe-to-doc", doc },
          { type: "cmd-report-success", requestId: reqId, payload: doc },
        ],
      })
    })
  })

  describe("change flows", () => {
    it("should issue an apply-remote-change command when ready", () => {
      const doc = new LoroDoc()
      const initialState = { state: "ready", doc } as const
      const message = new Uint8Array([1, 2, 3])
      const [newState, command] = update(
        { type: "msg-remote-change", message },
        initialState,
        docId,
      )

      expect(newState).toEqual(initialState)
      expect(command).toEqual({
        type: "cmd-apply-remote-change",
        doc,
        message,
      })
    })
  })

  describe("delete flow", () => {
    it("should transition to deleted from any state", () => {
      const states: any[] = [
        { state: "idle" },
        { state: "storage-loading", operation: "find" },
        {
          state: "network-loading",
          timeout: 5000,
          createOnTimeout: false,
        },
        { state: "ready", doc: {} },
        { state: "unavailable" },
      ]

      for (const initialState of states) {
        const [newState, command] = update(
          { type: "msg-delete" },
          initialState,
          docId,
        )
        expect(newState.state).toBe("deleted")
        expect(command).toBeUndefined()
      }
    })
  })

  describe("patch debugging (new pattern)", () => {
    it("should capture patches when using createDocHandleUpdate with onPatch callback", () => {
      const docId = "test-doc" as DocumentId
      const reqId: RequestId = 0
      const patches: Patch[] = []

      // Create update function with patch debugging enabled
      const updateWithPatches = createDocHandleUpdate<TestSchema>(
        docId,
        newPatches => {
          patches.push(...newPatches)
        },
      )

      // Start with idle state
      const [initialState] = init<TestSchema>()

      // Trigger a state transition that should generate patches
      const [newState, command] = updateWithPatches(
        { type: "msg-find", requestId: reqId },
        initialState,
      )

      // Verify the state transition worked correctly
      expect(newState).toEqual({
        state: "storage-loading",
        operation: "find",
        requestId: reqId,
      })
      expect(command).toEqual({
        type: "cmd-load-from-storage",
        documentId: docId,
      })

      // Verify that patches were captured
      expect(patches.length).toBeGreaterThan(0)

      // Check that patches contain the expected state changes
      const statePatch = patches.find(p => p.path[0] === "state")
      const operationPatch = patches.find(p => p.path[0] === "operation")
      const requestIdPatch = patches.find(p => p.path[0] === "requestId")

      expect(statePatch).toBeDefined()
      expect(statePatch?.value).toBe("storage-loading")
      expect(operationPatch).toBeDefined()
      expect(operationPatch?.value).toBe("find")
      expect(requestIdPatch).toBeDefined()
      expect(requestIdPatch?.value).toBe(reqId)
    })

    it("should work without patch callback (backward compatibility)", () => {
      const docId = "test-doc" as DocumentId
      const reqId: RequestId = 0

      // Create update function without patch debugging
      const updateWithoutPatches = createDocHandleUpdate<TestSchema>(docId)

      // Start with idle state
      const [initialState] = init<TestSchema>()

      // Trigger a state transition
      const [newState, command] = updateWithoutPatches(
        { type: "msg-find", requestId: reqId },
        initialState,
      )

      // Verify the state transition worked correctly (same as with patches)
      expect(newState).toEqual({
        state: "storage-loading",
        operation: "find",
        requestId: reqId,
      })
      expect(command).toEqual({
        type: "cmd-load-from-storage",
        documentId: docId,
      })
    })

    it("should demonstrate patch capture for complex state transitions", () => {
      const docId = "test-doc" as DocumentId
      const reqId: RequestId = 0
      const patches: Patch[] = []

      const updateWithPatches = createDocHandleUpdate<TestSchema>(
        docId,
        newPatches => {
          patches.push(...newPatches)
        },
      )

      // Start with storage-loading state
      const storageLoadingState = {
        state: "storage-loading",
        operation: "find",
        requestId: reqId,
      } as const

      const doc = new LoroDoc<TestSchema>()

      // Clear any existing patches
      patches.length = 0

      // Trigger transition to ready state
      const [newState, _command] = updateWithPatches(
        { type: "msg-storage-load-success", doc },
        storageLoadingState,
      )

      // Verify the transition
      expect(newState.state).toBe("ready")
      expect((newState as any).doc).toBe(doc)

      // Verify patches were captured for this more complex transition
      expect(patches.length).toBeGreaterThan(0)

      // Should have patches for state change and doc addition
      const statePatch = patches.find(p => p.path[0] === "state")
      const docPatch = patches.find(p => p.path[0] === "doc")

      expect(statePatch).toBeDefined()
      expect(statePatch?.value).toBe("ready")
      expect(docPatch).toBeDefined()
      expect(docPatch?.value).toBe(doc)
    })
  })
})
