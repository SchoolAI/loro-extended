import { describe, expect, it, vi } from "vitest"
import type { GeneratedChannel } from "../channel.js"
import { Adapter, type AdapterContext } from "./adapter.js"
import { AdapterManager } from "./adapter-manager.js"

// Mock adapter for testing
class MockAdapter extends Adapter<void> {
  protected generate(): GeneratedChannel {
    return {
      kind: "network",
      adapterType: this.adapterType,
      send: vi.fn(),
      stop: vi.fn(),
    }
  }

  async onStart(): Promise<void> {
    // No-op for testing
  }

  async onStop(): Promise<void> {
    // No-op for testing
  }
}

// Create a mock context for testing
function createMockContext(): AdapterContext {
  return {
    identity: { peerId: "1" as `${number}`, type: "user" },
    logger: {
      trace: vi.fn(),
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      fatal: vi.fn(),
      getChild: vi.fn().mockReturnThis(),
      with: vi.fn().mockReturnThis(),
    } as any,
    onChannelAdded: vi.fn(),
    onChannelRemoved: vi.fn(),
    onChannelReceive: vi.fn(),
    onChannelEstablish: vi.fn(),
  }
}

describe("AdapterManager idempotent operations", () => {
  it("addAdapter with same adapterId is no-op", async () => {
    const context = createMockContext()
    const manager = new AdapterManager({
      context,
      onReset: vi.fn(),
    })

    const adapter = new MockAdapter({
      adapterType: "test",
      adapterId: "fixed-id",
    })

    await manager.addAdapter(adapter)
    await manager.addAdapter(adapter) // Same adapter again

    expect(manager.adapters.length).toBe(1)
  })

  it("removeAdapter with unknown adapterId is no-op", async () => {
    const context = createMockContext()
    const manager = new AdapterManager({
      context,
      onReset: vi.fn(),
    })

    // Should not throw
    await expect(manager.removeAdapter("nonexistent")).resolves.not.toThrow()
  })

  it("hasAdapter returns correct status", async () => {
    const context = createMockContext()
    const manager = new AdapterManager({
      context,
      onReset: vi.fn(),
    })

    const adapter = new MockAdapter({
      adapterType: "test",
      adapterId: "my-adapter",
    })

    expect(manager.hasAdapter("my-adapter")).toBe(false)

    await manager.addAdapter(adapter)

    expect(manager.hasAdapter("my-adapter")).toBe(true)

    await manager.removeAdapter("my-adapter")

    expect(manager.hasAdapter("my-adapter")).toBe(false)
  })

  it("getAdapter returns adapter or undefined", async () => {
    const context = createMockContext()
    const manager = new AdapterManager({
      context,
      onReset: vi.fn(),
    })

    const adapter = new MockAdapter({
      adapterType: "test",
      adapterId: "my-adapter",
    })

    expect(manager.getAdapter("my-adapter")).toBeUndefined()

    await manager.addAdapter(adapter)

    expect(manager.getAdapter("my-adapter")).toBe(adapter)
  })

  it("calls onReset when removing adapter", async () => {
    const context = createMockContext()
    const onReset = vi.fn()
    const manager = new AdapterManager({
      context,
      onReset,
    })

    const adapter = new MockAdapter({
      adapterType: "test",
      adapterId: "my-adapter",
    })

    await manager.addAdapter(adapter)
    await manager.removeAdapter("my-adapter")

    expect(onReset).toHaveBeenCalledWith(adapter)
  })
})
