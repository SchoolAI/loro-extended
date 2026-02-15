import { LevelDBStorageAdapter } from "@loro-extended/adapter-leveldb/server"
import {
  createSseExpressRouter,
  SseServerNetworkAdapter,
} from "@loro-extended/adapter-sse/express"
import { change } from "@loro-extended/change"
import {
  type DocId,
  generateUUID,
  type HandleWithEphemerals,
  Repo,
} from "@loro-extended/repo"
import { streamText } from "ai"
import cors from "cors"
import express from "express"
import {
  ChatEphemeralDeclarations,
  ChatSchema,
  type Message,
  type MutableChatDoc,
  type MutableMessage,
  type Presence,
} from "../shared/types.js"
import { logger, model } from "./config.js"
import { requestLogger } from "./request-logger.js"

const app = express()
app.use(cors())
app.use(express.json())

// Add request logging middleware
app.use(requestLogger())

// Track active subscriptions to avoid double-subscribing
const subscriptions = new Map<DocId, () => void>()
const presences = new Map<DocId, Record<string, Presence>>()

type ChatHandle = HandleWithEphemerals<
  typeof ChatSchema,
  typeof ChatEphemeralDeclarations
>

/**
 * Stream LLM response directly into a mutable message reference.
 * This is the efficient "targetMessage" pattern - no repeated lookups needed.
 */
async function streamLLMResponse(
  handle: ChatHandle,
  targetMessage: MutableMessage,
): Promise<void> {
  try {
    // Convert chat history in document to LLM message context
    const messages: Array<{ role: "user" | "assistant"; content: string }> =
      handle.doc.messages.toArray().flatMap((msg: Message) =>
        msg.id === targetMessage.id
          ? []
          : [
              {
                role:
                  msg.role === "assistant"
                    ? ("assistant" as const)
                    : ("user" as const),
                content: msg.content,
              },
            ],
      )

    logger.info`Streaming response for message ${targetMessage.id} with ${messages.length} messages of context`

    const { textStream } = streamText({
      model,
      messages,
    })

    for await (const chunk of textStream) {
      // Stream directly into the mutable reference - no find() needed!
      change(handle.doc, () => {
        targetMessage.content.insert(targetMessage.content.length, chunk)
      })
    }

    logger.info`Completed streaming response for message ${targetMessage.id}`
  } catch (error) {
    logger.error`Error streaming LLM response: ${error}`
  }
}

/**
 * Append an assistant message and return a mutable reference to it.
 * The returned reference can be used for efficient streaming.
 */
function appendAssistantMessage(
  handle: ChatHandle,
  content: string,
): MutableMessage {
  const id = generateUUID()

  change(handle.doc, (draft: MutableChatDoc) => {
    draft.messages.push({
      id,
      role: "assistant",
      author: "ai",
      authorName: "AI Assistant",
      content,
      timestamp: Date.now(),
      needsAiReply: false,
    })
  })

  // Return mutable reference to the newly added message
  const msg = handle.doc.messages.get(handle.doc.messages.length - 1)
  if (!msg) {
    throw new Error("Failed to get newly added message")
  }
  return msg
}

/**
 * Process document updates to trigger AI responses.
 */
function processDocumentUpdate(docId: DocId, handle: ChatHandle) {
  try {
    const messagesRef = handle.doc.messages
    logger.debug`Processing doc ${docId}. Message count: ${messagesRef.length}`

    if (messagesRef.length === 0) return

    const lastMsg = messagesRef.get(messagesRef.length - 1)
    if (!lastMsg) return

    logger.debug`Doc ${docId} updated. Last message: ${lastMsg.role} - ${lastMsg.content.toString().substring(0, 20)}...`

    // Only process user messages
    if (lastMsg.role !== "user") return

    // Only reply if needed
    if (!lastMsg.needsAiReply) return

    // Check this off as taken care of
    change(handle.doc, () => {
      lastMsg.needsAiReply = false
    })

    let userCount = 0
    const presence = presences.get(docId)
    if (presence) {
      for (const value of Object.values(presence)) {
        if (value.type === "user") userCount++
      }

      if (
        userCount >= 2 &&
        !lastMsg.content.toString().toLowerCase().includes("@ai")
      ) {
        // Don't respond as an assistant
        return
      }
    }

    // Append an empty assistant message and get a mutable reference
    const targetMessage = appendAssistantMessage(handle, "")

    // Stream LLM response directly into the target message
    streamLLMResponse(handle, targetMessage)
  } catch (error) {
    logger.error`Error in document processing: ${error}`
  }
}

/**
 * Subscribe to a document to react to changes.
 * Uses HandleWithEphemerals for type-safe document and presence access.
 */
function subscribeToDocument(repo: Repo, docId: DocId) {
  if (subscriptions.has(docId)) {
    logger.warn("Already subscribed to {docId}", { docId })
    return
  }

  logger.info("Subscribing to document {docId}", { docId })

  const handle = repo.getHandle(docId, ChatSchema, ChatEphemeralDeclarations)

  // Subscribe to messages changes using path-based subscription
  const unsubscribeDoc = handle.subscribe(
    p => p.messages,
    () => {
      processDocumentUpdate(docId, handle)
    },
  )

  // Subscribe to presence changes - update the presences map on each change
  const unsubscribePresence = handle.presence.subscribe(() => {
    const all: Record<string, Presence> = {}
    const self = handle.presence.self
    if (self) {
      all[handle.peerId] = self
    }
    for (const [peerId, presence] of handle.presence.peers.entries()) {
      all[peerId] = presence
    }
    presences.set(docId, all)
  })

  subscriptions.set(docId, () => {
    unsubscribeDoc()
    unsubscribePresence()
  })

  // Check current state immediately (in case we missed the initial sync event)
  processDocumentUpdate(docId, handle)
}

// Create the adapter instances
const sseAdapter = new SseServerNetworkAdapter()
const storageAdapter = new LevelDBStorageAdapter("loro-chat-app.db")

// Create the Repo
const repo = new Repo({
  identity: { name: "example-chat-server", type: "service" },
  adapters: [sseAdapter, storageAdapter],
  permissions: {
    visibility(_doc, peer) {
      if (peer.channelKind === "storage") return true

      // Don't reveal documents unrelated to the one that the client asks for
      return false
    },
  },
})

// Listen for document discovery via ready-state-changed events
// This allows us to reactively subscribe to any document that enters the system
repo.synchronizer.emitter.on(
  "ready-state-changed",
  ({ docId, readyStates }) => {
    // If we're already subscribed, nothing to do
    if (subscriptions.has(docId)) return

    // Check if the document is available (found in storage or network)
    const isAvailable = readyStates.some(s => s.status === "synced")

    if (!isAvailable) return

    subscribeToDocument(repo, docId)
  },
)

// Create and mount the SSE Express router
app.use(
  "/loro",
  createSseExpressRouter(sseAdapter, {
    syncPath: "/sync",
    eventsPath: "/events",
    heartbeatInterval: 30000,
  }),
)

const PORT = process.env.PORT || 5170
app.listen(PORT, () => {
  console.log(
    `Loro-Extended Chat App Server listening on http://localhost:${PORT}`,
  )
})
