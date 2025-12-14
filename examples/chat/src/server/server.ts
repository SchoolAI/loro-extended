import { LevelDBStorageAdapter } from "@loro-extended/adapter-leveldb/server"
import {
  createSseExpressRouter,
  SseServerNetworkAdapter,
} from "@loro-extended/adapter-sse/server"
import {
  createTypedDoc,
  type Infer,
  type TypedDoc,
  TypedPresence,
} from "@loro-extended/change"
import {
  type DocId,
  generateUUID,
  Repo,
  type UntypedDocHandle,
} from "@loro-extended/repo"
import { streamText } from "ai"
import cors from "cors"
import express from "express"
import { ChatSchema, PresenceSchema } from "../shared/types.js"
import { logger, model } from "./config.js"
import { requestLogger } from "./request-logger.js"

const app = express()
app.use(cors())
app.use(express.json())

// Add request logging middleware
app.use(requestLogger())

// Track active subscriptions to avoid double-subscribing
const subscriptions = new Map<DocId, () => void>()
const presences = new Map<DocId, Record<string, Infer<typeof PresenceSchema>>>()

// Stream LLM response into a message
async function streamLLMResponse(
  typedDoc: TypedDoc<typeof ChatSchema>,
  messageId: string,
): Promise<void> {
  try {
    // Convert chat history in document to LLM message context
    const messages: Array<{ role: "user" | "assistant"; content: string }> =
      typedDoc.messages.toArray().flatMap((msg: any) =>
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
      typedDoc.$.change((draft: any) => {
        const message = draft.messages.find((m: any) => m.id === messageId)
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
  const id = generateUUID()

  typedDoc.$.change((draft: any) => {
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

  return id
}

// Process document updates to trigger AI
function processDocumentUpdate(
  docId: DocId,
  typedDoc: TypedDoc<typeof ChatSchema>,
) {
  try {
    const messagesRef = typedDoc.messages
    logger.debug`Processing doc ${docId}. Message count: ${messagesRef.length}`

    if (messagesRef.length === 0) return

    const lastMsg = messagesRef.get(messagesRef.length - 1)
    logger.debug`Doc ${docId} updated. Last message: ${lastMsg.role} - ${lastMsg.content.toString().substring(0, 20)}...`

    // Only process user messages
    if (lastMsg.role !== "user") return

    // Only reply if needed
    if (!lastMsg.needsAiReply) return

    // Check this off as taken care of
    typedDoc.$.change((draft: any) => {
      const lastMsg = draft.messages.get(draft.messages.length - 1)
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

function getChatDoc(handle: UntypedDocHandle): TypedDoc<typeof ChatSchema> {
  const typedDoc = createTypedDoc(ChatSchema, handle.doc)

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

  const typedPresence = new TypedPresence(PresenceSchema, handle.presence)
  const unsubscribePresence = typedPresence.subscribe(({ all }: any) => {
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
  identity: { name: "example-chat-server", type: "service" },
  adapters: [sseAdapter, storageAdapter],
  rules: {
    canReveal(context) {
      if (context.channelKind === "storage") return true

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
