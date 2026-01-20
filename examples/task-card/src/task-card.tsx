import type { Handle } from "@loro-extended/react"
import { useUndoManager } from "@loro-extended/react"
import { useId, useState } from "react"
import type { TaskIntention } from "./intentions.js"
import type { TaskDocSchema, TaskState } from "./schema.js"
import { useTask } from "./use-task.js"

// ═══════════════════════════════════════════════════════════════════════════
// Status Badge Component
// ═══════════════════════════════════════════════════════════════════════════

const STATUS_LABELS: Record<
  TaskState["status"],
  { emoji: string; label: string }
> = {
  draft: { emoji: "📝", label: "Draft" },
  todo: { emoji: "📋", label: "To Do" },
  in_progress: { emoji: "🔄", label: "In Progress" },
  blocked: { emoji: "🚫", label: "Blocked" },
  done: { emoji: "✅", label: "Done" },
  archived: { emoji: "📦", label: "Archived" },
}

function StatusBadge({ status }: { status: TaskState["status"] }) {
  const { emoji, label } = STATUS_LABELS[status]
  return (
    <span className={`status-badge ${status}`}>
      {emoji} {label}
    </span>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// State-Specific Views
// ═══════════════════════════════════════════════════════════════════════════

interface ViewProps {
  task: TaskState
  dispatch: (intention: TaskIntention) => void
}

function DraftView({ task, dispatch }: ViewProps) {
  const titleId = useId()

  if (task.status !== "draft") return null

  return (
    <>
      <div className="task-content">
        <div className="field">
          <label htmlFor={titleId} className="field-label">
            Title
          </label>
          <input
            id={titleId}
            type="text"
            value={task.title}
            onChange={e =>
              dispatch({ type: "UPDATE_TITLE", title: e.target.value })
            }
            placeholder="Enter task title..."
          />
        </div>
      </div>
      <div className="task-actions">
        <button
          type="button"
          className="action-btn primary"
          onClick={() => dispatch({ type: "PUBLISH" })}
          disabled={!task.title.trim()}
        >
          📤 Publish
        </button>
      </div>
    </>
  )
}

function TodoView({ task, dispatch }: ViewProps) {
  const titleId = useId()
  const descId = useId()

  if (task.status !== "todo") return null

  return (
    <>
      <div className="task-content">
        <div className="field">
          <label htmlFor={titleId} className="field-label">
            Title
          </label>
          <input
            id={titleId}
            type="text"
            value={task.title}
            onChange={e =>
              dispatch({ type: "UPDATE_TITLE", title: e.target.value })
            }
          />
        </div>
        <div className="field">
          <label htmlFor={descId} className="field-label">
            Description
          </label>
          <textarea
            id={descId}
            value={task.description}
            onChange={e =>
              dispatch({
                type: "UPDATE_DESCRIPTION",
                description: e.target.value,
              })
            }
            placeholder="Add a description..."
            rows={3}
          />
        </div>
      </div>
      <div className="task-actions">
        <button
          type="button"
          className="action-btn success"
          onClick={() => dispatch({ type: "START" })}
        >
          ▶️ Start
        </button>
      </div>
    </>
  )
}

function InProgressView({ task, dispatch }: ViewProps) {
  const titleId = useId()
  const descId = useId()
  const [blockReason, setBlockReason] = useState("")
  const [showBlockInput, setShowBlockInput] = useState(false)

  if (task.status !== "in_progress") return null

  const handleBlock = () => {
    if (blockReason.trim()) {
      dispatch({ type: "BLOCK", reason: blockReason })
      setBlockReason("")
      setShowBlockInput(false)
    }
  }

  return (
    <>
      <div className="task-content">
        <div className="field">
          <label htmlFor={titleId} className="field-label">
            Title
          </label>
          <input
            id={titleId}
            type="text"
            value={task.title}
            onChange={e =>
              dispatch({ type: "UPDATE_TITLE", title: e.target.value })
            }
          />
        </div>
        <div className="field">
          <label htmlFor={descId} className="field-label">
            Description
          </label>
          <textarea
            id={descId}
            value={task.description}
            onChange={e =>
              dispatch({
                type: "UPDATE_DESCRIPTION",
                description: e.target.value,
              })
            }
            rows={3}
          />
        </div>
      </div>
      <div className="task-actions">
        <button
          type="button"
          className="action-btn success"
          onClick={() => dispatch({ type: "COMPLETE" })}
        >
          ✅ Complete
        </button>
        {showBlockInput ? (
          <div className="block-input-group">
            <input
              type="text"
              value={blockReason}
              onChange={e => setBlockReason(e.target.value)}
              placeholder="Why is this blocked?"
              onKeyDown={e => e.key === "Enter" && handleBlock()}
            />
            <button
              type="button"
              className="action-btn danger"
              onClick={handleBlock}
              disabled={!blockReason.trim()}
            >
              Block
            </button>
            <button
              type="button"
              className="action-btn secondary"
              onClick={() => {
                setShowBlockInput(false)
                setBlockReason("")
              }}
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="action-btn warning"
            onClick={() => setShowBlockInput(true)}
          >
            🚫 Block
          </button>
        )}
      </div>
    </>
  )
}

function BlockedView({ task, dispatch }: ViewProps) {
  const titleId = useId()
  const descId = useId()

  if (task.status !== "blocked") return null

  return (
    <>
      <div className="task-content">
        <div className="field">
          <label htmlFor={titleId} className="field-label">
            Title
          </label>
          <input
            id={titleId}
            type="text"
            value={task.title}
            onChange={e =>
              dispatch({ type: "UPDATE_TITLE", title: e.target.value })
            }
          />
        </div>
        <div className="field">
          <label htmlFor={descId} className="field-label">
            Description
          </label>
          <textarea
            id={descId}
            value={task.description}
            onChange={e =>
              dispatch({
                type: "UPDATE_DESCRIPTION",
                description: e.target.value,
              })
            }
            rows={3}
          />
        </div>
        <div className="blocked-reason">
          <div className="blocked-reason-label">Blocked Reason</div>
          <div className="blocked-reason-text">{task.blockedReason}</div>
        </div>
      </div>
      <div className="task-actions">
        <button
          type="button"
          className="action-btn success"
          onClick={() => dispatch({ type: "UNBLOCK" })}
        >
          ✅ Unblock
        </button>
      </div>
    </>
  )
}

function DoneView({ task, dispatch }: ViewProps) {
  if (task.status !== "done") return null

  return (
    <>
      <div className="task-content">
        <div className="field">
          <span className="field-label">Title</span>
          <div className="field-value">{task.title}</div>
        </div>
        <div className="field">
          <span className="field-label">Description</span>
          <div className={`field-value ${!task.description ? "empty" : ""}`}>
            {task.description || "No description"}
          </div>
        </div>
      </div>
      <div className="task-actions">
        <button
          type="button"
          className="action-btn primary"
          onClick={() => dispatch({ type: "REOPEN" })}
        >
          🔄 Reopen
        </button>
      </div>
    </>
  )
}

function ArchivedView({ task }: ViewProps) {
  if (task.status !== "archived") return null

  return (
    <div className="archived-message">
      <h2>📦 Task Archived</h2>
      <p>"{task.title}"</p>
      <p style={{ marginTop: 12, fontSize: 12, color: "#999" }}>
        Archived on {new Date(task.archivedAt).toLocaleDateString()}
      </p>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Main TaskCard Component
// ═══════════════════════════════════════════════════════════════════════════

export function TaskCard({ handle }: { handle: Handle<typeof TaskDocSchema> }) {
  const { task, dispatch } = useTask(handle)
  const { undo, redo, canUndo, canRedo } = useUndoManager(handle)

  const renderContent = () => {
    switch (task.status) {
      case "draft":
        return <DraftView task={task} dispatch={dispatch} />
      case "todo":
        return <TodoView task={task} dispatch={dispatch} />
      case "in_progress":
        return <InProgressView task={task} dispatch={dispatch} />
      case "blocked":
        return <BlockedView task={task} dispatch={dispatch} />
      case "done":
        return <DoneView task={task} dispatch={dispatch} />
      case "archived":
        return <ArchivedView task={task} dispatch={dispatch} />
    }
  }

  return (
    <div className="task-card">
      <div className="task-header">
        <StatusBadge status={task.status} />
      </div>

      {renderContent()}

      {task.status !== "archived" && (
        <div className="task-footer">
          <div className="undo-redo">
            <button type="button" onClick={undo} disabled={!canUndo}>
              ⟲ Undo
            </button>
            <button type="button" onClick={redo} disabled={!canRedo}>
              ⟳ Redo
            </button>
          </div>
          <button
            type="button"
            className="archive-btn"
            onClick={() => dispatch({ type: "ARCHIVE" })}
          >
            📦 Archive
          </button>
        </div>
      )}
    </div>
  )
}
