import { describe, expect, it, vi } from "vitest"
import type { Command } from "../../synchronizer-program.js"
import { createMockChannel, createMockCommandContext } from "../test-utils.js"
import { handleBatch } from "./handle-batch.js"

type BatchCommand = Extract<Command, { type: "cmd/batch" }>

describe("handleBatch", () => {
  it("should execute all commands in the batch", () => {
    const ctx = createMockCommandContext()

    const channel = createMockChannel()
    const commands: Command[] = [
      { type: "cmd/stop-channel", channel },
      { type: "cmd/emit-ephemeral-change", docId: "doc-1" },
      { type: "cmd/dispatch", dispatch: { type: "synchronizer/heartbeat" } },
    ]

    const command: BatchCommand = {
      type: "cmd/batch",
      commands,
    }

    handleBatch(command, ctx)

    expect(ctx.executeCommand).toHaveBeenCalledTimes(3)
    expect(ctx.executeCommand).toHaveBeenCalledWith(commands[0])
    expect(ctx.executeCommand).toHaveBeenCalledWith(commands[1])
    expect(ctx.executeCommand).toHaveBeenCalledWith(commands[2])
  })

  it("should execute commands in order", () => {
    const executionOrder: string[] = []
    const mockExecuteCommand = vi.fn((cmd: Command) => {
      executionOrder.push(cmd.type)
    })

    const ctx = createMockCommandContext({
      executeCommand: mockExecuteCommand,
    })

    const channel = createMockChannel()
    const commands: Command[] = [
      { type: "cmd/stop-channel", channel },
      { type: "cmd/emit-ephemeral-change", docId: "doc-1" },
      { type: "cmd/dispatch", dispatch: { type: "synchronizer/heartbeat" } },
    ]

    const command: BatchCommand = {
      type: "cmd/batch",
      commands,
    }

    handleBatch(command, ctx)

    expect(executionOrder).toEqual([
      "cmd/stop-channel",
      "cmd/emit-ephemeral-change",
      "cmd/dispatch",
    ])
  })

  it("should handle empty batch", () => {
    const ctx = createMockCommandContext()

    const command: BatchCommand = {
      type: "cmd/batch",
      commands: [],
    }

    handleBatch(command, ctx)

    expect(ctx.executeCommand).not.toHaveBeenCalled()
  })

  it("should handle single command batch", () => {
    const ctx = createMockCommandContext()

    const channel = createMockChannel()
    const commands: Command[] = [{ type: "cmd/stop-channel", channel }]

    const command: BatchCommand = {
      type: "cmd/batch",
      commands,
    }

    handleBatch(command, ctx)

    expect(ctx.executeCommand).toHaveBeenCalledTimes(1)
    expect(ctx.executeCommand).toHaveBeenCalledWith(commands[0])
  })

  it("should handle nested batch commands", () => {
    const ctx = createMockCommandContext()

    const channel = createMockChannel()
    const innerBatch: BatchCommand = {
      type: "cmd/batch",
      commands: [{ type: "cmd/stop-channel", channel }],
    }

    const outerBatch: BatchCommand = {
      type: "cmd/batch",
      commands: [
        innerBatch,
        { type: "cmd/emit-ephemeral-change", docId: "doc-1" },
      ],
    }

    handleBatch(outerBatch, ctx)

    // Should execute both commands (the inner batch and the emit)
    // The inner batch will be executed by executeCommand, which would
    // recursively call handleBatch
    expect(ctx.executeCommand).toHaveBeenCalledTimes(2)
    expect(ctx.executeCommand).toHaveBeenCalledWith(innerBatch)
    expect(ctx.executeCommand).toHaveBeenCalledWith({
      type: "cmd/emit-ephemeral-change",
      docId: "doc-1",
    })
  })

  it("should not use other context methods directly", () => {
    const ctx = createMockCommandContext()

    const command: BatchCommand = {
      type: "cmd/batch",
      commands: [{ type: "cmd/emit-ephemeral-change", docId: "doc-1" }],
    }

    handleBatch(command, ctx)

    // The handler only calls executeCommand, not other context methods
    expect(ctx.dispatch).not.toHaveBeenCalled()
    expect(ctx.queueSend).not.toHaveBeenCalled()
  })
})
