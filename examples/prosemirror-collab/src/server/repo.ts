/**
 * Server-side Loro repository for collaborative ProseMirror.
 *
 * Uses LevelDB for persistence and WebSocket for real-time sync.
 */

import { LevelDBStorageAdapter } from "@loro-extended/adapter-leveldb/server"
import { WsServerNetworkAdapter } from "@loro-extended/adapter-websocket/server"
import { Repo } from "@loro-extended/repo"

// Storage path for LevelDB
const LORO_DB_PATH = "loro-prosemirror-collab.db"

// Create adapter instances
export const wsAdapter = new WsServerNetworkAdapter()
export const storageAdapter = new LevelDBStorageAdapter(LORO_DB_PATH)

// Create the server Repo
export const repo = new Repo({
  identity: {
    name: "prosemirror-collab-server",
    type: "service",
  },
  adapters: [wsAdapter, storageAdapter],
  permissions: {
    // Allow storage to reveal documents
    visibility(_doc, peer) {
      if (peer.channelKind === "storage") return true
      // Don't reveal documents unrelated to what the client asks for
      return false
    },
  },
})
