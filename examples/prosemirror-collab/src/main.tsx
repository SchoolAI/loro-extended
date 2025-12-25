/**
 * Main entry point for the collaborative ProseMirror app.
 *
 * Sets up LogTape logging and renders the React app with RepoProvider.
 */

import { configure, getConsoleSink } from "@logtape/logtape"
import { createRoot } from "react-dom/client"
import { App } from "./client/app.js"
import { AppRepoProvider } from "./client/repo-provider.js"
import "./index.css"

// Configure LogTape to log loro-extended messages to console
await configure({
  sinks: { console: getConsoleSink() },
  filters: {},
  loggers: [
    {
      category: ["@loro-extended"],
      lowestLevel: "info",
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

createRoot(root).render(
  <AppRepoProvider>
    <App />
  </AppRepoProvider>,
)
