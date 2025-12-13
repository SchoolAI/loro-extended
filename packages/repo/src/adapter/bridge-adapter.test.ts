import { describe, expect, it } from "vitest"
import { Repo } from "../repo.js"
import { Bridge, BridgeAdapter } from "./bridge-adapter.js"

describe("BridgeAdapter Integration Tests", () => {
  it("should connect two repos through a shared bridge", async () => {
    // Create a shared bridge
    const bridge = new Bridge()

    // Create two repos with bridge adapters
    new Repo({
      adapters: [
        new BridgeAdapter({
          bridge,
          adapterType: "bridge-adapter-repo1",
        }),
      ],
      identity: { name: "repo1", type: "user" },
    })

    new Repo({
      adapters: [
        new BridgeAdapter({
          bridge,
          adapterType: "bridge-adapter-repo2",
        }),
      ],
      identity: { name: "repo2", type: "user" },
    })

    // Verify both repos are connected through the bridge
    expect(bridge.adapterTypes.has("bridge-adapter-repo1")).toBe(true)
    expect(bridge.adapterTypes.has("bridge-adapter-repo2")).toBe(true)
  })

  it("should synchronize a document from repo1 to repo2", async () => {
    const bridge = new Bridge()

    const repo1 = new Repo({
      adapters: [
        new BridgeAdapter({
          bridge,
          adapterType: "bridge-adapter-repo1",
        }),
      ],
      identity: { name: "repo1", type: "user" },
    })

    const repo2 = new Repo({
      adapters: [
        new BridgeAdapter({
          bridge,
          adapterType: "bridge-adapter-repo2",
        }),
      ],
      identity: { name: "repo2", type: "user" },
    })

    // Create and modify a document in repo1
    const docId = "test-doc-1"
    const handle1 = repo1.get(docId)

    handle1.batch(doc => {
      const root = doc.getMap("root")
      root.set("message", "Hello from repo1")
      root.set("count", 42)
    })

    // Get the same document in repo2
    const handle2 = repo2.get(docId)
    await handle2.waitForNetwork()

    // Verify the document was synchronized
    const root2 = handle2.doc.getMap("root")
    expect(root2.get("message")).toBe("Hello from repo1")
    expect(root2.get("count")).toBe(42)
  })

  it("should synchronize bidirectional changes between repos", async () => {
    const bridge = new Bridge()

    const repo1 = new Repo({
      adapters: [
        new BridgeAdapter({
          bridge,
          adapterType: "bridge-adapter-repo1",
        }),
      ],
      identity: { name: "repo1", type: "user" },
    })

    const repo2 = new Repo({
      adapters: [
        new BridgeAdapter({
          bridge,
          adapterType: "bridge-adapter-repo2",
        }),
      ],
      identity: { name: "repo2", type: "user" },
    })

    const docId = "bidirectional-doc"

    // Repo1 creates and modifies document
    const handle1 = repo1.get(docId)
    handle1.batch(doc => {
      doc.getMap("root").set("from", "repo1")
    })

    // Repo2 gets the document and adds to it
    const handle2 = repo2.get(docId)

    handle2.batch(doc => {
      doc.getMap("root").set("also-from", "repo2")
    })

    await handle2.waitForNetwork()

    // Verify repo1 received repo2's changes
    const root1 = handle1.doc.getMap("root")
    expect(root1.get("from")).toBe("repo1")
    expect(root1.get("also-from")).toBe("repo2")

    // Verify repo2 has both changes
    const root2 = handle2.doc.getMap("root")
    expect(root2.get("from")).toBe("repo1")
    expect(root2.get("also-from")).toBe("repo2")
  })

  it("should handle concurrent modifications with CRDT merge semantics", async () => {
    const bridge = new Bridge()

    const repo1 = new Repo({
      adapters: [
        new BridgeAdapter({
          bridge,
          adapterType: "bridge-adapter-repo1",
        }),
      ],
      identity: { name: "repo1", type: "user" },
    })

    const repo2 = new Repo({
      adapters: [
        new BridgeAdapter({
          bridge,
          adapterType: "bridge-adapter-repo2",
        }),
      ],
      identity: { name: "repo2", type: "user" },
    })

    const docId = "concurrent-doc"

    // Both repos get the document
    const handle1 = repo1.get(docId)
    const handle2 = repo2.get(docId)

    // Initialize with some shared state
    handle1.batch(doc => {
      doc.getMap("root").set("initialized", true)
    })

    // Make concurrent modifications (without waiting for sync)
    handle1.batch(doc => {
      const list = doc.getList("items")
      list.push("item-from-repo1")
    })

    handle2.batch(doc => {
      const list = doc.getList("items")
      list.push("item-from-repo2")
    })

    await handle2.waitForNetwork()

    // Both repos should have both items (CRDT merge)
    const items1 = handle1.doc.getList("items").toArray()
    const items2 = handle2.doc.getList("items").toArray()

    expect(items1).toHaveLength(2)
    expect(items2).toHaveLength(2)
    expect(items1).toContain("item-from-repo1")
    expect(items1).toContain("item-from-repo2")
    expect(items2).toContain("item-from-repo1")
    expect(items2).toContain("item-from-repo2")
  })

  it("should support multiple documents across the same bridge", async () => {
    const bridge = new Bridge()

    const repo1 = new Repo({
      adapters: [
        new BridgeAdapter({
          bridge,
          adapterType: "bridge-adapter-repo1",
        }),
      ],
      identity: { name: "repo1", type: "user" },
    })

    const repo2 = new Repo({
      adapters: [
        new BridgeAdapter({
          bridge,
          adapterType: "bridge-adapter-repo2",
        }),
      ],
      identity: { name: "repo2", type: "user" },
    })

    // Create multiple documents in repo1
    const handle1A = repo1.get("doc-a")
    const handle1B = repo1.get("doc-b")
    const handle1C = repo1.get("doc-c")

    handle1A.batch(doc => doc.getMap("root").set("id", "a"))
    handle1B.batch(doc => doc.getMap("root").set("id", "b"))
    handle1C.batch(doc => doc.getMap("root").set("id", "c"))

    // Access the same documents in repo2
    const handle2A = repo2.get("doc-a")
    const handle2B = repo2.get("doc-b")
    const handle2C = repo2.get("doc-c")

    await Promise.all([
      handle2A.waitForNetwork(),
      handle2B.waitForNetwork(),
      handle2C.waitForNetwork(),
    ])

    // Verify all documents synchronized correctly
    expect(handle2A.doc.getMap("root").get("id")).toBe("a")
    expect(handle2B.doc.getMap("root").get("id")).toBe("b")
    expect(handle2C.doc.getMap("root").get("id")).toBe("c")
  })

  it("should handle adapter removal and cleanup", async () => {
    const bridge = new Bridge()

    const repo1 = new Repo({
      adapters: [
        new BridgeAdapter({
          bridge,
          adapterType: "bridge-adapter-repo1",
        }),
      ],
      identity: { name: "repo1", type: "user" },
    })

    new Repo({
      adapters: [
        new BridgeAdapter({
          bridge,
          adapterType: "bridge-adapter-repo2",
        }),
      ],
      identity: { name: "repo2", type: "user" },
    })

    // Verify both adapters are registered
    expect(bridge.adapterTypes.size).toBe(2)

    // Reset repo1 (should remove its adapter from bridge)
    repo1.reset()

    // Verify adapter was removed
    expect(bridge.adapterTypes.has("bridge-adapter-repo1")).toBe(false)
    expect(bridge.adapterTypes.has("bridge-adapter-repo2")).toBe(true)
    expect(bridge.adapterTypes.size).toBe(1)
  })

  it("should work with more than two repos on the same bridge", async () => {
    const bridge = new Bridge()

    // Capture patches for debugging
    const _repo1Patches: any[] = []
    const _repo2Patches: any[] = []
    const _repo3Patches: any[] = []

    const repo1 = new Repo({
      adapters: [
        new BridgeAdapter({
          bridge,
          adapterType: "bridge-adapter-repo1",
        }),
      ],
      identity: { name: "repo1", type: "user" },
      // onUpdate: patches => {
      //   console.log(
      //     `REPO1 PATCHES (${patches.length}):`,
      //     JSON.stringify(patches, null, 2),
      //   )
      //   repo1Patches.push(...patches)
      // },
    })

    const repo2 = new Repo({
      adapters: [
        new BridgeAdapter({
          bridge,
          adapterType: "bridge-adapter-repo2",
        }),
      ],
      identity: { name: "repo2", type: "user" },
      // onUpdate: patches => {
      //   console.log(
      //     `REPO2 PATCHES (${patches.length}):`,
      //     JSON.stringify(patches, null, 2),
      //   )
      //   repo2Patches.push(...patches)
      // },
    })

    const repo3 = new Repo({
      adapters: [
        new BridgeAdapter({
          bridge,
          adapterType: "bridge-adapter-repo3",
        }),
      ],
      identity: { name: "repo3", type: "user" },
      // onUpdate: patches => {
      //   console.log(
      //     `REPO3 PATCHES (${patches.length}):`,
      //     JSON.stringify(patches, null, 2),
      //   )
      //   repo3Patches.push(...patches)
      // },
    })

    const docId = "shared-doc"

    // Repo1 creates the document
    const handle1 = repo1.get(docId)
    handle1.batch(doc => {
      doc.getMap("root").set("creator", "repo1")
    })

    // Repo2 and Repo3 should both receive it
    const handle2 = repo2.get(docId)
    const handle3 = repo3.get(docId)

    await Promise.all([handle2.waitForNetwork(), handle3.waitForNetwork()])

    expect(handle2.doc.getMap("root").get("creator")).toBe("repo1")
    expect(handle3.doc.getMap("root").get("creator")).toBe("repo1")

    // Repo2 makes a change
    handle2.batch(doc => {
      doc.getMap("root").set("modified-by", "repo2")
    })

    await Promise.all([handle1.waitForNetwork(), handle3.waitForNetwork()])

    // Both repo1 and repo3 should receive the change
    expect(handle1.doc.getMap("root").get("modified-by")).toBe("repo2")
    expect(handle3.doc.getMap("root").get("modified-by")).toBe("repo2")

    // Log summary of captured patches for analysis
    // console.log(`\n=== PATCH SUMMARY ===`)
    // console.log(`Repo1 total patches: ${repo1Patches.length}`)
    // console.log(`Repo2 total patches: ${repo2Patches.length}`)
    // console.log(`Repo3 total patches: ${repo3Patches.length}`)
    // console.log(
    //   `Total patches across all repos: ${repo1Patches.length + repo2Patches.length + repo3Patches.length}`,
    // )
  })
})
