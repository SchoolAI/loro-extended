import { IndexedDBStorageAdapter } from "@loro-extended/adapter-indexeddb"
import { SseClientNetworkAdapter } from "@loro-extended/adapter-sse/client"
import { RepoProvider, Shape, useDoc, useHandle } from "@loro-extended/hono"
import {
  generatePeerId,
  type PeerID,
  type RepoParams,
} from "@loro-extended/repo"
import { useMemo } from "hono/jsx"
import { render } from "hono/jsx/dom"
import "./style.css"

// Define the counter document schema using Shape.counter() which is a CRDT
const counterSchema = Shape.doc({
  count: Shape.counter(),
})

// Generate a unique peer ID for this client (must be a numeric string)
const peerId = generatePeerId()

// Create the repo config (RepoProvider will create the Repo)
const repoConfig: RepoParams = {
  identity: { name: "hono-counter-client", type: "user", peerId },
  adapters: [
    // IndexedDB for local persistence
    new IndexedDBStorageAdapter(),
    // SSE for network sync
    new SseClientNetworkAdapter({
      postUrl: (_peerId: PeerID) => `/sync/post`,
      eventSourceUrl: (peerId: PeerID) => `/sync/subscribe?peerId=${peerId}`,
    }),
  ],
}

function App() {
  // Memoize config to prevent re-creating Repo on every render
  const config = useMemo(() => repoConfig, [])

  return (
    <RepoProvider config={config}>
      <div className="card">
        <h1>Loro + Hono Counter</h1>
        <h2>Synced Counter</h2>
        <SyncedCounter />
      </div>
    </RepoProvider>
  )
}

function SyncedCounter() {
  // NEW API: Get handle first, then subscribe to doc
  const handle = useHandle("counter", counterSchema)
  const doc = useDoc(handle)

  const increment = () => {
    handle.doc.count.increment(1)
  }

  const decrement = () => {
    handle.doc.count.decrement(1)
  }

  return (
    <div>
      <div className="counter">{doc.count}</div>
      <div className="btn-group">
        <button type="button" className="btn btn-primary" onClick={decrement}>
          &ndash;
        </button>
        <button type="button" className="btn btn-primary" onClick={increment}>
          +
        </button>
      </div>
    </div>
  )
}

const root = document.getElementById("root")

if (!root) {
  throw new Error("`root` element not found in DOM")
}

render(<App />, root)
