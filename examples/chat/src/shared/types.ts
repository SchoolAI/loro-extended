import { type Infer, type InferMutableType, Shape } from "@loro-extended/change"

export const MessageSchema = Shape.struct({
  id: Shape.plain.string(),
  role: Shape.plain.string("user", "assistant"),
  author: Shape.plain.string(), // peerId or 'ai' for AI
  authorName: Shape.plain.string(), // Display name - may include transition info like "Alice (was Bob)"
  content: Shape.text(), // LoroText for streaming
  timestamp: Shape.plain.number(),
  needsAiReply: Shape.plain.boolean(),
})

export const PreferenceSchema = Shape.struct({
  showTip: Shape.plain.boolean(),
})

export const ChatSchema = Shape.doc({
  messages: Shape.list(MessageSchema),
  preferences: Shape.record(PreferenceSchema),
})

// Derive types from schemas for type safety
export type Message = Infer<typeof MessageSchema>
export type MutableMessage = InferMutableType<typeof MessageSchema>
export type ChatDoc = Infer<typeof ChatSchema>
export type MutableChatDoc = InferMutableType<typeof ChatSchema>

export const PresenceSchema = Shape.plain.struct({
  type: Shape.plain.string("user", "ai"),
  name: Shape.plain.string(),
})

export type Presence = Infer<typeof PresenceSchema>

/**
 * Ephemeral declarations for the chat - wraps the presence schema
 * This is the format expected by useHandle's third argument
 */
export const ChatEphemeralDeclarations = {
  presence: PresenceSchema,
}

export const EmptyPresence: Presence = {
  type: "user",
  name: "Anonymous",
}
