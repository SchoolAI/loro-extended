import { type Infer, type InferMutableType, Shape } from "@loro-extended/change"

export const MessageSchema = Shape.map({
  id: Shape.plain.string(),
  role: Shape.plain.string("user", "assistant"),
  author: Shape.plain.string(), // peerId or 'ai' for AI
  authorName: Shape.plain.string(), // Display name - may include transition info like "Alice (was Bob)"
  content: Shape.text(), // LoroText for streaming
  timestamp: Shape.plain.number(),
  needsAiReply: Shape.plain.boolean(),
})

export const PreferenceSchema = Shape.map({
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

export const PresenceSchema = Shape.plain.object({
  type: Shape.plain.string("user", "ai"),
  name: Shape.plain.string(),
})

export type Presence = Infer<typeof PresenceSchema>

export const EmptyPresence: Presence = {
  type: "user",
  name: "Anonymous",
}
