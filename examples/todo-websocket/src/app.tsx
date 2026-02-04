import { WsClientNetworkAdapter } from "@loro-extended/adapter-websocket/client"
import {
  change,
  RepoProvider,
  Shape,
  useDoc,
  useHandle,
} from "@loro-extended/react"
import { generateUUID } from "@loro-extended/repo"
import { createRoot } from "react-dom/client"
import "./styles.css"

// Schema - defines the shape of our collaborative document
const TodoSchema = Shape.doc({
  todos: Shape.list(
    Shape.plain.struct({
      id: Shape.plain.string(),
      text: Shape.plain.string(),
      done: Shape.plain.boolean(),
    }),
  ),
})

// Main App Component
function App() {
  const handle = useHandle("todos", TodoSchema)
  const { todos } = useDoc(handle)

  const add = (text: string) => {
    handle.doc.todos.push({ id: generateUUID(), text, done: false })
  }

  const toggle = (id: string) => {
    change(handle.doc, d => {
      const todo = d.todos.find(t => t.id === id)
      if (todo) todo.done = !todo.done
    })
  }

  const remove = (id: string) => {
    change(handle.doc, d => {
      const idx = d.todos.findIndex(t => t.id === id)
      if (idx !== -1) d.todos.delete(idx, 1)
    })
  }

  return (
    <div>
      <h1>Collaborative Todos</h1>
      <form
        onSubmit={e => {
          e.preventDefault()
          const value = new FormData(e.currentTarget).get("text")
          const text = String(value).trim()
          if (text) add(text), e.currentTarget.reset()
        }}
      >
        <input name="text" type="text" placeholder="What needs to be done?" />
        <button type="submit">Add</button>
      </form>
      <ul>
        {todos.map(t => (
          <li key={t.id}>
            <input
              type="checkbox"
              checked={t.done}
              onChange={() => toggle(t.id)}
            />
            <span className={t.done ? "done" : ""}>{t.text}</span>
            <button type="button" onClick={() => remove(t.id)}>
              ×
            </button>
          </li>
        ))}
      </ul>
      <p className="hint">
        Open this page in another tab to see real-time sync!
      </p>
    </div>
  )
}

// Bootstrap - connect to WebSocket and render
const wsAdapter = new WsClientNetworkAdapter({
  url: `ws://${location.host}/ws`,
})

const rootEl = document.getElementById("root")

if (!rootEl) throw new Error("root element not found")

createRoot(rootEl).render(
  <RepoProvider config={{ adapters: [wsAdapter] }}>
    <App />
  </RepoProvider>,
)
