import { describe, expect, it } from "vitest"
import type {
  Command,
  SynchronizerMessage,
} from "../../synchronizer-program.js"
import { createMockCommandContext } from "../test-utils.js"
import { handleDispatch } from "./handle-dispatch.js"

type DispatchCommand = Extract<Command, { type: "cmd/dispatch" }>

describe("handleDispatch", () => {
  it("should dispatch the contained message", () => {
    const ctx = createMockCommandContext()

    const innerMessage: SynchronizerMessage = {
      type: "synchronizer/local-doc-change",
      docId: "doc-1",
    }

    const command: DispatchCommand = {
      type: "cmd/dispatch",
      dispatch: innerMessage,
    }

    handleDispatch(command, ctx)

    expect(ctx.dispatch).toHaveBeenCalledWith(innerMessage)
  })

  it("should dispatch exactly once", () => {
    const ctx = createMockCommandContext()

    const innerMessage: SynchronizerMessage = {
      type: "synchronizer/doc-ensure",
      docId: "doc-1",
    }

    const command: DispatchCommand = {
      type: "cmd/dispatch",
      dispatch: innerMessage,
    }

    handleDispatch(command, ctx)

    expect(ctx.dispatch).toHaveBeenCalledTimes(1)
  })

  it("should dispatch heartbeat message", () => {
    const ctx = createMockCommandContext()

    const innerMessage: SynchronizerMessage = {
      type: "synchronizer/heartbeat",
    }

    const command: DispatchCommand = {
      type: "cmd/dispatch",
      dispatch: innerMessage,
    }

    handleDispatch(command, ctx)

    expect(ctx.dispatch).toHaveBeenCalledWith({
      type: "synchronizer/heartbeat",
    })
  })

  it("should dispatch channel-added message", () => {
    const ctx = createMockCommandContext()

    const innerMessage: SynchronizerMessage = {
      type: "synchronizer/channel-added",
      channel: {
        type: "connected",
        channelId: 42,
        kind: "network",
        adapterType: "test",
        send: () => {},
        stop: () => {},
        onReceive: () => {},
      },
    }

    const command: DispatchCommand = {
      type: "cmd/dispatch",
      dispatch: innerMessage,
    }

    handleDispatch(command, ctx)

    expect(ctx.dispatch).toHaveBeenCalledWith(innerMessage)
  })

  it("should not use other context methods", () => {
    const ctx = createMockCommandContext()

    const innerMessage: SynchronizerMessage = {
      type: "synchronizer/doc-delete",
      docId: "doc-1",
    }

    const command: DispatchCommand = {
      type: "cmd/dispatch",
      dispatch: innerMessage,
    }

    handleDispatch(command, ctx)

    // The handler only dispatches, doesn't use other context methods
    expect(ctx.executeCommand).not.toHaveBeenCalled()
    expect(ctx.queueSend).not.toHaveBeenCalled()
  })
})
