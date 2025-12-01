import { configure, getConsoleSink } from "@logtape/logtape"
import { SseClientNetworkAdapter } from "@loro-extended/adapter-sse/client"
import { RepoProvider } from "@loro-extended/react"
import { createRoot } from "react-dom/client"
import TodoApp from "./client/todo-app.tsx"
import "./index.css"
import type { RepoParams } from "@loro-extended/repo"

// Configure LogTape to log everything to console
await configure({
  sinks: { console: getConsoleSink() },
  filters: {},
  loggers: [
    {
      category: ["@loro-extended"],
      lowestLevel: "debug", // Enable debug logging to see sync details
      sinks: ["console"],
    },
    {
      category: ["logtape", "meta"],
      lowestLevel: "warning",
      sinks: ["console"],
    },
  ],
})

const root = document.getElementById("root")
if (!root) {
  throw new Error("Not found: DOM 'root' element")
}

// Create the Repo config so it's a singleton.
// Connect directly to the backend server (no proxy)
const sseAdapter = new SseClientNetworkAdapter({
  postUrl: "/loro/sync",
  eventSourceUrl: peerId => `/loro/events?peerId=${peerId}`,
})

const config: RepoParams = {
  identity: { type: "user", name: "chat" },
  adapters: [sseAdapter],
}

createRoot(root).render(
  <RepoProvider config={config}>
    <TodoApp />
  </RepoProvider>,
)
