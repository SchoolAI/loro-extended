import { LoroDoc } from "loro-crdt"
import { describe, expect, it } from "vitest"
import type { ChannelMsg } from "./channel.js"
import {
  deserializeChannelMsg,
  serializeChannelMsg,
  uint8ArrayFromJSON,
  uint8ArrayToJSON,
  versionVectorFromJSON,
  versionVectorToJSON,
} from "./channel-json.js"

describe("Channel JSON Serialization", () => {
  describe("VersionVector serialization", () => {
    it("should serialize empty VersionVector", () => {
      const doc = new LoroDoc()
      const vv = doc.version()
      const json = versionVectorToJSON(vv)
      expect(json).toEqual({})
    })

    it("should serialize VersionVector with single peer", () => {
      const doc = new LoroDoc()
      doc.setPeerId("1")
      doc.getText("text").insert(0, "hello")
      const vv = doc.version()
      const json = versionVectorToJSON(vv)
      expect(json).toEqual({ "1": 5 })
    })

    it("should serialize VersionVector with multiple peers", () => {
      const doc1 = new LoroDoc()
      doc1.setPeerId("1")
      doc1.getText("text").insert(0, "hello")

      const doc2 = new LoroDoc()
      doc2.setPeerId("2")
      doc2.getText("text").insert(0, "world")

      // Merge the documents
      doc1.import(doc2.export({ mode: "snapshot" }))
      const vv = doc1.version()
      const json = versionVectorToJSON(vv)

      expect(json).toEqual({ "1": 5, "2": 5 })
    })

    it("should deserialize empty VersionVector", () => {
      const json = {}
      const vv = versionVectorFromJSON(json)
      expect(vv.toJSON().size).toBe(0)
    })

    it("should deserialize VersionVector with single peer", () => {
      const json = { "1": 5 }
      const vv = versionVectorFromJSON(json)
      const result = vv.toJSON()
      expect(result.get("1")).toBe(5)
    })

    it("should deserialize VersionVector with multiple peers", () => {
      const json = { "1": 5, "2": 10 }
      const vv = versionVectorFromJSON(json)
      const result = vv.toJSON()
      expect(result.get("1")).toBe(5)
      expect(result.get("2")).toBe(10)
    })

    it("should round-trip VersionVector", () => {
      const doc = new LoroDoc()
      doc.setPeerId("42")
      doc.getText("text").insert(0, "test")
      const original = doc.version()

      const json = versionVectorToJSON(original)
      const restored = versionVectorFromJSON(json)

      expect(restored.toJSON()).toEqual(original.toJSON())
    })
  })

  describe("Uint8Array serialization", () => {
    it("should serialize empty Uint8Array", () => {
      const data = new Uint8Array([])
      const json = uint8ArrayToJSON(data)
      expect(json).toBe("")
    })

    it("should serialize Uint8Array with data", () => {
      const data = new Uint8Array([72, 101, 108, 108, 111]) // "Hello"
      const json = uint8ArrayToJSON(data)
      expect(typeof json).toBe("string")
      expect(json.length).toBeGreaterThan(0)
    })

    it("should deserialize empty string to empty Uint8Array", () => {
      const json = ""
      const data = uint8ArrayFromJSON(json)
      expect(data).toBeInstanceOf(Uint8Array)
      expect(data.length).toBe(0)
    })

    it("should deserialize Uint8Array", () => {
      const original = new Uint8Array([72, 101, 108, 108, 111])
      const json = uint8ArrayToJSON(original)
      const restored = uint8ArrayFromJSON(json)

      expect(restored).toBeInstanceOf(Uint8Array)
      expect(restored.length).toBe(original.length)
      expect(Array.from(restored)).toEqual(Array.from(original))
    })

    it("should round-trip Uint8Array with binary data", () => {
      const original = new Uint8Array([0, 1, 127, 128, 255])
      const json = uint8ArrayToJSON(original)
      const restored = uint8ArrayFromJSON(json)
      expect(Array.from(restored)).toEqual(Array.from(original))
    })

    it("should round-trip Loro document snapshot", () => {
      const doc = new LoroDoc()
      doc.getText("text")
      doc.getText("text").insert(0, "Hello World")
      const snapshot = doc.export({ mode: "snapshot" })

      const json = uint8ArrayToJSON(snapshot)
      const restored = uint8ArrayFromJSON(json)

      // Verify we can import the restored snapshot
      const newDoc = new LoroDoc()
      newDoc.import(restored)
      expect(newDoc.toJSON()).toEqual({ text: "Hello World" })
    })
  })

  describe("Channel message serialization", () => {
    describe("establishment messages", () => {
      it("should serialize establish-request", () => {
        const msg: ChannelMsg = {
          type: "channel/establish-request",
          identity: { peerId: "1", name: "Test Peer", type: "user" },
        }

        const json = serializeChannelMsg(msg)
        expect(json).toEqual(msg)
      })

      it("should serialize establish-response", () => {
        const msg: ChannelMsg = {
          type: "channel/establish-response",
          identity: { peerId: "2", name: "Another Peer", type: "user" },
        }

        const json = serializeChannelMsg(msg)
        expect(json).toEqual(msg)
      })

      it("should round-trip establish-request", () => {
        const original: ChannelMsg = {
          type: "channel/establish-request",
          identity: { peerId: "1", name: "Test Peer", type: "user" },
        }

        const json = serializeChannelMsg(original)
        const restored = deserializeChannelMsg(json)
        expect(restored).toEqual(original)
      })
    })

    describe("sync messages", () => {
      it("should serialize sync-request with single doc", () => {
        const doc = new LoroDoc()
        doc.setPeerId("1")
        doc.getText("text").insert(0, "test")

        const msg: ChannelMsg = {
          type: "channel/sync-request",
          docs: [
            {
              docId: "doc-1",
              requesterDocVersion: doc.version(),
            },
          ],
          bidirectional: false,
        }

        const json = serializeChannelMsg(msg)
        expect(json.type).toBe("channel/sync-request")
        if (json.type === "channel/sync-request") {
          expect(json.docs).toHaveLength(1)
          expect(json.docs[0].docId).toBe("doc-1")
          expect(json.docs[0].requesterDocVersion).toEqual({ "1": 4 })
        }
      })

      it("should serialize sync-request with multiple docs", () => {
        const doc1 = new LoroDoc()
        doc1.setPeerId("1")
        doc1.getText("text").insert(0, "a")

        const doc2 = new LoroDoc()
        doc2.setPeerId("2")
        doc2.getText("text").insert(0, "b")

        const msg: ChannelMsg = {
          type: "channel/sync-request",
          docs: [
            { docId: "doc-1", requesterDocVersion: doc1.version() },
            { docId: "doc-2", requesterDocVersion: doc2.version() },
          ],
          bidirectional: false,
        }

        const json = serializeChannelMsg(msg)
        if (json.type === "channel/sync-request") {
          expect(json.docs).toHaveLength(2)
          expect(json.docs[0].requesterDocVersion).toEqual({ "1": 1 })
          expect(json.docs[1].requesterDocVersion).toEqual({ "2": 1 })
        }
      })

      it("should serialize sync-response with up-to-date transmission", () => {
        const doc = new LoroDoc()
        doc.setPeerId("1")
        doc.getText("text").insert(0, "test")

        const msg: ChannelMsg = {
          type: "channel/sync-response",
          docId: "doc-1",
          transmission: {
            type: "up-to-date",
            version: doc.version(),
          },
        }

        const json = serializeChannelMsg(msg)
        expect(json.type).toBe("channel/sync-response")
        if (json.type === "channel/sync-response") {
          expect(json.transmission.type).toBe("up-to-date")
          if (json.transmission.type === "up-to-date") {
            expect(json.transmission.version).toEqual({ "1": 4 })
          }
        }
      })

      it("should serialize sync-response with snapshot transmission", () => {
        const doc = new LoroDoc()
        doc.setPeerId("1")
        doc.getText("text").insert(0, "hello")
        const snapshot = doc.export({ mode: "snapshot" })

        const msg: ChannelMsg = {
          type: "channel/sync-response",
          docId: "doc-1",
          transmission: {
            type: "snapshot",
            data: snapshot,
            version: doc.version(),
          },
        }

        const json = serializeChannelMsg(msg)
        expect(json.type).toBe("channel/sync-response")
        if (json.type === "channel/sync-response") {
          expect(json.transmission.type).toBe("snapshot")
          if (json.transmission.type === "snapshot") {
            expect(typeof json.transmission.data).toBe("string")
            expect(json.transmission.version).toEqual({ "1": 5 })
          }
        }
      })

      it("should serialize sync-response with update transmission", () => {
        const doc = new LoroDoc()
        doc.setPeerId("1")
        doc.getText("text").insert(0, "hello")
        const update = doc.export({ mode: "update" })

        const msg: ChannelMsg = {
          type: "channel/sync-response",
          docId: "doc-1",
          transmission: {
            type: "update",
            data: update,
            version: doc.version(),
          },
        }

        const json = serializeChannelMsg(msg)
        expect(json.type).toBe("channel/sync-response")
        if (json.type === "channel/sync-response") {
          expect(json.transmission.type).toBe("update")
          if (json.transmission.type === "update") {
            expect(typeof json.transmission.data).toBe("string")
            expect(json.transmission.version).toEqual({ "1": 5 })
          }
        }
      })

      it("should serialize sync-response with unavailable transmission", () => {
        const msg: ChannelMsg = {
          type: "channel/sync-response",
          docId: "doc-1",
          transmission: {
            type: "unavailable",
          },
        }

        const json = serializeChannelMsg(msg)
        if (json.type === "channel/sync-response") {
          expect(json.transmission.type).toBe("unavailable")
        }
      })

      it("should round-trip sync-request", () => {
        const doc = new LoroDoc()
        doc.setPeerId("1")
        doc.getText("text").insert(0, "test")

        const original: ChannelMsg = {
          type: "channel/sync-request",
          docs: [{ docId: "doc-1", requesterDocVersion: doc.version() }],
          bidirectional: false,
        }

        const json = serializeChannelMsg(original)
        const restored = deserializeChannelMsg(json)

        expect(restored.type).toBe("channel/sync-request")
        if (restored.type === "channel/sync-request") {
          expect(restored.docs).toHaveLength(1)
          expect(restored.docs[0].docId).toBe("doc-1")
          expect(restored.docs[0].requesterDocVersion.toJSON()).toEqual(
            original.docs[0].requesterDocVersion.toJSON(),
          )
        }
      })

      it("should round-trip sync-response with snapshot", () => {
        const doc = new LoroDoc()
        doc.setPeerId("1")
        doc.getText("text").insert(0, "hello world")
        const snapshot = doc.export({ mode: "snapshot" })

        const original: ChannelMsg = {
          type: "channel/sync-response",
          docId: "doc-1",
          transmission: {
            type: "snapshot",
            data: snapshot,
            version: doc.version(),
          },
        }

        const json = serializeChannelMsg(original)
        const restored = deserializeChannelMsg(json)

        expect(restored.type).toBe("channel/sync-response")
        if (restored.type === "channel/sync-response") {
          expect(restored.transmission.type).toBe("snapshot")
          if (restored.transmission.type === "snapshot") {
            // Verify the snapshot can be imported
            const newDoc = new LoroDoc()
            newDoc.import(restored.transmission.data)
            expect(newDoc.toJSON()).toEqual({ text: "hello world" })
          }
        }
      })
    })

    describe("sync messages with ephemeral", () => {
      it("should serialize sync-request with ephemeral data", () => {
        const doc = new LoroDoc()
        doc.setPeerId("1")
        doc.getText("text").insert(0, "test")

        const ephemeralData = new Uint8Array([1, 2, 3, 4, 5])

        const msg: ChannelMsg = {
          type: "channel/sync-request",
          docs: [
            {
              docId: "doc-1",
              requesterDocVersion: doc.version(),
              ephemeral: {
                peerId: "123456789",
                data: ephemeralData,
              },
            },
          ],
          bidirectional: false,
        }

        const json = serializeChannelMsg(msg)
        expect(json.type).toBe("channel/sync-request")
        if (json.type === "channel/sync-request") {
          expect(json.docs).toHaveLength(1)
          expect(json.docs[0].ephemeral).toBeDefined()
          expect(json.docs[0].ephemeral?.peerId).toBe("123456789")
          expect(typeof json.docs[0].ephemeral?.data).toBe("string")
        }
      })

      it("should serialize sync-response with ephemeral data", () => {
        const doc = new LoroDoc()
        doc.setPeerId("1")
        doc.getText("text").insert(0, "hello")
        const snapshot = doc.export({ mode: "snapshot" })

        const ephemeralData = new Uint8Array([10, 20, 30, 40, 50])

        const msg: ChannelMsg = {
          type: "channel/sync-response",
          docId: "doc-1",
          transmission: {
            type: "snapshot",
            data: snapshot,
            version: doc.version(),
          },
          ephemeral: [
            {
              peerId: "123456789",
              data: ephemeralData,
            },
          ],
        }

        const json = serializeChannelMsg(msg)
        expect(json.type).toBe("channel/sync-response")
        if (json.type === "channel/sync-response") {
          expect(json.ephemeral).toBeDefined()
          expect(json.ephemeral).toHaveLength(1)
          expect(json.ephemeral?.[0].peerId).toBe("123456789")
          expect(typeof json.ephemeral?.[0].data).toBe("string")
        }
      })

      it("should round-trip sync-request with ephemeral", () => {
        const doc = new LoroDoc()
        doc.setPeerId("1")
        doc.getText("text").insert(0, "test")

        const ephemeralData = new Uint8Array([1, 2, 3, 4, 5])

        const original: ChannelMsg = {
          type: "channel/sync-request",
          docs: [
            {
              docId: "doc-1",
              requesterDocVersion: doc.version(),
              ephemeral: {
                peerId: "123456789",
                data: ephemeralData,
              },
            },
          ],
          bidirectional: false,
        }

        const json = serializeChannelMsg(original)
        const restored = deserializeChannelMsg(json)

        expect(restored.type).toBe("channel/sync-request")
        if (restored.type === "channel/sync-request") {
          expect(restored.docs).toHaveLength(1)
          expect(restored.docs[0].ephemeral).toBeDefined()
          if (restored.docs[0].ephemeral) {
            expect(restored.docs[0].ephemeral.peerId).toBe("123456789")
            expect(Array.from(restored.docs[0].ephemeral.data)).toEqual(
              Array.from(ephemeralData),
            )
          }
        }
      })

      it("should round-trip sync-response with ephemeral", () => {
        const doc = new LoroDoc()
        doc.setPeerId("1")
        doc.getText("text").insert(0, "hello world")
        const snapshot = doc.export({ mode: "snapshot" })

        const ephemeralData = new Uint8Array([10, 20, 30, 40, 50])

        const original: ChannelMsg = {
          type: "channel/sync-response",
          docId: "doc-1",
          transmission: {
            type: "snapshot",
            data: snapshot,
            version: doc.version(),
          },
          ephemeral: [
            {
              peerId: "123456789",
              data: ephemeralData,
            },
          ],
        }

        const json = serializeChannelMsg(original)
        const restored = deserializeChannelMsg(json)

        expect(restored.type).toBe("channel/sync-response")
        if (restored.type === "channel/sync-response") {
          expect(restored.ephemeral).toBeDefined()
          expect(restored.ephemeral).toHaveLength(1)
          if (restored.ephemeral && restored.ephemeral[0]) {
            expect(restored.ephemeral[0].peerId).toBe("123456789")
            expect(Array.from(restored.ephemeral[0].data)).toEqual(
              Array.from(ephemeralData),
            )
          }
          // Also verify the snapshot still works
          if (restored.transmission.type === "snapshot") {
            const newDoc = new LoroDoc()
            newDoc.import(restored.transmission.data)
            expect(newDoc.toJSON()).toEqual({ text: "hello world" })
          }
        }
      })

      it("should handle sync-request without ephemeral (backward compatibility)", () => {
        const doc = new LoroDoc()
        doc.setPeerId("1")
        doc.getText("text").insert(0, "test")

        const original: ChannelMsg = {
          type: "channel/sync-request",
          docs: [
            {
              docId: "doc-1",
              requesterDocVersion: doc.version(),
              // No ephemeral field
            },
          ],
          bidirectional: false,
        }

        const json = serializeChannelMsg(original)
        const restored = deserializeChannelMsg(json)

        expect(restored.type).toBe("channel/sync-request")
        if (restored.type === "channel/sync-request") {
          expect(restored.docs[0].ephemeral).toBeUndefined()
        }
      })

      it("should handle sync-response without ephemeral (backward compatibility)", () => {
        const doc = new LoroDoc()
        doc.setPeerId("1")
        doc.getText("text").insert(0, "hello")

        const original: ChannelMsg = {
          type: "channel/sync-response",
          docId: "doc-1",
          transmission: {
            type: "up-to-date",
            version: doc.version(),
          },
          // No ephemeral field
        }

        const json = serializeChannelMsg(original)
        const restored = deserializeChannelMsg(json)

        expect(restored.type).toBe("channel/sync-response")
        if (restored.type === "channel/sync-response") {
          expect(restored.ephemeral).toBeUndefined()
        }
      })
    })

    describe("directory messages", () => {
      it("should serialize directory-request without docIds", () => {
        const msg: ChannelMsg = {
          type: "channel/directory-request",
        }

        const json = serializeChannelMsg(msg)
        expect(json).toEqual(msg)
      })

      it("should serialize directory-request with docIds", () => {
        const msg: ChannelMsg = {
          type: "channel/directory-request",
          docIds: ["doc-1", "doc-2"],
        }

        const json = serializeChannelMsg(msg)
        expect(json).toEqual(msg)
      })

      it("should serialize directory-response", () => {
        const msg: ChannelMsg = {
          type: "channel/directory-response",
          docIds: ["doc-1", "doc-2", "doc-3"],
        }

        const json = serializeChannelMsg(msg)
        expect(json).toEqual(msg)
      })

      it("should round-trip directory messages", () => {
        const request: ChannelMsg = {
          type: "channel/directory-request",
          docIds: ["doc-1"],
        }

        const response: ChannelMsg = {
          type: "channel/directory-response",
          docIds: ["doc-1", "doc-2"],
        }

        expect(deserializeChannelMsg(serializeChannelMsg(request))).toEqual(
          request,
        )
        expect(deserializeChannelMsg(serializeChannelMsg(response))).toEqual(
          response,
        )
      })

      it("should serialize new-doc", () => {
        const msg: ChannelMsg = {
          type: "channel/new-doc",
          docIds: ["doc-1", "doc-2", "doc-3"],
        }

        const json = serializeChannelMsg(msg)
        expect(json).toEqual(msg)
      })

      it("should round-trip new-doc message", () => {
        const original: ChannelMsg = {
          type: "channel/new-doc",
          docIds: ["doc-1", "doc-2"],
        }

        expect(deserializeChannelMsg(serializeChannelMsg(original))).toEqual(
          original,
        )
      })
    })

    describe("delete messages", () => {
      it("should serialize delete-request", () => {
        const msg: ChannelMsg = {
          type: "channel/delete-request",
          docId: "doc-to-delete",
        }

        const json = serializeChannelMsg(msg)
        expect(json).toEqual(msg)
      })

      it("should serialize delete-response with deleted status", () => {
        const msg: ChannelMsg = {
          type: "channel/delete-response",
          docId: "doc-1",
          status: "deleted",
        }

        const json = serializeChannelMsg(msg)
        expect(json).toEqual(msg)
      })

      it("should serialize delete-response with ignored status", () => {
        const msg: ChannelMsg = {
          type: "channel/delete-response",
          docId: "doc-1",
          status: "ignored",
        }

        const json = serializeChannelMsg(msg)
        expect(json).toEqual(msg)
      })

      it("should round-trip delete messages", () => {
        const request: ChannelMsg = {
          type: "channel/delete-request",
          docId: "doc-1",
        }

        const response: ChannelMsg = {
          type: "channel/delete-response",
          docId: "doc-1",
          status: "deleted",
        }

        expect(deserializeChannelMsg(serializeChannelMsg(request))).toEqual(
          request,
        )
        expect(deserializeChannelMsg(serializeChannelMsg(response))).toEqual(
          response,
        )
      })
    })
  })

  describe("JSON stringification", () => {
    it("should survive JSON.stringify and JSON.parse", () => {
      const doc = new LoroDoc()
      doc.setPeerId("1")
      doc.getText("text").insert(0, "test")

      const original: ChannelMsg = {
        type: "channel/sync-request",
        docs: [{ docId: "doc-1", requesterDocVersion: doc.version() }],
        bidirectional: false,
      }

      const json = serializeChannelMsg(original)
      const stringified = JSON.stringify(json)
      const parsed = JSON.parse(stringified)
      const restored = deserializeChannelMsg(parsed)

      expect(restored.type).toBe("channel/sync-request")
      if (restored.type === "channel/sync-request") {
        expect(restored.docs[0].requesterDocVersion.toJSON()).toEqual(
          original.docs[0].requesterDocVersion.toJSON(),
        )
      }
    })

    it("should handle complex message through full JSON cycle", () => {
      const doc = new LoroDoc()
      doc.setPeerId("1")
      doc.getText("text").insert(0, "hello world")
      const snapshot = doc.export({ mode: "snapshot" })

      const original: ChannelMsg = {
        type: "channel/sync-response",
        docId: "doc-1",
        transmission: {
          type: "snapshot",
          data: snapshot,
          version: doc.version(),
        },
      }

      // Full cycle: serialize -> stringify -> parse -> deserialize
      const json = serializeChannelMsg(original)
      const stringified = JSON.stringify(json)
      const parsed = JSON.parse(stringified)
      const restored = deserializeChannelMsg(parsed)

      // Verify the restored message works
      if (
        restored.type === "channel/sync-response" &&
        restored.transmission.type === "snapshot"
      ) {
        const newDoc = new LoroDoc()
        newDoc.import(restored.transmission.data)
        expect(newDoc.toJSON()).toEqual({ text: "hello world" })
      }
    })
  })
})
