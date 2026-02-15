/**
 * Comprehensive tests for all permissions.
 *
 * For each permission, we test:
 * 1. When permission returns `true`, the action is ALLOWED
 * 2. When permission returns `false`, the action is BLOCKED
 */

import { change, Shape } from "@loro-extended/change"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Bridge, BridgeAdapter } from "../adapter/bridge-adapter.js"
import { Repo } from "../repo.js"
import { sync } from "../sync.js"

const DocSchema = Shape.doc({
  title: Shape.text(),
})

describe("Permissions - Comprehensive Tests", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe("visibility permission", () => {
    it("should REVEAL documents when visibility returns true", async () => {
      const bridge = new Bridge()

      const repo1 = new Repo({
        identity: { name: "repo1", type: "user" },
        adapters: [new BridgeAdapter({ bridge, adapterType: "adapter1" })],
        permissions: { visibility: () => true },
      })

      // Create a document in repo1
      const doc1 = repo1.get("test-doc", DocSchema)
      change(doc1, draft => {
        draft.title.insert(0, "hello")
      })

      const repo2 = new Repo({
        identity: { name: "repo2", type: "user" },
        adapters: [new BridgeAdapter({ bridge, adapterType: "adapter2" })],
      })

      await vi.runAllTimersAsync()

      // repo2 should know about the document
      expect(repo2.has("test-doc")).toBe(true)
    })

    it("should NOT REVEAL documents when visibility returns false", async () => {
      const bridge = new Bridge()

      const repo1 = new Repo({
        identity: { name: "repo1", type: "user" },
        adapters: [new BridgeAdapter({ bridge, adapterType: "adapter1" })],
        permissions: { visibility: () => false },
      })

      // Create a document in repo1
      const doc1 = repo1.get("test-doc", DocSchema)
      change(doc1, draft => {
        draft.title.insert(0, "hello")
      })

      const repo2 = new Repo({
        identity: { name: "repo2", type: "user" },
        adapters: [new BridgeAdapter({ bridge, adapterType: "adapter2" })],
      })

      await vi.runAllTimersAsync()

      // repo2 should NOT know about the document (it wasn't announced)
      expect(repo2.has("test-doc")).toBe(false)
    })
  })

  describe("mutability permission", () => {
    it("should ACCEPT updates when mutability returns true", async () => {
      const bridge = new Bridge()

      const repo1 = new Repo({
        identity: { name: "repo1", type: "user" },
        adapters: [new BridgeAdapter({ bridge, adapterType: "adapter1" })],
        permissions: { mutability: () => true },
      })

      const repo2 = new Repo({
        identity: { name: "repo2", type: "user" },
        adapters: [new BridgeAdapter({ bridge, adapterType: "adapter2" })],
      })

      // Create document in repo1
      const doc1 = repo1.get("test-doc", DocSchema)

      await vi.advanceTimersByTimeAsync(100)

      // Get handle in repo2 and wait for sync
      const doc2 = repo2.get("test-doc", DocSchema)
      await sync(doc2).waitForSync({ timeout: 0 })

      // Make a change in repo2
      change(doc2, draft => {
        draft.title.insert(0, "hello from repo2")
      })

      await vi.advanceTimersByTimeAsync(100)

      // repo1 should have the change
      expect(doc1.toJSON().title).toBe("hello from repo2")
    })

    it("should REJECT updates when mutability returns false", async () => {
      const bridge = new Bridge()

      const repo1 = new Repo({
        identity: { name: "repo1", type: "user" },
        adapters: [new BridgeAdapter({ bridge, adapterType: "adapter1" })],
        permissions: { mutability: () => false },
      })

      const repo2 = new Repo({
        identity: { name: "repo2", type: "user" },
        adapters: [new BridgeAdapter({ bridge, adapterType: "adapter2" })],
      })

      // Create document in repo1 with initial content
      const doc1 = repo1.get("test-doc", DocSchema)
      change(doc1, draft => {
        draft.title.insert(0, "original")
      })

      await vi.advanceTimersByTimeAsync(100)

      // Get handle in repo2 and wait for sync
      const doc2 = repo2.get("test-doc", DocSchema)
      await sync(doc2).waitForSync({ timeout: 0 })

      // Make a change in repo2
      change(doc2, draft => {
        draft.title.delete(0, draft.title.length)
        draft.title.insert(0, "modified by repo2")
      })

      await vi.advanceTimersByTimeAsync(100)

      // repo1 should NOT have the change (mutability is false)
      expect(doc1.toJSON().title).toBe("original")
    })
  })

  describe("creation permission", () => {
    it("should CREATE documents when creation returns true", async () => {
      const bridge = new Bridge()

      const repo1 = new Repo({
        identity: { name: "repo1", type: "user" },
        adapters: [new BridgeAdapter({ bridge, adapterType: "adapter1" })],
      })

      const repo2 = new Repo({
        identity: { name: "repo2", type: "user" },
        adapters: [new BridgeAdapter({ bridge, adapterType: "adapter2" })],
        permissions: { creation: () => true },
      })

      // repo1 creates a document
      repo1.get("new-doc", DocSchema)

      await vi.runAllTimersAsync()

      // repo2 should have created the document
      expect(repo2.has("new-doc")).toBe(true)
    })

    it("should NOT CREATE documents when creation returns false", async () => {
      const bridge = new Bridge()

      const repo1 = new Repo({
        identity: { name: "repo1", type: "user" },
        adapters: [new BridgeAdapter({ bridge, adapterType: "adapter1" })],
      })

      const repo2 = new Repo({
        identity: { name: "repo2", type: "user" },
        adapters: [new BridgeAdapter({ bridge, adapterType: "adapter2" })],
        permissions: { creation: () => false },
      })

      // repo1 creates a document
      repo1.get("new-doc", DocSchema)

      await vi.runAllTimersAsync()

      // repo2 should NOT have created the document
      expect(repo2.has("new-doc")).toBe(false)
    })
  })

  describe("deletion permission", () => {
    it("should DELETE documents when deletion returns true", async () => {
      const bridge = new Bridge()

      const repo1 = new Repo({
        identity: { name: "repo1", type: "user" },
        adapters: [new BridgeAdapter({ bridge, adapterType: "adapter1" })],
        permissions: { deletion: () => true },
      })

      const repo2 = new Repo({
        identity: { name: "repo2", type: "user" },
        adapters: [new BridgeAdapter({ bridge, adapterType: "adapter2" })],
      })

      // Create document in repo1
      const doc1 = repo1.get("doc-to-delete", DocSchema)
      change(doc1, draft => {
        draft.title.insert(0, "will be deleted")
      })

      await vi.advanceTimersByTimeAsync(100)

      // Get handle in repo2 and wait for sync
      const doc2 = repo2.get("doc-to-delete", DocSchema)
      await sync(doc2).waitForSync({ timeout: 0 })

      // repo2 deletes the document
      await repo2.delete("doc-to-delete")

      await vi.advanceTimersByTimeAsync(100)

      // repo1 should have deleted the document (deletion is allowed)
      expect(repo1.has("doc-to-delete")).toBe(false)
    })

    it("should NOT DELETE documents when deletion returns false", async () => {
      const bridge = new Bridge()

      const repo1 = new Repo({
        identity: { name: "repo1", type: "user" },
        adapters: [new BridgeAdapter({ bridge, adapterType: "adapter1" })],
        permissions: { deletion: () => false },
      })

      const repo2 = new Repo({
        identity: { name: "repo2", type: "user" },
        adapters: [new BridgeAdapter({ bridge, adapterType: "adapter2" })],
      })

      // Create document in repo1
      const doc1 = repo1.get("doc-to-delete", DocSchema)
      change(doc1, draft => {
        draft.title.insert(0, "should not be deleted")
      })

      await vi.advanceTimersByTimeAsync(100)

      // Get handle in repo2 and wait for sync
      const doc2 = repo2.get("doc-to-delete", DocSchema)
      await sync(doc2).waitForSync({ timeout: 0 })

      // repo2 tries to delete the document
      await repo2.delete("doc-to-delete")

      await vi.advanceTimersByTimeAsync(100)

      // repo1 should still have the document (deletion is denied)
      expect(repo1.has("doc-to-delete")).toBe(true)
    })
  })
})
