import { describe, expect, it, vi } from "vitest"
import type { Command } from "../../synchronizer-program.js"
import { createDocState, createMockCommandContext } from "../test-utils.js"
import { handleSubscribeDoc } from "./handle-subscribe-doc.js"

type SubscribeDocCommand = Extract<Command, { type: "cmd/subscribe-doc" }>

describe("handleSubscribeDoc", () => {
  it("should subscribe to local updates on the document", () => {
    const docState = createDocState({ docId: "doc-1" })
    const subscribeLocalUpdatesSpy = vi.spyOn(
      docState.doc,
      "subscribeLocalUpdates",
    )

    const ctx = createMockCommandContext()
    ctx.model.documents.set("doc-1", docState)

    const command: SubscribeDocCommand = {
      type: "cmd/subscribe-doc",
      docId: "doc-1",
    }

    handleSubscribeDoc(command, ctx)

    expect(subscribeLocalUpdatesSpy).toHaveBeenCalled()
  })

  it("should dispatch local-doc-change when local update occurs", () => {
    const docState = createDocState({ docId: "doc-1" })

    const ctx = createMockCommandContext()
    ctx.model.documents.set("doc-1", docState)

    const command: SubscribeDocCommand = {
      type: "cmd/subscribe-doc",
      docId: "doc-1",
    }

    handleSubscribeDoc(command, ctx)

    // Simulate a local change - need to commit for subscribeLocalUpdates to fire
    docState.doc.getText("content").insert(0, "Hello")
    docState.doc.commit()

    expect(ctx.dispatch).toHaveBeenCalledWith({
      type: "synchronizer/local-doc-change",
      docId: "doc-1",
    })
  })

  it("should warn and return if document not found", () => {
    const ctx = createMockCommandContext()
    // No document added to model

    const command: SubscribeDocCommand = {
      type: "cmd/subscribe-doc",
      docId: "nonexistent-doc",
    }

    handleSubscribeDoc(command, ctx)

    expect(ctx.logger.warn).toHaveBeenCalled()
  })

  it("should dispatch for each local change", () => {
    const docState = createDocState({ docId: "doc-1" })

    const ctx = createMockCommandContext()
    ctx.model.documents.set("doc-1", docState)

    const command: SubscribeDocCommand = {
      type: "cmd/subscribe-doc",
      docId: "doc-1",
    }

    handleSubscribeDoc(command, ctx)

    // Simulate multiple local changes - need to commit for subscribeLocalUpdates to fire
    docState.doc.getText("content").insert(0, "Hello")
    docState.doc.commit()
    docState.doc.getText("content").insert(5, " World")
    docState.doc.commit()

    expect(ctx.dispatch).toHaveBeenCalledTimes(2)
  })

  it("should not dispatch for imported changes", () => {
    const docState = createDocState({ docId: "doc-1" })

    const ctx = createMockCommandContext()
    ctx.model.documents.set("doc-1", docState)

    const command: SubscribeDocCommand = {
      type: "cmd/subscribe-doc",
      docId: "doc-1",
    }

    handleSubscribeDoc(command, ctx)

    // Create a remote doc and import its changes
    const { LoroDoc } = require("loro-crdt")
    const remoteDoc = new LoroDoc()
    remoteDoc.getText("content").insert(0, "Remote content")
    const data = remoteDoc.export({ mode: "snapshot" })

    // Import should NOT trigger the local updates subscription
    docState.doc.import(data)

    // subscribeLocalUpdates only fires for local changes, not imports
    // So dispatch should not have been called
    expect(ctx.dispatch).not.toHaveBeenCalled()
  })
})
