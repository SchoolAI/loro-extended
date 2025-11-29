import {
  createSseExpressRouter,
  SseServerNetworkAdapter,
} from "@loro-extended/adapters/network/sse/server"
import { LevelDBStorageAdapter } from "@loro-extended/adapters/storage/level-db/server"
import { type InferPlainType, TypedDoc } from "@loro-extended/change"
import { type DocHandle, type DocId, Repo } from "@loro-extended/repo"
import { streamText } from "ai"
import cors from "cors"
import express from "express"
import {
  ChatSchema,
  EmptyPresence,
  PresenceSchema,
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
const presences = new Map<
  DocId,
  Record<string, InferPlainType<typeof PresenceSchema>>
>()

// Stream LLM response into a message
async function streamLLMResponse(
  typedDoc: TypedDoc<typeof ChatSchema>,
  messageId: string,
): Promise<void> {
  try {
    // Convert chat history in document to LLM message context
    const messages: Array<{ role: "user" | "assistant"; content: string }> =
      typedDoc.value.messages.flatMap(msg =>
        msg.id === messageId
          ? []
          : [
              {
                role: msg.role === "assistant" ? "assistant" : "user",
                content: msg.content,
              },
            ],
      )

    logger.info`Streaming response for message ${messageId} with ${messages.length} messages of context`

    const { textStream } = streamText({
      model,
      messages,
    })

    for await (const chunk of textStream) {
      typedDoc.change(draft => {
        const message = draft.messages.find(m => m.id === messageId)
        if (!message) {
          logger.warn`Unable to find target messageId ${messageId} in doc`
          return
        }

        message.content.insert(message.content.length, chunk)
      })
    }

    logger.info`Completed streaming response for message ${messageId}`
  } catch (error) {
    logger.error`Error streaming LLM response: ${error}`
  }
}

function appendAssistantMessage(
  typedDoc: TypedDoc<typeof ChatSchema>,
  content: string,
) {
  const id = crypto.randomUUID()

  typedDoc.change(draft => {
    draft.messages.push({
      id,
      role: "assistant",
      author: "ai",
      content,
      timestamp: Date.now(),
      needsAiReply: false,
    })
  })

  return id
}

// Process document updates to trigger AI
function processDocumentUpdate(
  docId: DocId,
  typedDoc: TypedDoc<typeof ChatSchema>,
) {
  try {
    const messages = typedDoc.value.messages
    logger.debug`Processing doc ${docId}. Message count: ${messages.length}`

    if (messages.length === 0) return

    const lastMsg = messages[messages.length - 1]
    logger.debug`Doc ${docId} updated. Last message: ${lastMsg.role} - ${lastMsg.content.substring(0, 20)}...`

    // Only process user messages
    if (lastMsg.role !== "user") return

    // Only reply if needed
    if (!lastMsg.needsAiReply) return

    // Check this off as taken care of
    typedDoc.change(draft => {
      const lastMsg = draft.messages.get(draft.messages.length - 1)
      lastMsg.needsAiReply = false
    })

    let userCount = 0
    const presence = presences.get(docId)
    if (presence) {
      for (const value of Object.values(presence)) {
        if (value.type === "user") userCount++
      }

      if (userCount >= 2 && !lastMsg.content.toString().includes("@ai")) {
        // Don't respond as an assistent
        return
      }
    }

    // Start with an empty message
    const assistantMsgId = appendAssistantMessage(typedDoc, "")

    // Stream LLM response into it
    streamLLMResponse(typedDoc, assistantMsgId)
  } catch (error) {
    logger.error`Error in document processing: ${error}`
  }
}

function getChatDoc(handle: DocHandle) {
  const typedDoc = new TypedDoc(
    ChatSchema,
    { messages: [], preferences: {} },
    handle.doc,
  )

  return typedDoc
}

// Subscribe to a document to react to changes
function subscribeToDocument(repo: Repo, docId: DocId) {
  if (subscriptions.has(docId)) {
    logger.warn("Already subscribed to {docId}", { docId })
    return
  }

  logger.info("Subscribing to document {docId}", { docId })

  const handle = repo.get(docId)

  const typedDoc = getChatDoc(handle)

  // Subscribe to future changes
  const unsubscribeDoc = handle.doc.subscribe(() => {
    processDocumentUpdate(docId, typedDoc)
  })

  const typedPresence = handle.presence(PresenceSchema, EmptyPresence)
  const unsubscribePresence = typedPresence.subscribe(({ all }) => {
    presences.set(docId, all)
  })

  subscriptions.set(docId, () => {
    unsubscribeDoc()
    unsubscribePresence()
  })

  // Check current state immediately (in case we missed the initial sync event)
  processDocumentUpdate(docId, typedDoc)
}

// Create the adapter instances
const sseAdapter = new SseServerNetworkAdapter()
const storageAdapter = new LevelDBStorageAdapter("loro-chat-app.db")

// Create the Repo
const repo = new Repo({
  identity: { name: "chat-app-server", type: "service" },
  adapters: [sseAdapter, storageAdapter],
  rules: {
    canReveal(context) {
      if (context.channelKind === "storage") return true

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
    const isAvailable = readyStates.some(s => s.state === "loaded")

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
