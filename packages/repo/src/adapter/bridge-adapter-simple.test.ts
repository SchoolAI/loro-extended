import { describe, expect, it } from "vitest"
import { Repo } from "../repo.js"
import { Bridge, BridgeAdapter } from "./bridge-adapter.js"

describe("BridgeAdapter Simple Test", () => {
  it("should send and receive establishment messages", async () => {
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

    // Give it a moment for channels to establish
    await new Promise(resolve => setTimeout(resolve, 100))

    // Create a document in repo1
    const docId = "test-doc"
    const handle1 = repo1.get(docId)
    handle1.change(doc => {
      doc.getMap("root").set("test", "value")
    })

    // Get the document in repo2
    const handle2 = repo2.get(docId)

    // Wait for sync
    await handle2.waitForNetwork()

    // Verify
    expect(handle2.doc.getMap("root").get("test")).toBe("value")
  })
})
