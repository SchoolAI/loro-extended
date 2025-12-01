# 🎪 Bumper Cars Arena

A multiplayer bumper cars game showcasing loro-extended's presence system with a **Server-Authoritative** architecture.

![Bumper Cars Arena](../../docs/images/loro-bumper-cars.webp)

## Features

- **Real-time multiplayer** - See other players' cars moving in real-time
- **Server-authoritative physics** - Server runs the physics simulation at 60fps
- **Touch controls** - nipplejs joystick for mobile devices
- **Keyboard controls** - WASD/Arrow keys for desktop
- **Persistent scoreboard** - Scores persist across page refreshes using CRDT
- **Collision detection** - Cars bounce off walls and each other
- **Score tracking** - Earn points by bumping into other players

## Architecture

This example demonstrates a **Server-Authoritative** architecture:

```
┌─────────────────────────────────────────────────────────────────┐
│                         Client (Vite + React)                   │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐                                               │
│  │   nipplejs   │ ─── Input ──────────────────────────────────┐ │
│  │   (joystick) │                                             │ │
│  └──────────────┘                                             │ │
│                                                               ▼ │
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

## Data Flow

1. **Client Input** → Client sends joystick/keyboard input via presence
2. **Server Physics** → Server reads all client inputs, runs physics simulation
3. **Game State** → Server broadcasts authoritative game state via presence
4. **Collision Scores** → Server updates CRDT document when collisions occur
5. **Rendering** → Clients render game state with interpolation for smoothness

## Running the Example

```bash
# From the repository root
pnpm install

# Start the development server
cd examples/bumper-cars
pnpm dev
```

This will start:

- **Vite dev server** on http://localhost:5173
- **WebSocket server** on http://localhost:5170

Open multiple browser tabs to see multiplayer in action!

## Tech Stack

- **Frontend**: React 19 + Vite 7 + TypeScript
- **Backend**: Express + WebSocket (ws)
- **Sync**: `@loro-extended/adapter-websocket` for real-time communication
- **Storage**: LevelDB for server-side persistence
- **Input**: nipplejs for touch/mobile joystick controls
- **Rendering**: HTML5 Canvas 2D

## Controls

- **Mobile/Touch**: Use the on-screen joystick
- **Desktop**: WASD or Arrow keys

## Key Concepts Demonstrated

### Presence vs Document

This example clearly demonstrates the difference between:

- **Presence** (ephemeral): Used for real-time game state

  - Client presence: Player input (joystick direction/force)
  - Server presence: Authoritative car positions, velocities, rotations

- **Document** (persistent): Used for the scoreboard
  - Player scores persist across page refreshes
  - Uses CRDT counter for bump counts

### Discriminated Union for Typed Presence

This example showcases the new `Shape.plain.discriminatedUnion()` feature for type-safe tagged unions:

```typescript
// Define variant shapes
const ClientPresenceSchema = Shape.plain.object({
  type: Shape.plain.string("client"),
  name: Shape.plain.string(),
  color: Shape.plain.string(),
  input: Shape.plain.object({
    force: Shape.plain.number(),
    angle: Shape.plain.number(),
  }),
});

const ServerPresenceSchema = Shape.plain.object({
  type: Shape.plain.string("server"),
  cars: Shape.plain.record(CarStateSchema),
  tick: Shape.plain.number(),
});

// Create discriminated union
const GamePresenceSchema = Shape.plain.discriminatedUnion("type", {
  client: ClientPresenceSchema,
  server: ServerPresenceSchema,
});

// Use with typed presence hook
const { all, setSelf } = usePresence(
  ARENA_DOC_ID,
  GamePresenceSchema,
  EmptyClientPresence
);

// Type-safe filtering
for (const presence of Object.values(all)) {
  if (presence.type === "server") {
    // TypeScript knows this is ServerPresence
    console.log(presence.cars, presence.tick);
  } else {
    // TypeScript knows this is ClientPresence
    console.log(presence.name, presence.input);
  }
}
```

### Server-Authoritative Architecture

Unlike peer-to-peer games, this example uses a server-authoritative model:

1. Clients only send **inputs**, not positions
2. Server runs the **physics simulation**
3. Server broadcasts **authoritative state**
4. Clients **render** the server state (with interpolation)

This prevents cheating and ensures consistent game state across all clients.

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
│   │   │   ├── join-screen.tsx     # Name/color picker
│   │   │   └── player-list.tsx     # Active players sidebar
│   │   └── hooks/
│   │       ├── use-joystick.ts     # nipplejs React hook
│   │       └── use-keyboard-input.ts # Keyboard controls
│   ├── server/
│   │   ├── server.ts               # Express + WebSocket server
│   │   ├── game-loop.ts            # Server-side game loop
│   │   ├── physics.ts              # Physics calculations
│   │   └── config.ts               # Server configuration
│   └── shared/
│       └── types.ts                # Shared types & schemas
```
