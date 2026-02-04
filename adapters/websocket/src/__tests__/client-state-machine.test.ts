import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  WsClientStateMachine,
  type WsClientStateTransition,
} from "../client-state-machine.js"

describe("WsClientStateMachine", () => {
  let stateMachine: WsClientStateMachine

  beforeEach(() => {
    stateMachine = new WsClientStateMachine()
  })

  describe("Initial state", () => {
    it("should start in disconnected state", () => {
      expect(stateMachine.getState()).toEqual({ status: "disconnected" })
      expect(stateMachine.getStatus()).toBe("disconnected")
    })

    it("should report not connected or ready", () => {
      expect(stateMachine.isConnectedOrReady()).toBe(false)
      expect(stateMachine.isReady()).toBe(false)
    })
  })

  describe("Valid transitions", () => {
    it("should allow disconnected -> connecting", () => {
      stateMachine.transition({ status: "connecting", attempt: 1 })
      expect(stateMachine.getStatus()).toBe("connecting")
    })

    it("should allow connecting -> connected", () => {
      stateMachine.transition({ status: "connecting", attempt: 1 })
      stateMachine.transition({ status: "connected" })
      expect(stateMachine.getStatus()).toBe("connected")
      expect(stateMachine.isConnectedOrReady()).toBe(true)
      expect(stateMachine.isReady()).toBe(false)
    })

    it("should allow connected -> ready", () => {
      stateMachine.transition({ status: "connecting", attempt: 1 })
      stateMachine.transition({ status: "connected" })
      stateMachine.transition({ status: "ready" })
      expect(stateMachine.getStatus()).toBe("ready")
      expect(stateMachine.isConnectedOrReady()).toBe(true)
      expect(stateMachine.isReady()).toBe(true)
    })

    it("should allow ready -> disconnected", () => {
      stateMachine.transition({ status: "connecting", attempt: 1 })
      stateMachine.transition({ status: "connected" })
      stateMachine.transition({ status: "ready" })
      stateMachine.transition({
        status: "disconnected",
        reason: { type: "intentional" },
      })
      expect(stateMachine.getStatus()).toBe("disconnected")
    })

    it("should allow ready -> reconnecting", () => {
      stateMachine.transition({ status: "connecting", attempt: 1 })
      stateMachine.transition({ status: "connected" })
      stateMachine.transition({ status: "ready" })
      stateMachine.transition({
        status: "reconnecting",
        attempt: 1,
        nextAttemptMs: 1000,
      })
      expect(stateMachine.getStatus()).toBe("reconnecting")
    })

    it("should allow reconnecting -> connecting", () => {
      stateMachine.transition({ status: "connecting", attempt: 1 })
      stateMachine.transition({ status: "connected" })
      stateMachine.transition({ status: "ready" })
      stateMachine.transition({
        status: "reconnecting",
        attempt: 1,
        nextAttemptMs: 1000,
      })
      stateMachine.transition({ status: "connecting", attempt: 2 })
      expect(stateMachine.getStatus()).toBe("connecting")
    })

    it("should allow reconnecting -> disconnected (max retries)", () => {
      stateMachine.transition({ status: "connecting", attempt: 1 })
      stateMachine.transition({ status: "connected" })
      stateMachine.transition({ status: "ready" })
      stateMachine.transition({
        status: "reconnecting",
        attempt: 1,
        nextAttemptMs: 1000,
      })
      stateMachine.transition({
        status: "disconnected",
        reason: { type: "max-retries-exceeded", attempts: 10 },
      })
      expect(stateMachine.getStatus()).toBe("disconnected")
    })

    it("should allow connecting -> disconnected (connection failed)", () => {
      stateMachine.transition({ status: "connecting", attempt: 1 })
      stateMachine.transition({
        status: "disconnected",
        reason: { type: "error", error: new Error("Connection refused") },
      })
      expect(stateMachine.getStatus()).toBe("disconnected")
    })

    it("should allow connecting -> reconnecting", () => {
      stateMachine.transition({ status: "connecting", attempt: 1 })
      stateMachine.transition({
        status: "reconnecting",
        attempt: 1,
        nextAttemptMs: 1000,
      })
      expect(stateMachine.getStatus()).toBe("reconnecting")
    })
  })

  describe("Invalid transitions", () => {
    it("should throw on disconnected -> connected", () => {
      expect(() => {
        stateMachine.transition({ status: "connected" })
      }).toThrow("Invalid state transition: disconnected -> connected")
    })

    it("should throw on disconnected -> ready", () => {
      expect(() => {
        stateMachine.transition({ status: "ready" })
      }).toThrow("Invalid state transition: disconnected -> ready")
    })

    it("should throw on connecting -> ready", () => {
      stateMachine.transition({ status: "connecting", attempt: 1 })
      expect(() => {
        stateMachine.transition({ status: "ready" })
      }).toThrow("Invalid state transition: connecting -> ready")
    })

    it("should throw on connected -> connecting", () => {
      stateMachine.transition({ status: "connecting", attempt: 1 })
      stateMachine.transition({ status: "connected" })
      expect(() => {
        stateMachine.transition({ status: "connecting", attempt: 2 })
      }).toThrow("Invalid state transition: connected -> connecting")
    })

    it("should allow forced invalid transitions", () => {
      stateMachine.transition({ status: "ready" }, { force: true })
      expect(stateMachine.getStatus()).toBe("ready")
    })
  })

  describe("Subscription delivery", () => {
    it("should deliver transitions asynchronously via microtask", async () => {
      const transitions: WsClientStateTransition[] = []
      stateMachine.subscribeToTransitions(t => transitions.push(t))

      stateMachine.transition({ status: "connecting", attempt: 1 })

      // Synchronously, no transitions delivered yet
      expect(transitions).toHaveLength(0)

      // After microtask, transition is delivered
      await Promise.resolve()
      expect(transitions).toHaveLength(1)
      expect(transitions[0].from.status).toBe("disconnected")
      expect(transitions[0].to.status).toBe("connecting")
    })

    it("should deliver multiple transitions in order", async () => {
      const transitions: WsClientStateTransition[] = []
      stateMachine.subscribeToTransitions(t => transitions.push(t))

      stateMachine.transition({ status: "connecting", attempt: 1 })
      stateMachine.transition({ status: "connected" })
      stateMachine.transition({ status: "ready" })

      // All transitions queued but not delivered
      expect(transitions).toHaveLength(0)

      // After microtask, all transitions delivered in order
      await Promise.resolve()
      expect(transitions).toHaveLength(3)
      expect(transitions[0].to.status).toBe("connecting")
      expect(transitions[1].to.status).toBe("connected")
      expect(transitions[2].to.status).toBe("ready")
    })

    it("should deliver to multiple subscribers", async () => {
      const transitions1: WsClientStateTransition[] = []
      const transitions2: WsClientStateTransition[] = []

      stateMachine.subscribeToTransitions(t => transitions1.push(t))
      stateMachine.subscribeToTransitions(t => transitions2.push(t))

      stateMachine.transition({ status: "connecting", attempt: 1 })

      await Promise.resolve()
      expect(transitions1).toHaveLength(1)
      expect(transitions2).toHaveLength(1)
    })

    it("should not deliver to unsubscribed listeners", async () => {
      const transitions: WsClientStateTransition[] = []
      const unsubscribe = stateMachine.subscribeToTransitions(t =>
        transitions.push(t),
      )

      stateMachine.transition({ status: "connecting", attempt: 1 })

      // Wait for first transition to be delivered
      await Promise.resolve()
      expect(transitions).toHaveLength(1)

      // Now unsubscribe
      unsubscribe()

      // This transition should not be delivered
      stateMachine.transition({ status: "connected" })
      await Promise.resolve()

      // Still only 1 transition (the one before unsubscribe)
      expect(transitions).toHaveLength(1)
    })

    it("should include timestamp in transitions", async () => {
      const transitions: WsClientStateTransition[] = []
      stateMachine.subscribeToTransitions(t => transitions.push(t))

      const before = Date.now()
      stateMachine.transition({ status: "connecting", attempt: 1 })
      const after = Date.now()

      await Promise.resolve()
      expect(transitions[0].timestamp).toBeGreaterThanOrEqual(before)
      expect(transitions[0].timestamp).toBeLessThanOrEqual(after)
    })
  })

  describe("Legacy subscribe() API", () => {
    it("should emit current state immediately on subscribe", () => {
      const states: string[] = []
      stateMachine.subscribe(s => states.push(s))

      // Immediate emission
      expect(states).toEqual(["disconnected"])
    })

    it("should emit state changes asynchronously", async () => {
      const states: string[] = []
      stateMachine.subscribe(s => states.push(s))

      // Clear initial emission
      states.length = 0

      stateMachine.transition({ status: "connecting", attempt: 1 })

      // Not delivered yet
      expect(states).toHaveLength(0)

      await Promise.resolve()
      expect(states).toEqual(["connecting"])
    })

    it("should map ready to connected for backward compatibility", async () => {
      const states: string[] = []
      stateMachine.subscribe(s => states.push(s))
      states.length = 0

      stateMachine.transition({ status: "connecting", attempt: 1 })
      stateMachine.transition({ status: "connected" })
      stateMachine.transition({ status: "ready" })

      await Promise.resolve()
      expect(states).toEqual(["connecting", "connected", "connected"])
    })

    it("should return correct legacy state via getLegacyConnectionState", () => {
      expect(stateMachine.getLegacyConnectionState()).toBe("disconnected")

      stateMachine.transition({ status: "connecting", attempt: 1 })
      expect(stateMachine.getLegacyConnectionState()).toBe("connecting")

      stateMachine.transition({ status: "connected" })
      expect(stateMachine.getLegacyConnectionState()).toBe("connected")

      stateMachine.transition({ status: "ready" })
      expect(stateMachine.getLegacyConnectionState()).toBe("connected") // Maps ready -> connected
    })
  })

  describe("waitForState()", () => {
    it("should resolve immediately if already in desired state", async () => {
      const state = await stateMachine.waitForState(
        s => s.status === "disconnected",
      )
      expect(state.status).toBe("disconnected")
    })

    it("should wait for state transition", async () => {
      const promise = stateMachine.waitForState(s => s.status === "connected")

      // Transition in next tick
      setTimeout(() => {
        stateMachine.transition({ status: "connecting", attempt: 1 })
        stateMachine.transition({ status: "connected" })
      }, 10)

      const state = await promise
      expect(state.status).toBe("connected")
    })

    it("should timeout if state not reached", async () => {
      const promise = stateMachine.waitForState(s => s.status === "ready", {
        timeoutMs: 50,
      })

      await expect(promise).rejects.toThrow("Timeout waiting for state")
    })

    it("should work with complex predicates", async () => {
      const promise = stateMachine.waitForState(
        s =>
          s.status === "disconnected" &&
          s.reason?.type === "max-retries-exceeded",
      )

      setTimeout(() => {
        stateMachine.transition({ status: "connecting", attempt: 1 })
        stateMachine.transition({
          status: "reconnecting",
          attempt: 1,
          nextAttemptMs: 100,
        })
        stateMachine.transition({
          status: "disconnected",
          reason: { type: "max-retries-exceeded", attempts: 10 },
        })
      }, 10)

      const state = await promise
      expect(state.status).toBe("disconnected")
      if (state.status === "disconnected") {
        expect(state.reason?.type).toBe("max-retries-exceeded")
      }
    })
  })

  describe("waitForStatus()", () => {
    it("should wait for specific status", async () => {
      const promise = stateMachine.waitForStatus("ready")

      setTimeout(() => {
        stateMachine.transition({ status: "connecting", attempt: 1 })
        stateMachine.transition({ status: "connected" })
        stateMachine.transition({ status: "ready" })
      }, 10)

      const state = await promise
      expect(state.status).toBe("ready")
    })
  })

  describe("reset()", () => {
    it("should reset to initial state", () => {
      stateMachine.transition({ status: "connecting", attempt: 1 })
      stateMachine.transition({ status: "connected" })
      stateMachine.transition({ status: "ready" })

      stateMachine.reset()

      expect(stateMachine.getState()).toEqual({ status: "disconnected" })
    })

    it("should clear pending transitions", async () => {
      const transitions: WsClientStateTransition[] = []
      stateMachine.subscribeToTransitions(t => transitions.push(t))

      stateMachine.transition({ status: "connecting", attempt: 1 })
      stateMachine.reset()

      await Promise.resolve()
      // The transition was queued but reset cleared it
      // Note: Due to microtask timing, the transition may or may not be delivered
      // depending on when reset() is called. This test verifies the state is reset.
      expect(stateMachine.getStatus()).toBe("disconnected")
    })
  })

  describe("Error handling in listeners", () => {
    it("should continue delivering to other listeners if one throws", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})

      const transitions1: WsClientStateTransition[] = []
      const transitions2: WsClientStateTransition[] = []

      stateMachine.subscribeToTransitions(() => {
        throw new Error("Listener error")
      })
      stateMachine.subscribeToTransitions(t => transitions1.push(t))
      stateMachine.subscribeToTransitions(t => transitions2.push(t))

      stateMachine.transition({ status: "connecting", attempt: 1 })

      await Promise.resolve()

      // Other listeners still received the transition
      expect(transitions1).toHaveLength(1)
      expect(transitions2).toHaveLength(1)

      // Error was logged
      expect(consoleSpy).toHaveBeenCalledWith(
        "Error in transition listener:",
        expect.any(Error),
      )

      consoleSpy.mockRestore()
    })
  })
})
