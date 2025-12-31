import { LoroDoc, type PeerID } from "loro-crdt"
import { describe, expect, it, vi } from "vitest"
import type { Command } from "../../synchronizer-program.js"
import { createDocState } from "../../types.js"
import { createMockCommandContext } from "../test-utils.js"
import { handleImportDocData } from "./handle-import-doc-data.js"

type ImportDocDataCommand = Extract<Command, { type: "cmd/import-doc-data" }>

describe("handleImportDocData", () => {
  it("should import document data and dispatch doc-imported message", () => {
    const docState = createDocState({ docId: "doc-1" })
    const importSpy = vi.spyOn(docState.doc, "import")

    const ctx = createMockCommandContext()
    ctx.model.documents.set("doc-1", docState)

    // Create some data to import
    const sourceDoc = new LoroDoc()
    sourceDoc.getText("content").insert(0, "Hello")
    const data = sourceDoc.export({ mode: "snapshot" })

    const command: ImportDocDataCommand = {
      type: "cmd/import-doc-data",
      docId: "doc-1",
      data,
      fromPeerId: "peer-1" as PeerID,
    }

    handleImportDocData(command, ctx)

    expect(importSpy).toHaveBeenCalledWith(data)
    expect(ctx.dispatch).toHaveBeenCalledWith({
      type: "synchronizer/doc-imported",
      docId: "doc-1",
      fromPeerId: "peer-1",
    })
  })

  it("should warn and return if document not found", () => {
    const ctx = createMockCommandContext()
    // No document added to model

    const command: ImportDocDataCommand = {
      type: "cmd/import-doc-data",
      docId: "nonexistent-doc",
      data: new Uint8Array([1, 2, 3]),
      fromPeerId: "peer-1" as PeerID,
    }

    handleImportDocData(command, ctx)

    expect(ctx.logger.warn).toHaveBeenCalled()
    expect(ctx.dispatch).not.toHaveBeenCalled()
  })

  it("should pass fromPeerId to dispatch for echo prevention", () => {
    const docState = createDocState({ docId: "doc-1" })

    const ctx = createMockCommandContext()
    ctx.model.documents.set("doc-1", docState)

    const sourceDoc = new LoroDoc()
    const data = sourceDoc.export({ mode: "snapshot" })

    const command: ImportDocDataCommand = {
      type: "cmd/import-doc-data",
      docId: "doc-1",
      data,
      fromPeerId: "specific-peer" as PeerID,
    }

    handleImportDocData(command, ctx)

    expect(ctx.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        fromPeerId: "specific-peer",
      }),
    )
  })

  it("should handle valid snapshot data", () => {
    const docState = createDocState({ docId: "doc-1" })
    const importSpy = vi.spyOn(docState.doc, "import")

    const ctx = createMockCommandContext()
    ctx.model.documents.set("doc-1", docState)

    // Create valid snapshot data (empty doc snapshot is valid)
    const sourceDoc = new LoroDoc()
    const validData = sourceDoc.export({ mode: "snapshot" })

    const command: ImportDocDataCommand = {
      type: "cmd/import-doc-data",
      docId: "doc-1",
      data: validData,
      fromPeerId: "peer-1" as PeerID,
    }

    handleImportDocData(command, ctx)

    expect(importSpy).toHaveBeenCalledWith(validData)
    expect(ctx.dispatch).toHaveBeenCalled()
  })

  it("should import actual document changes", () => {
    const docState = createDocState({ docId: "doc-1" })

    const ctx = createMockCommandContext()
    ctx.model.documents.set("doc-1", docState)

    // Create source doc with content
    const sourceDoc = new LoroDoc()
    sourceDoc.getText("content").insert(0, "Hello World")
    const data = sourceDoc.export({ mode: "snapshot" })

    const command: ImportDocDataCommand = {
      type: "cmd/import-doc-data",
      docId: "doc-1",
      data,
      fromPeerId: "peer-1" as PeerID,
    }

    handleImportDocData(command, ctx)

    // Verify the content was imported
    expect(docState.doc.getText("content").toString()).toBe("Hello World")
  })
})
