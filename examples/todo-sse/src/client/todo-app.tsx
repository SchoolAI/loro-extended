import { change, Shape, useDocument, useValue } from "@loro-extended/react"
import { type DocId, generateUUID } from "@loro-extended/repo"
import { useEffect } from "react"
import { type Todo, TodoSchema } from "../shared/types"
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

  // Get doc for mutations and reading
  const doc = useDocument(docId, schema)
  // Cast snapshot to help TypeScript infer the schema type
  const snapshot = useValue(doc) as { todos: readonly Todo[] }
  const connectionState = useConnectionState()

  useEffect(() => {
    console.log("doc state", snapshot)
    console.log("doc", doc)
  }, [snapshot, doc])

  const addTodo = (text: string) => {
    doc.todos.push({
      id: generateUUID(),
      text,
      completed: false,
    })
  }

  const toggleTodo = (id: string) => {
    change(doc, d => {
      const todo = d.todos.find((t: { id: string }) => t.id === id)
      if (todo) {
        todo.completed = !todo.completed
      }
    })
  }

  const deleteTodo = (id: string) => {
    change(doc, d => {
      const index = d.todos.findIndex((t: { id: string }) => t.id === id)
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
          todos={snapshot.todos}
          onToggle={toggleTodo}
          onDelete={deleteTodo}
        />
      </div>
    </div>
  )
}

export default TodoApp
