import { describe, expect, it } from "vitest"
import type { Command } from "../../synchronizer-program.js"
import { createMockChannel, createMockCommandContext } from "../test-utils.js"
import { handleStopChannel } from "./handle-stop-channel.js"

type StopChannelCommand = Extract<Command, { type: "cmd/stop-channel" }>

describe("handleStopChannel", () => {
  it("should call stop() on the channel", () => {
    const channel = createMockChannel()
    const ctx = createMockCommandContext()

    const command: StopChannelCommand = {
      type: "cmd/stop-channel",
      channel,
    }

    handleStopChannel(command, ctx)

    expect(channel.stop).toHaveBeenCalled()
  })

  it("should call stop() exactly once", () => {
    const channel = createMockChannel()
    const ctx = createMockCommandContext()

    const command: StopChannelCommand = {
      type: "cmd/stop-channel",
      channel,
    }

    handleStopChannel(command, ctx)

    expect(channel.stop).toHaveBeenCalledTimes(1)
  })

  it("should not use any context methods", () => {
    const channel = createMockChannel()
    const ctx = createMockCommandContext()

    const command: StopChannelCommand = {
      type: "cmd/stop-channel",
      channel,
    }

    handleStopChannel(command, ctx)

    // The handler only calls channel.stop(), not any context methods
    expect(ctx.dispatch).not.toHaveBeenCalled()
    expect(ctx.executeCommand).not.toHaveBeenCalled()
    expect(ctx.queueSend).not.toHaveBeenCalled()
  })

  it("should work with different channel configurations", () => {
    const channel = createMockChannel({
      channelId: 999,
      kind: "storage",
      adapterType: "custom-adapter",
    })
    const ctx = createMockCommandContext()

    const command: StopChannelCommand = {
      type: "cmd/stop-channel",
      channel,
    }

    handleStopChannel(command, ctx)

    expect(channel.stop).toHaveBeenCalled()
  })
})
