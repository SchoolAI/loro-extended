/** biome-ignore-all lint/suspicious/noExplicitAny: tests */

import { LoroDoc, type LoroMap } from "loro-crdt"
import { describe, expect, it } from "vitest"
import { init, update } from "./doc-handle-program.js"
import type { DocumentId, RequestId } from "./types.js"

type TestSchema = {
  root: LoroMap<{
    text: string
  }>
}

describe("DocHandle program", () => {
  const docId = "test-doc" as DocumentId
  const reqId = "request-1" as RequestId

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
        timeout: 5000
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
        doc.getMap("root").set("text", "hello")
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
})
