import { Shape } from "@loro-extended/change"
import type { PeerID } from "@loro-extended/repo"

export const MessageSchema = Shape.map({
  id: Shape.plain.string(),
  role: Shape.plain.string(), // 'user' | 'assistant'
  author: Shape.plain.string(), // peerId or 'ai' for AI
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

export type Message = {
  id: string
  role: "user" | "assistant"
  author: PeerID
  content: string
  timestamp: number
  needsAiReply: false
}
