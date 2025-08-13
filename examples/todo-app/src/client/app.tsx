import { useLoroDoc } from "@loro-extended/react"
import type { DocumentId } from "@loro-extended/repo"
import { useEffect } from "react"
import type { Todo } from "../shared/types"
import { TodoInput } from "./components/todo-input"
import { TodoList } from "./components/todo-list"
import { useDocIdFromHash } from "./use-doc-id-from-hash"

// Define the schema for our document
interface TodoDoc {
  todos: Todo[]
}

// A known, constant ID for our single todo list document
const DEFAULT_TODO_DOC_ID: DocumentId = "todos-example-document"

function App() {
  // Get document ID from URL hash if present, otherwise use default
  const docId = useDocIdFromHash(DEFAULT_TODO_DOC_ID)

  // Use our custom hook to get a reactive state of the document
  const [doc, changeDoc, handle] = useLoroDoc<TodoDoc>(docId)

  useEffect(() => {
    console.log("doc state", doc)
  }, [doc])

  const addTodo = (text: string) => {
    changeDoc(d => {
      // If the todos array doesn't exist yet, create it.
      if (!d.todos) {
        d.todos = []
      }
      d.todos.push({
        id: crypto.randomUUID(),
        text,
        completed: false,
      })
    })
  }

  const toggleTodo = (id: string) => {
    changeDoc(d => {
      const todo = d.todos.find(t => t.id === id)
      if (todo) {
        todo.completed = !todo.completed
      }
    })
  }

  const deleteTodo = (id: string) => {
    changeDoc(d => {
      const index = d.todos.findIndex(t => t.id === id)
      if (index > -1) {
        d.todos.splice(index, 1)
      }
    })
  }

  const state = handle?.state || "loading"

  return (
    <div className="app-container">
      <header>
        <h1>Loro Todo</h1>
        <div className="connection-status">
          Repo State: <span className={`status-${state}`}>{state}</span>
        </div>
      </header>
      <div className="todo-app">
        <TodoInput onAdd={addTodo} />
        {state === "ready" && doc?.todos && (
          <TodoList
            todos={doc.todos}
            onToggle={toggleTodo}
            onDelete={deleteTodo}
          />
        )}
        {state === "loading" && <p>Loading...</p>}
        {state === "unavailable" && <p>Document not available.</p>}
      </div>
    </div>
  )
}

export default App
