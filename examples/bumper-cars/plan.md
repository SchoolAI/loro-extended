# 🎪 Bumper Cars Arena - Implementation Plan (Server Authoritative)

A multiplayer bumper cars game showcasing loro-extended's presence system. This example demonstrates a **Server-Authoritative** architecture where the server runs the physics simulation and clients send inputs.

## Tech Stack

- **Frontend**: React 19 + Vite 7 + TypeScript
- **Backend**: Express + WebSocket (ws)
- **Sync**: `@loro-extended/adapter-websocket` for real-time communication
- **Storage**: LevelDB for server-side persistence
- **Input**: nipplejs for touch/mobile joystick controls
- **Rendering**: HTML5 Canvas 2D

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         Client (Vite + React)                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────┐                                               │
│  │   nipplejs   │────────────────────────────────────────────┐  │
│  │   (input)    │                                            │  │
│  └──────────────┘                                            │  │
│                                                              │  │
│                                                              ▼  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    Canvas Renderer                       │   │
│  │  - Renders Game State from Server Presence               │   │
│  │  - Interpolates positions for smoothness                 │   │
│  └──────────────────────────────────────────────────────────┘   │
│                              ▲                                  │
│                              │                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    Document (CRDT)                       │   │
│  │  - Scoreboard: { peerId → { name, color, bumps } }       │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼ WebSocket
┌─────────────────────────────────────────────────────────────────┐
│                    Server (Express + ws)                        │
│  - Runs Physics Engine (60fps)                                  │
│  - Reads Client Inputs (from Client Presence)                   │
│  - Updates Game State (to Server Presence)                      │
│  - Updates Scoreboard (to Document)                             │
└─────────────────────────────────────────────────────────────────┘
```

## Data Models

### Presence Schemas

We use a discriminated union for presence to distinguish between clients (sending input) and the server (sending game state).

```typescript
// Client sends this
const ClientPresenceSchema = Shape.plain.object({
  type: Shape.plain.string(), // "client"
  name: Shape.plain.string(),
  color: Shape.plain.string(),
  input: Shape.plain.object({
    force: Shape.plain.number(),
    angle: Shape.plain.number(),
  }),
});

// Server sends this
const ServerPresenceSchema = Shape.plain.object({
  type: Shape.plain.string(), // "server"
  cars: Shape.plain.record(Shape.plain.object({
    x: Shape.plain.number(),
    y: Shape.plain.number(),
    rotation: Shape.plain.number(),
    color: Shape.plain.string(),
    name: Shape.plain.string(),
  })),
});

// Combined schema for usePresence
// Note: In practice, we might use a loose schema or a union if supported,
// but for simplicity we can use a superset or untyped presence.
```

### Document Schema (Persistent - Scoreboard)

```typescript
const PlayerScoreSchema = Shape.map({
  name: Shape.plain.string(),
  color: Shape.plain.string(),
  bumps: Shape.counter(),
});

const ArenaSchema = Shape.doc({
  scores: Shape.map(PlayerScoreSchema),
});

const EmptyArena = {
  scores: {},
};
```

## File Structure

```
examples/bumper-cars/
├── package.json
├── tsconfig.json
├── vite.config.ts
├── index.html
├── README.md
├── src/
│   ├── main.tsx                    # Entry point
│   ├── index.css                   # Global styles
│   ├── client/
│   │   ├── bumper-cars-app.tsx     # Main app component
│   │   ├── components/
│   │   │   ├── arena-canvas.tsx    # Canvas rendering
│   │   │   ├── scoreboard.tsx      # Top scores display
│   │   │   ├── joystick-zone.tsx   # nipplejs wrapper
│   │   │   ├── join-screen.tsx     # Name/color picker
│   │   │   └── player-list.tsx     # Active players sidebar
│   │   ├── hooks/
│   │   │   ├── use-game-loop.ts    # Main game loop
│   │   │   ├── use-joystick.ts     # nipplejs React hook
│   │   │   └── use-collision.ts    # Collision detection
│   │   └── lib/
│   │       ├── physics.ts          # Physics calculations
│   │       ├── colors.ts           # Car color palette
│   │       └── constants.ts        # Game constants
│   ├── server/
│   │   └── server.ts               # Express + WebSocket server
│   └── shared/
│       └── types.ts                # Shared types & schemas
```

## Implementation Tasks

### Phase 1: Project Setup

- [ ] Create package.json with dependencies (following todo-websocket pattern)
- [ ] Create tsconfig.json and tsconfig.node.json
- [ ] Create vite.config.ts with WebSocket proxy
- [ ] Create index.html
- [ ] Create basic CSS styles

### Phase 2: Shared Types & Schemas

- [ ] Define CarPresenceSchema and EmptyCarPresence
- [ ] Define ArenaSchema (with scoreboard) and EmptyArena
- [ ] Define game constants (arena size, car size, physics params)
- [ ] Define color palette for cars

### Phase 3: Server Setup

- [ ] Create Express server with WsServerNetworkAdapter
- [ ] Add LevelDB storage for persistent scores
- [ ] Configure WebSocket endpoint at /ws

### Phase 4: Client Foundation

- [ ] Create main.tsx with RepoProvider
- [ ] Create bumper-cars-app.tsx shell
- [ ] Implement join-screen.tsx (name/color picker with filled-in defaults for quick GO)
- [ ] Wire up useDocument for scoreboard
- [ ] Wire up usePresence for car state

### Phase 5: Game Rendering

- [ ] Create arena-canvas.tsx with 2D canvas
- [ ] Implement car rendering (colored rectangles with rotation)
- [ ] Implement wall rendering
- [ ] Render other players' cars from presence.all (with linear interpolation for smoothness)
- [ ] Add player name labels above cars
- [ ] Implement "Spectator Mode" (render arena behind join screen)

### Phase 6: Input & Physics

- [ ] Create use-joystick.ts hook wrapping nipplejs
- [ ] Create joystick-zone.tsx component
- [ ] Implement physics.ts (acceleration, friction, wall bounce) - **Moved to Server**
- [ ] Create use-game-loop.ts (Client side: just interpolation and rendering)
- [ ] Add keyboard fallback (WASD/arrows) for desktop

### Phase 7: Server Logic (New Phase)

- [ ] Implement Server Game Loop (60fps)
- [ ] Read all client inputs from presence
- [ ] Run physics simulation
- [ ] Broadcast game state via server presence
- [ ] Handle collisions and update document scores

### Phase 8: UI Polish

- [ ] Create scoreboard.tsx (top 5 scores, sorted by bumps)
- [ ] Create player-list.tsx (active players with colors)
- [ ] Add visual feedback on collision (flash, shake)
- [ ] Style the join screen
- [ ] Make responsive for mobile (add `touch-action: none`, prevent pull-to-refresh)

### Phase 9: Testing & Documentation

- [ ] Test with multiple browser tabs
- [ ] Test on mobile devices
- [ ] Write README.md with setup instructions
- [ ] Add inline code comments

## Key Implementation Details

### Server Game Loop (server/game-loop.ts)

```typescript
// Runs at 60fps on the server
setInterval(() => {
  const presence = handle.presence.get();
  const clientInputs = getClientInputs(presence);
  
  // Update physics for all cars
  const newGameState = physics.update(gameState, clientInputs);
  
  // Broadcast state
  handle.presence.set({
    type: "server",
    cars: newGameState.cars
  });
  
  // Handle collisions -> Update Document
  if (newGameState.collisions.length > 0) {
    handle.change(doc => {
      // update scores
    });
  }
}, 1000 / 60);
```

### Collision Detection

```typescript
function checkCarCollision(myCar, otherCar, carRadius) {
  const dx = myCar.position.x - otherCar.position.x;
  const dy = myCar.position.y - otherCar.position.y;
  const distance = Math.sqrt(dx * dx + dy * dy);

  if (distance < carRadius * 2) {
    // Calculate bounce direction
    const angle = Math.atan2(dy, dx);
    const bounceForce = 8;

    return {
      collided: true,
      bounceVelocity: {
        x: Math.cos(angle) * bounceForce,
        y: Math.sin(angle) * bounceForce,
      },
    };
  }

  return { collided: false };
}
```

### Scoring on Collision

```typescript
// Track recent collisions to prevent double-counting
const recentCollisions = useRef<Set<string>>(new Set());
const COLLISION_COOLDOWN = 500; // ms

function handleCollision(otherPeerId: string) {
  if (recentCollisions.current.has(otherPeerId)) return;

  // Add to cooldown set
  recentCollisions.current.add(otherPeerId);
  setTimeout(() => {
    recentCollisions.current.delete(otherPeerId);
  }, COLLISION_COOLDOWN);

  // Increment score in document
  changeDoc((draft) => {
    const myScore = draft.scores.get(myPeerId);
    if (myScore) {
      myScore.bumps.increment(1);
    }
  });
}
```

### nipplejs Integration

```typescript
function useJoystick(zoneRef: RefObject<HTMLElement>) {
  const [input, setInput] = useState({ force: 0, angle: 0 });

  useEffect(() => {
    if (!zoneRef.current) return;

    const manager = nipplejs.create({
      zone: zoneRef.current,
      mode: "static",
      position: { left: "50%", bottom: "100px" },
      color: "white",
      size: 120,
    });

    manager.on("move", (evt, data) => {
      setInput({
        force: data.force,
        angle: data.angle.radian,
      });
    });

    manager.on("end", () => {
      setInput({ force: 0, angle: 0 });
    });

    return () => manager.destroy();
  }, [zoneRef]);

  return input;
}
```

## Visual Design

### Color Palette for Cars

```typescript
const CAR_COLORS = [
  "#FF6B6B", // Red
  "#4ECDC4", // Teal
  "#45B7D1", // Blue
  "#96CEB4", // Green
  "#FFEAA7", // Yellow
  "#DDA0DD", // Plum
  "#98D8C8", // Mint
  "#F7DC6F", // Gold
  "#BB8FCE", // Purple
  "#85C1E9", // Sky
];
```

### Arena Layout

```
┌────────────────────────────────────────────────────────────┐
│  SCOREBOARD: 🥇 Alice: 42  🥈 Bob: 38  🥉 Carol: 25       │
├────────────────────────────────────────────────────────────┤
│                                                            │
│    ┌────────────────────────────────────────────────┐     │
│    │                    ARENA                        │     │
│    │                                                 │     │
│    │      🚗 Alice                                   │     │
│    │                    🚙 Bob                       │     │
│    │                                                 │     │
│    │  🚕 Carol                                       │     │
│    │                          🚐 You                │     │
│    │                                                 │     │
│    └────────────────────────────────────────────────┘     │
│                                                            │
│    ┌─────────┐                                            │
│    │    ◯    │  ← Joystick (nipplejs)                     │
│    │      ●  │                                            │
│    └─────────┘                                            │
│                                                            │
│    Active: Alice 🔴  Bob 🔵  Carol 🟡  You 🟢             │
└────────────────────────────────────────────────────────────┘
```

## Dependencies (package.json)

Based on the `todo-websocket` example pattern:

```json
{
  "name": "example-bumper-cars",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "build:all": "pnpm build:client && pnpm build:server",
    "build:client": "vite build",
    "build:server": "tsc --project tsconfig.node.json",
    "dev": "concurrently --raw \"npm:dev:server\" \"npm:dev:client\"",
    "dev:client": "vite",
    "dev:server": "tsx --watch src/server/server.ts",
    "serve:client": "vite preview",
    "serve:server": "node dist/src/server/server.js",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@logtape/logtape": "^1.1.1",
    "@loro-extended/adapter-leveldb": "workspace:^",
    "@loro-extended/adapter-websocket": "workspace:^",
    "@loro-extended/change": "workspace:^",
    "@loro-extended/react": "workspace:^",
    "@loro-extended/repo": "workspace:^",
    "classic-level": "^1.2.0",
    "cors": "^2.8.5",
    "express": "^4.19.2",
    "nipplejs": "^0.10.1",
    "react": "19.1.1",
    "react-dom": "19.1.1",
    "ws": "^8.18.0"
  },
  "devDependencies": {
    "@types/cors": "^2.8.17",
    "@types/express": "^4.17.21",
    "@types/node": "^20.19.9",
    "@types/react": "19.1.8",
    "@types/react-dom": "19.1.6",
    "@types/ws": "^8.5.13",
    "@vitejs/plugin-react": "^4.6.0",
    "concurrently": "^8.2.2",
    "tsx": "^4.20.3",
    "typescript": "~5.8.3",
    "vite": "^7.0.4",
    "vite-plugin-top-level-await": "^1.6.0",
    "vite-plugin-wasm": "^3.5.0"
  }
}
```

## Vite Configuration (vite.config.ts)

```typescript
import react from "@vitejs/plugin-react";
import { createLogger, defineConfig } from "vite";
import topLevelAwait from "vite-plugin-top-level-await";
import wasm from "vite-plugin-wasm";

// Filter out expected WebSocket proxy shutdown errors
const logger = createLogger();
const originalError = logger.error.bind(logger);
logger.error = (msg, options) => {
  if (
    typeof msg === "string" &&
    msg.includes("ws proxy") &&
    (msg.includes("EPIPE") || msg.includes("ECONNRESET"))
  ) {
    return;
  }
  originalError(msg, options);
};

export default defineConfig({
  clearScreen: false,
  customLogger: logger,
  plugins: [react(), wasm(), topLevelAwait()],
  optimizeDeps: {
    exclude: ["loro-crdt"],
  },
  build: {
    chunkSizeWarningLimit: 4000, // loro-crdt WASM is ~3MB
  },
  server: {
    allowedHosts: true,
    proxy: {
      "/ws": {
        target: "ws://localhost:5170",
        ws: true,
      },
    },
  },
});
```

## Server Implementation (server.ts)

Based on `todo-websocket/src/server/server.ts`:

```typescript
import { createServer } from "node:http";
import { configure, getConsoleSink } from "@logtape/logtape";
import { LevelDBStorageAdapter } from "@loro-extended/adapter-leveldb/server";
import {
  WsServerNetworkAdapter,
  wrapWsSocket,
} from "@loro-extended/adapter-websocket/server";
import { type PeerID, Repo } from "@loro-extended/repo";
import cors from "cors";
import express from "express";
import { WebSocketServer } from "ws";

// Configure LogTape
await configure({
  sinks: { console: getConsoleSink() },
  filters: {},
  loggers: [
    {
      category: ["@loro-extended"],
      lowestLevel: "debug",
      sinks: ["console"],
    },
    {
      category: ["logtape", "meta"],
      lowestLevel: "warning",
      sinks: ["console"],
    },
  ],
});

const app = express();
app.use(cors());
app.use(express.json());

// Create adapters
const wsAdapter = new WsServerNetworkAdapter();
const storageAdapter = new LevelDBStorageAdapter("loro-bumper-cars.db");

// Create Repo
new Repo({
  identity: { name: "bumper-cars-server", type: "service" },
  adapters: [wsAdapter, storageAdapter],
});

// Create HTTP + WebSocket server
const server = createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws, req) => {
  const url = new URL(req.url!, `http://${req.headers.host}`);
  const peerId = url.searchParams.get("peerId");

  console.log(`WebSocket connection from peerId: ${peerId}`);

  const { start } = wsAdapter.handleConnection({
    socket: wrapWsSocket(ws),
    peerId: peerId as PeerID | undefined,
  });

  start();
});

const PORT = process.env.PORT || 5170;
server.listen(PORT, () => {
  console.log(`Bumper Cars server listening on http://localhost:${PORT}`);
  console.log(`WebSocket endpoint: ws://localhost:${PORT}/ws`);
});
```

## Client Entry Point (main.tsx)

Based on `todo-websocket/src/main.tsx`:

```typescript
import { configure, getConsoleSink } from "@logtape/logtape";
import { WsClientNetworkAdapter } from "@loro-extended/adapter-websocket/client";
import { RepoProvider } from "@loro-extended/react";
import type { RepoParams } from "@loro-extended/repo";
import { createRoot } from "react-dom/client";
import BumperCarsApp from "./client/bumper-cars-app.tsx";
import "./index.css";

await configure({
  sinks: { console: getConsoleSink() },
  filters: {},
  loggers: [
    {
      category: ["@loro-extended"],
      lowestLevel: "debug",
      sinks: ["console"],
    },
    {
      category: ["logtape", "meta"],
      lowestLevel: "warning",
      sinks: ["console"],
    },
  ],
});

const root = document.getElementById("root");
if (!root) {
  throw new Error("Not found: DOM 'root' element");
}

const wsAdapter = new WsClientNetworkAdapter({
  url: (peerId) => `/ws?peerId=${peerId}`,
  reconnect: { enabled: true },
});

const config: RepoParams = {
  identity: { type: "user", name: "bumper-cars-player" },
  adapters: [wsAdapter],
};

createRoot(root).render(
  <RepoProvider config={config}>
    <BumperCarsApp />
  </RepoProvider>
);
```

## Success Criteria

1. ✅ Multiple players can join and see each other's cars moving in real-time
2. ✅ nipplejs joystick controls car movement smoothly
3. ✅ Cars bounce off arena walls
4. ✅ Cars bounce off each other
5. ✅ "Bumps given" score increments on collision
6. ✅ Scoreboard persists across page refreshes
7. ✅ Works on mobile devices
8. ✅ Demonstrates presence vs document distinction clearly
