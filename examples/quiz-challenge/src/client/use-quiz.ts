import type { Handle } from "@loro-extended/react"
import { useDoc } from "@loro-extended/react"
import { useCallback, useEffect, useRef, useState } from "react"
import type { HistoryDocSchema } from "../shared/history-schema.js"
import type { QuizMsg } from "../shared/messages.js"
import type { Dispatch } from "../shared/reactor-types.js"
import { runtime } from "../shared/runtime.js"
import { DEFAULT_QUESTIONS, type QuizDocSchema } from "../shared/schema.js"
import {
  createTimerReactor,
  createToastReactor,
  sensorReactor,
} from "./reactors.js"

// ═══════════════════════════════════════════════════════════════════════════
// LEA 3.0 Quiz Challenge - React Hook (Client-side)
// ═══════════════════════════════════════════════════════════════════════════
//
// This hook integrates LEA 3.0 with React:
// 1. Creates the runtime with CLIENT reactors only
// 2. Provides state and dispatch to components
// 3. Handles cleanup on unmount
//
// NOTE: The AI feedback reactor runs on the SERVER, not here.
// The client only runs: timer, sensor, and toast reactors.
//
// Separate History Document Pattern:
// - The runtime writes to a SEPARATE history document on each dispatch
// - This document is NEVER checked out, ensuring subscriptions always fire
// - The history panel subscribes to this document for real-time updates

export type Toast = {
  id: number
  message: string
  type: "success" | "error" | "info"
}

export function useQuiz(
  handle: Handle<typeof QuizDocSchema>,
  historyHandle: Handle<typeof HistoryDocSchema>,
) {
  // Get reactive state from the document
  const quizState = useDoc(handle, doc => doc.quiz.state)
  const score = useDoc(handle, doc => doc.score.value ?? 0)

  // Toast state (managed by React, not the CRDT)
  const [toasts, setToasts] = useState<Toast[]>([])
  const toastIdRef = useRef(0)

  // Runtime ref
  const runtimeRef = useRef<{ dispatch: Dispatch; dispose: () => void } | null>(
    null,
  )

  // Toast function
  const showToast = useCallback(
    (message: string, type: "success" | "error" | "info") => {
      const id = ++toastIdRef.current
      setToasts(prev => [...prev, { id, message, type }])

      // Auto-dismiss after 3 seconds
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== id))
      }, 3000)
    },
    [],
  )

  // Initialize runtime with CLIENT reactors only
  useEffect(() => {
    // Create instance-based timer reactor
    const { reactor: timerReactor, cleanup: cleanupTimer } =
      createTimerReactor()

    // Create toast reactor
    const toastReactor = createToastReactor(showToast)

    // Create runtime with CLIENT reactors only
    // NOTE: AI feedback reactor runs on the SERVER
    // Pass historyDoc for separate history document pattern
    runtimeRef.current = runtime({
      doc: handle.doc,
      questions: DEFAULT_QUESTIONS,
      reactors: [timerReactor, sensorReactor, toastReactor],
      historyDoc: historyHandle.doc,
    })

    return () => {
      runtimeRef.current?.dispose()
      cleanupTimer()
    }
  }, [handle, historyHandle, showToast])

  // Dispatch function
  const dispatch = useCallback((msg: QuizMsg) => {
    runtimeRef.current?.dispatch(msg)
  }, [])

  // Get current question
  const currentQuestion =
    quizState.status !== "idle" && quizState.status !== "complete"
      ? DEFAULT_QUESTIONS[quizState.questionIndex]
      : null

  return {
    quizState,
    score,
    currentQuestion,
    totalQuestions: DEFAULT_QUESTIONS.length,
    dispatch,
    toasts,
  }
}
