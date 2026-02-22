import type { PeerID } from "@loro-extended/repo"
import { describe, expect, it } from "vitest"
import { computePeerActions } from "./peer-actions"

describe("computePeerActions", () => {
  // Use peer IDs where the numeric comparison is clear
  const smallPeerId = "100000000000000000000000000000" as PeerID
  const largePeerId = "200000000000000000000000000000" as PeerID
  const anotherLargePeerId = "300000000000000000000000000000" as PeerID

  describe("toCreate", () => {
    it("returns empty when no changes needed", () => {
      const current = new Set([largePeerId])
      const target = new Set([largePeerId])

      const result = computePeerActions(
        current,
        target,
        new Set(),
        smallPeerId,
        true,
      )

      expect(result.toCreate).toEqual([])
      expect(result.toDestroy).toEqual([])
    })

    it("creates peer when we are initiator and have stream", () => {
      const current = new Set<PeerID>()
      const target = new Set([largePeerId])

      const result = computePeerActions(
        current,
        target,
        new Set(),
        smallPeerId, // smaller peerId = initiator
        true, // has stream
      )

      expect(result.toCreate).toEqual([largePeerId])
    })

    it("does NOT create peer when we are NOT initiator", () => {
      const current = new Set<PeerID>()
      const target = new Set([smallPeerId])

      const result = computePeerActions(
        current,
        target,
        new Set(),
        largePeerId, // larger peerId = NOT initiator
        true,
      )

      expect(result.toCreate).toEqual([])
    })

    it("does NOT create peer without local stream", () => {
      const current = new Set<PeerID>()
      const target = new Set([largePeerId])

      const result = computePeerActions(
        current,
        target,
        new Set(),
        smallPeerId,
        false, // no stream
      )

      expect(result.toCreate).toEqual([])
    })

    it("does NOT create peer that already exists", () => {
      const current = new Set([largePeerId])
      const target = new Set([largePeerId])

      const result = computePeerActions(
        current,
        target,
        new Set(),
        smallPeerId,
        true,
      )

      expect(result.toCreate).toEqual([])
    })

    it("skips self in target set", () => {
      const current = new Set<PeerID>()
      const target = new Set([smallPeerId, largePeerId]) // includes self

      const result = computePeerActions(
        current,
        target,
        new Set(),
        smallPeerId, // self
        true,
      )

      // Should only create largePeerId, not self
      expect(result.toCreate).toEqual([largePeerId])
    })

    it("creates multiple peers when we are initiator for all", () => {
      const current = new Set<PeerID>()
      const target = new Set([largePeerId, anotherLargePeerId])

      const result = computePeerActions(
        current,
        target,
        new Set(),
        smallPeerId, // smaller than both
        true,
      )

      expect(result.toCreate).toHaveLength(2)
      expect(result.toCreate).toContain(largePeerId)
      expect(result.toCreate).toContain(anotherLargePeerId)
    })
  })

  describe("toDestroy", () => {
    it("destroys peer when removed from target", () => {
      const current = new Set([largePeerId])
      const target = new Set<PeerID>()

      const result = computePeerActions(
        current,
        target,
        new Set(),
        smallPeerId,
        true,
      )

      expect(result.toDestroy).toEqual([largePeerId])
    })

    it("does NOT destroy signal-created peers", () => {
      const current = new Set([largePeerId])
      const target = new Set<PeerID>()
      const signalCreated = new Set([largePeerId])

      const result = computePeerActions(
        current,
        target,
        signalCreated,
        smallPeerId,
        true,
      )

      expect(result.toDestroy).toEqual([])
    })

    it("does NOT destroy peer still in target", () => {
      const current = new Set([largePeerId])
      const target = new Set([largePeerId])

      const result = computePeerActions(
        current,
        target,
        new Set(),
        smallPeerId,
        true,
      )

      expect(result.toDestroy).toEqual([])
    })

    it("destroys multiple peers when all removed from target", () => {
      const current = new Set([largePeerId, anotherLargePeerId])
      const target = new Set<PeerID>()

      const result = computePeerActions(
        current,
        target,
        new Set(),
        smallPeerId,
        true,
      )

      expect(result.toDestroy).toHaveLength(2)
      expect(result.toDestroy).toContain(largePeerId)
      expect(result.toDestroy).toContain(anotherLargePeerId)
    })

    it("destroys only non-signal-created peers", () => {
      const current = new Set([largePeerId, anotherLargePeerId])
      const target = new Set<PeerID>()
      const signalCreated = new Set([largePeerId]) // protect this one

      const result = computePeerActions(
        current,
        target,
        signalCreated,
        smallPeerId,
        true,
      )

      expect(result.toDestroy).toEqual([anotherLargePeerId])
    })
  })

  describe("combined scenarios", () => {
    it("handles simultaneous create and destroy", () => {
      const current = new Set([largePeerId])
      const target = new Set([anotherLargePeerId]) // remove large, add anotherLarge

      const result = computePeerActions(
        current,
        target,
        new Set(),
        smallPeerId,
        true,
      )

      expect(result.toCreate).toEqual([anotherLargePeerId])
      expect(result.toDestroy).toEqual([largePeerId])
    })
  })
})
