import { useDocument, usePresence, useRepo } from "@loro-extended/react"
import type { DocId } from "@loro-extended/repo"
import { useEffect, useRef, useState } from "react"
import { ChatSchema } from "../shared/types"
import { useDocIdFromHash } from "./use-doc-id-from-hash"

// Generate a new conversation ID
function generateConversationId(): DocId {
  return `chat-${crypto.randomUUID()}`
}

function ChatApp() {
  const repo = useRepo()
  const [input, setInput] = useState("")
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const [isCopied, setIsCopied] = useState(false)
  const [isConnected, setIsConnected] = useState(false)

  // Get document ID from URL hash, or create new conversation
  const docId = useDocIdFromHash(generateConversationId())

  // Ensure hash is set if it was empty (first load)
  useEffect(() => {
    if (!window.location.hash.slice(1)) {
      window.location.hash = docId
    }
  }, [docId])

  // Use our custom hook to get a reactive state of the document
  const [doc, changeDoc, handle] = useDocument(docId, ChatSchema, {
    messages: [],
    preferences: {},
  })

  // Use ephemeral state for presence
  const { all, self, setSelf } = usePresence(docId)

  // Set self presence
  useEffect(() => {
    setSelf({ type: "user", lastSeen: Date.now() })
  }, [setSelf])

  console.dir({ self, all }, { depth: null })

  const memberCount = Object.values(all).filter(
    (p: any) => p?.type === "user",
  ).length

  // Auto-scroll to bottom when messages change
  // biome-ignore lint/correctness/useExhaustiveDependencies: reacts to messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [doc.messages])

  const sendMessage = () => {
    if (!input.trim()) return

    changeDoc(d => {
      d.messages.push({
        id: crypto.randomUUID(),
        role: "user",
        author: repo.identity.peerId,
        content: input,
        timestamp: Date.now(),
        needsAiReply: true,
      })
    })

    setInput("")
  }

  const startNewConversation = () => {
    const newId = generateConversationId()
    window.location.hash = newId
  }

  const copyLink = () => {
    navigator.clipboard.writeText(window.location.href)
    setIsCopied(true)
    setTimeout(() => setIsCopied(false), 2000)
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  const myPeerId = repo.identity.peerId
  const showTip = doc.preferences[myPeerId]?.showTip !== false

  const dismissTip = () => {
    changeDoc(d => {
      const prefs = d.preferences.get(myPeerId)
      prefs.showTip = false
    })
  }

  useEffect(() => {
    if (!handle) return

    const updateConnectionStatus = (readyStates: any[]) => {
      const connected = readyStates.some(s => s.channelMeta.kind === "network")
      setIsConnected(connected)
    }

    // Initial check
    updateConnectionStatus(handle.readyStates)

    // Subscribe to changes
    return handle.onReadyStateChange(updateConnectionStatus)
  }, [handle])

  return (
    <div className="flex flex-col h-screen bg-amber-50 text-gray-800 font-sans">
      {/* Header */}
      <header className="bg-slate-800 text-white shadow-md z-10">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-blue-500 p-2 rounded-lg">
              <span className="text-xl">💬</span>
            </div>
            <div>
              <h1 className="font-bold text-lg leading-tight">Loro Chat</h1>
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <span
                  className={`inline-block w-2 h-2 rounded-full ${
                    isConnected ? "bg-green-400" : "bg-red-400 animate-pulse"
                  }`}
                />
                {isConnected ? "Connected" : "Connecting..."}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1 text-slate-300 text-sm">
              <span>👥</span>
              <span>{memberCount}</span>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={copyLink}
                className="p-2 hover:bg-slate-700 rounded-full transition-colors text-slate-300 hover:text-white"
                title="Copy Link"
              >
                {isCopied ? "✅" : "🔗"}
              </button>
              <button
                type="button"
                onClick={startNewConversation}
                className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-1.5 rounded-full text-sm font-medium transition-colors shadow-sm"
              >
                New Chat
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Info Banner */}
      {showTip && (
        <div className="bg-amber-100 border-b border-amber-200 px-4 py-2 text-center text-sm text-amber-800 relative">
          💡 Tip: Share this URL with friends to chat together! Use{" "}
          <code className="bg-amber-200 px-1 rounded font-mono text-amber-900">
            @ai
          </code>{" "}
          to ask the AI.
          <button
            type="button"
            onClick={dismissTip}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:bg-amber-200 rounded-full text-amber-600 hover:text-amber-900 transition-colors"
            aria-label="Dismiss tip"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="w-4 h-4"
            >
              <title>Close tip</title>
              <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
            </svg>
          </button>
        </div>
      )}

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
        <div className="max-w-4xl mx-auto space-y-6">
          {doc.messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center space-y-4 opacity-60">
              <div className="text-6xl">👋</div>
              <h2 className="text-2xl font-bold text-gray-700">
                Welcome to Loro Chat!
              </h2>
              <p className="max-w-md text-gray-500">
                This is a collaborative space. Type a message below to start.
                The AI assistant will respond automatically in this private
                chat.
              </p>
            </div>
          ) : (
            doc.messages.map(msg => (
              <div
                key={msg.id}
                className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}
              >
                {/* Avatar */}
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-sm shadow-sm shrink-0 ${
                    msg.role === "user"
                      ? "bg-blue-100 text-blue-600"
                      : "bg-purple-100 text-purple-600"
                  }`}
                >
                  {msg.role === "user" ? "👤" : "🤖"}
                </div>

                {/* Message Bubble */}
                <div
                  className={`flex flex-col max-w-[85%] sm:max-w-[75%] ${msg.role === "user" ? "items-end" : "items-start"}`}
                >
                  <div className="flex items-baseline gap-2 mb-1 px-1">
                    <span className="text-xs font-medium text-gray-500">
                      {msg.role === "user" ? "You" : "AI Assistant"}
                    </span>
                    <span className="text-[10px] text-gray-400">
                      {new Date(msg.timestamp).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                  <div
                    className={`px-4 py-2.5 rounded-2xl shadow-sm text-sm sm:text-base leading-relaxed whitespace-pre-wrap break-words ${
                      msg.role === "user"
                        ? "bg-blue-500 text-white rounded-tr-none"
                        : "bg-white text-gray-800 border border-gray-100 rounded-tl-none"
                    }`}
                  >
                    {msg.content}
                    {msg.role === "assistant" && msg.content.length === 0 && (
                      <span className="inline-block w-2 h-4 bg-gray-400 animate-pulse ml-1 align-middle" />
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input Area */}
      <div className="bg-white border-t border-gray-200 p-4 sm:p-6">
        <div className="max-w-4xl mx-auto flex gap-3">
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Type a message..."
            className="flex-1 bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-full focus:ring-blue-500 focus:border-blue-500 block w-full p-3 px-5 shadow-sm transition-all outline-none"
            disabled={!handle}
          />
          <button
            type="button"
            onClick={sendMessage}
            disabled={!input.trim() || !handle}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-full p-3 w-12 h-12 flex items-center justify-center shadow-md transition-all hover:scale-105 active:scale-95"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="currentColor"
              className="w-5 h-5 ml-0.5"
            >
              <title>Send</title>
              <path d="M3.478 2.404a.75.75 0 0 0-.926.941l2.432 7.905H13.5a.75.75 0 0 1 0 1.5H4.984l-2.432 7.905a.75.75 0 0 0 .926.94 60.519 60.519 0 0 0 18.445-8.986.75.75 0 0 0 0-1.218A60.517 60.517 0 0 0 3.478 2.404Z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}

export default ChatApp
