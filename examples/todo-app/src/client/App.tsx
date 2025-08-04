import { useMemo } from "react";
import { Repo, type DocumentId } from "@loro-extended/repo";
import { TodoList } from "./components/TodoList";
import { TodoInput } from "./components/TodoInput";
import { useLoroDoc } from "./hooks/useLoroDoc";
import { IndexedDBStorageAdapter } from "./IndexedDBStorageAdapter";
import { SseClientNetworkAdapter } from "./SseClientNetworkAdapter";
import type { Todo } from "../shared/types";
import "../App.css";

// Define the schema for our document
interface TodoDoc {
  todos: Todo[];
}

// A known, constant ID for our single todo list document
const TODO_DOC_ID = "todos-example-document" as DocumentId;

// Create the Repo instance outside the component so it's a singleton.
// This prevents it from being re-created on every render or HMR update.
const network = new SseClientNetworkAdapter("/loro");
const storage = new IndexedDBStorageAdapter();
const repo = new Repo({ network: [network], storage });

function App() {
  // Get a handle to the document. This will either find it in storage,
  // sync it from the network, or create it if it doesn't exist.
  const handle = useMemo(() => repo.find<TodoDoc>(TODO_DOC_ID), []);

  // Use our custom hook to get a reactive state of the document
  const [doc, changeDoc, state] = useLoroDoc(handle);

  const addTodo = (text: string) => {
    changeDoc(d => {
      // If the todos array doesn't exist yet, create it.
      if (!d.todos) {
        d.todos = [];
      }
      d.todos.push({
        id: crypto.randomUUID(),
        text,
        completed: false,
      });
    });
  };

  const toggleTodo = (id: string) => {
    changeDoc(d => {
      const todo = d.todos.find(t => t.id === id);
      if (todo) {
        todo.completed = !todo.completed;
      }
    });
  };

  const deleteTodo = (id: string) => {
    changeDoc(d => {
      const index = d.todos.findIndex(t => t.id === id);
      if (index > -1) {
        d.todos.splice(index, 1);
      }
    });
  };

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
        {(state === "loading" || state === "syncing") && <p>Loading...</p>}
        {state === "unavailable" && <p>Document not available.</p>}
      </div>
    </div>
  );
}

export default App;