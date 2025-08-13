import { SseClientNetworkAdapter } from "@loro-extended/adapters/network/sse/client"
import { IndexedDBStorageAdapter } from "@loro-extended/adapters/storage/indexed-db/client"
import { RepoProvider } from "@loro-extended/react"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import App from "./client/app.tsx"
import "./index.css"

const root = document.getElementById("root")
if (!root) {
  throw new Error("Not found: DOM 'root' element")
}

// Create the Repo config so it's a singleton.
const config = {
  network: [new SseClientNetworkAdapter("/loro")],
  storage: new IndexedDBStorageAdapter(),
}

createRoot(root).render(
  <StrictMode>
    <RepoProvider config={config}>
      <App />
    </RepoProvider>
  </StrictMode>,
)
