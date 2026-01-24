import type { Handle } from "@loro-extended/react"
import { useState } from "react"
import type { HistoryDocSchema } from "../shared/history-schema.js"
import type { QuizDocSchema } from "../shared/schema.js"
import { HistoryPanel } from "./history-panel.js"

// ═══════════════════════════════════════════════════════════════════════════
// Page Layout Component
// ═══════════════════════════════════════════════════════════════════════════
// Shared layout that wraps all pages with:
// - Detached state banner (when viewing historical state)
// - Time Travel button and panel
//
// This avoids repeating the same UI across every page component.

export interface PageLayoutProps {
  appHandle: Handle<typeof QuizDocSchema>
  historyHandle: Handle<typeof HistoryDocSchema>
  isDetached: boolean
  onReturnToLive: () => void
  children: React.ReactNode
}

export function PageLayout({
  appHandle,
  historyHandle,
  isDetached,
  onReturnToLive,
  children,
}: PageLayoutProps) {
  const [historyOpen, setHistoryOpen] = useState(false)

  return (
    <div className="page-layout">
      {/* Detached State Banner */}
      {isDetached && (
        <div className="detached-banner">
          <span>📜 Viewing historical state</span>
          <button type="button" onClick={onReturnToLive}>
            Return to Live
          </button>
        </div>
      )}

      {/* Time Travel Toggle Button */}
      <button
        type="button"
        className="history-toggle-btn"
        onClick={() => setHistoryOpen(!historyOpen)}
      >
        ⏱️ Time Travel
      </button>

      {/* History Panel */}
      <HistoryPanel
        appHandle={appHandle}
        historyHandle={historyHandle}
        isOpen={historyOpen}
        onClose={() => setHistoryOpen(false)}
      />

      {/* Page Content */}
      {children}
    </div>
  )
}
