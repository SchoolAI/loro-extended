import { SseClientNetworkAdapter } from "@loro-extended/network-sse/client"
import { RepoProvider } from "@loro-extended/react"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import App from "./client/app.tsx"
import { IndexedDBStorageAdapter } from "./client/indexd-db-storage-adapter.ts"
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
