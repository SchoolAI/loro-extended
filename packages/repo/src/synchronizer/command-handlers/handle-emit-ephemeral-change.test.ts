import { describe, expect, it, vi } from "vitest"
import type { Command } from "../../synchronizer-program.js"
import { createMockCommandContext } from "../test-utils.js"
import { handleEmitEphemeralChange } from "./handle-emit-ephemeral-change.js"

type EmitEphemeralChangeCommand = Extract<
  Command,
  { type: "cmd/emit-ephemeral-change" }
>

describe("handleEmitEphemeralChange", () => {
  it("should emit ephemeral-change event with local source", () => {
    const ctx = createMockCommandContext()
    const emitSpy = vi.spyOn(ctx.emitter, "emit")

    const command: EmitEphemeralChangeCommand = {
      type: "cmd/emit-ephemeral-change",
      docId: "doc-1",
    }

    handleEmitEphemeralChange(command, ctx)

    expect(emitSpy).toHaveBeenCalledWith("ephemeral-change", {
      docId: "doc-1",
      source: "local",
    })
  })

  it("should emit with correct docId", () => {
    const ctx = createMockCommandContext()
    const emitSpy = vi.spyOn(ctx.emitter, "emit")

    const command: EmitEphemeralChangeCommand = {
      type: "cmd/emit-ephemeral-change",
      docId: "my-custom-doc-id",
    }

    handleEmitEphemeralChange(command, ctx)

    expect(emitSpy).toHaveBeenCalledWith(
      "ephemeral-change",
      expect.objectContaining({
        docId: "my-custom-doc-id",
      }),
    )
  })

  it("should always emit with source=local", () => {
    const ctx = createMockCommandContext()
    const emitSpy = vi.spyOn(ctx.emitter, "emit")

    const command: EmitEphemeralChangeCommand = {
      type: "cmd/emit-ephemeral-change",
      docId: "doc-1",
    }

    handleEmitEphemeralChange(command, ctx)

    expect(emitSpy).toHaveBeenCalledWith(
      "ephemeral-change",
      expect.objectContaining({
        source: "local",
      }),
    )
  })

  it("should emit exactly once", () => {
    const ctx = createMockCommandContext()
    const emitSpy = vi.spyOn(ctx.emitter, "emit")

    const command: EmitEphemeralChangeCommand = {
      type: "cmd/emit-ephemeral-change",
      docId: "doc-1",
    }

    handleEmitEphemeralChange(command, ctx)

    expect(emitSpy).toHaveBeenCalledTimes(1)
  })

  it("should not use other context methods", () => {
    const ctx = createMockCommandContext()

    const command: EmitEphemeralChangeCommand = {
      type: "cmd/emit-ephemeral-change",
      docId: "doc-1",
    }

    handleEmitEphemeralChange(command, ctx)

    // The handler only emits, doesn't use other context methods
    expect(ctx.dispatch).not.toHaveBeenCalled()
    expect(ctx.executeCommand).not.toHaveBeenCalled()
    expect(ctx.queueSend).not.toHaveBeenCalled()
  })
})
