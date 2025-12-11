import { useEffect, useRef } from "react"

interface Message {
  content: string
}

export function useAutoScroll(
  ref: React.RefObject<HTMLElement | null>,
  messages: readonly Message[],
) {
  const lastMessageLengthRef = useRef(0)
  const lastMessageContentLengthRef = useRef(0)

  useEffect(() => {
    const lastMessage = messages[messages.length - 1]
    const lastMessageContentLength = lastMessage?.content?.length || 0

    const isNewMessage = messages.length > lastMessageLengthRef.current
    const isStreaming =
      lastMessageContentLength > lastMessageContentLengthRef.current &&
      !isNewMessage

    if (isNewMessage) {
      ref.current?.scrollIntoView({ behavior: "smooth" })
    } else if (isStreaming) {
      ref.current?.scrollIntoView({ behavior: "auto" })
    }

    lastMessageLengthRef.current = messages.length
    lastMessageContentLengthRef.current = lastMessageContentLength
  }, [messages, ref])
}