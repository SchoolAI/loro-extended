import { SseClientNetworkAdapter } from "@loro-extended/adapters/network/sse/client"
import { RepoProvider, Shape, useDocument } from "@loro-extended/hono"
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

const emptyState = { count: 0 }

// Generate a unique peer ID for this client (must be a numeric string)
const peerId = generatePeerId()

// Create the repo config (RepoProvider will create the Repo)
const repoConfig: RepoParams = {
  identity: { name: "hono-counter-client", type: "user", peerId },
  adapters: [
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
  const [doc, changeDoc] = useDocument("counter", counterSchema, emptyState)

  const increment = () => {
    changeDoc(draft => {
      // Shape.counter() provides a CRDT counter with increment method
      draft.count.increment(1)
    })
  }

  const decrement = () => {
    changeDoc(draft => {
      draft.count.decrement(1)
    })
  }

  return (
    <div>
      <div className="counter">
        {doc.count}
      </div>
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
