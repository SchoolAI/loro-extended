import { Shape, useHandle, useDoc } from "@loro-extended/react"
import { type DocId, generateUUID } from "@loro-extended/repo"
import { useEffect } from "react"
import { TodoSchema } from "../shared/types"
import { TodoInput } from "./components/todo-input"
import { TodoList } from "./components/todo-list"
import { useConnectionState } from "./use-connection-state"
import { useDocIdFromHash } from "./use-doc-id-from-hash"

// Define the schema for our document
const schema = Shape.doc({
  todos: Shape.list(TodoSchema),
})

// A known, constant ID for our single todo list document
const DEFAULT_TODO_DOC_ID: DocId = "todos-example-document"

function TodoApp() {
  // Get document ID from URL hash if present, otherwise use default
  const docId = useDocIdFromHash(DEFAULT_TODO_DOC_ID)

  // NEW API: Get handle first, then subscribe to doc
  const handle = useHandle(docId, schema)
  const doc = useDoc(handle)
  const connectionState = useConnectionState()

  useEffect(() => {
    console.log("doc state", doc)
    console.log("handle state", handle)
  }, [doc, handle])

  const addTodo = (text: string) => {
    handle.change(d => {
      d.todos.push({
        id: generateUUID(),
        text,
        completed: false,
      })
    })
  }

  const toggleTodo = (id: string) => {
    handle.change(d => {
      const todo = d.todos.find(t => t.id === id)
      if (todo) {
        todo.completed = !todo.completed
      }
    })
  }

  const deleteTodo = (id: string) => {
    handle.change(d => {
      const index = d.todos.findIndex(t => t.id === id)
      if (index > -1) {
        d.todos.delete(index, 1)
      }
    })
  }

  return (
    <div className="app-container">
      <header>
        <h1>Loro Todo</h1>
        <div className={`connection-status status-${connectionState}`}>
          {connectionState === "connected"
            ? "Connected"
            : connectionState === "connecting"
              ? "Connecting..."
              : connectionState === "reconnecting"
                ? "Reconnecting..."
                : "Disconnected"}
        </div>
      </header>
      <div className="todo-app">
        <TodoInput onAdd={addTodo} />
        <TodoList
          todos={doc.todos}
          onToggle={toggleTodo}
          onDelete={deleteTodo}
        />
      </div>
    </div>
  )
}

export default TodoApp
