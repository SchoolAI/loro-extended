# Rooms and Presence Implementation Guide

## Problem Statement

The current `@loro-extended/repo` architecture provides excellent support for persistent, versioned document synchronization via CRDTs. However, it lacks support for **ephemeral presence and awareness** - the real-time information about who is online, what they're doing, and where they are in the application.

Real-time collaborative applications need two distinct types of data:

1. **Persistent Documents** (already supported)
   - Chat messages, document content, game state
   - Versioned, conflict-free, eventually consistent
   - Stored and synchronized via CRDTs

2. **Ephemeral Presence** (needs implementation)
   - User cursors, typing indicators, online status
   - Transient, last-write-wins, timeout-based
   - NOT persisted, only shared among active participants

The "room" paradigm from real-time gaming and collaboration tools provides the missing abstraction: **a named context where users are present together and share ephemeral state**.

## Key Observations

### 1. Rooms and Documents are Orthogonal Concerns

**Documents** answer: "What data exists?"
- Persistent, versioned data structures
- Synchronized via CRDTs
- Stored by storage adapters
- Accessed via `repo.get(docId)`

**Rooms** answer: "Who is present together?"
- Ephemeral presence contexts
- Synchronized via last-write-wins
- Never persisted
- Accessed via `repo.joinRoom(roomId)`

**Critical Insight**: Rooms and documents have NO built-in relationship. Developers can create conventions (e.g., `roomId` as prefix of `docId`), but the architecture doesn't enforce or assume any connection.

### 2. Many-to-Many Relationships

```
Users ←→ Rooms (presence)
Users ←→ Documents (data access)

Examples:
- Alice is in "lobby" room, accessing ["world", "chat"] documents
- Bob is in "lobby" room, accessing only ["world"] document
- Carol is in "team-a" room, accessing ["whiteboard", "team-chat"] documents
- Alice joins "team-a" room (now in 2 rooms simultaneously)
```

A user can:
- Be in multiple rooms simultaneously
- Access documents from any room (or no room)
- Have different presence data in each room

### 3. Presence is Room-Scoped

Each room has its own `EphemeralStore` instance:
- Presence data in "lobby" is separate from "team-a"
- When a user leaves a room, their presence in that room is removed
- Presence updates only broadcast to members of the same room

### 4. Room Lifecycle

Rooms are ephemeral and auto-destroy:
- Created when first user joins
- Destroyed after timeout when last user leaves
- No persistence - rooms don't survive server restart
- Timeout is configurable (default: 30 seconds)

### 5. Storage Adapters are Room-Agnostic

Storage adapters:
- Never receive room-related messages
- Never persist room state or presence data
- Only handle document synchronization
- Room messages are filtered out before reaching storage channels

### 6. Loro's EphemeralStore is Perfect for This

Loro provides `EphemeralStore` with exactly the semantics we need:
- Timestamp-based last-write-wins
- Automatic timeout and cleanup
- Efficient delta encoding
- Subscribe to local and remote updates

## Architecture Design

### Core Abstractions

```typescript
// Room represents a presence context
class Room {
  readonly roomId: string
  readonly presence: EphemeralStore
  
  getMembers(): PeerIdentityDetails[]
  leave(): void
}

// Repo manages both documents and rooms
class Repo {
  // Documents (existing)
  get<T>(docId: DocId): DocHandle<T>
  delete(docId: DocId): Promise<void>
  has(docId: DocId): boolean
  getDocIds(): DocId[]
  
  // Rooms (new)
  joinRoom(roomId: string, options?: RoomOptions): Room
  leaveRoom(roomId: string): void
  getRoom(roomId: string): Room | undefined
  getRooms(): Room[]
  
  // Events (forward-only)
  on<K extends keyof RepoEvents>(
    event: K,
    listener: (data: RepoEvents[K]) => void
  ): () => void
}

// Room options
type RoomOptions = {
  timeout?: number  // Presence timeout in ms (default: 30000)
}

// Repo events
type RepoEvents = {
  "room-created": { roomId: string; room: Room }
  "room-destroyed": { roomId: string }
  "room-member-joined": { roomId: string; member: PeerIdentityDetails }
  "room-member-left": { roomId: string; member: PeerIdentityDetails }
  "doc-created": { docId: string }
  "doc-destroyed": { docId: string }
}
```

### State Model

```typescript
type SynchronizerModel = {
  identity: PeerIdentityDetails
  documents: Map<DocId, DocState>
  channels: Map<ChannelId, Channel>
  peers: Map<PeerID, PeerState>
  
  // NEW: Room state
  rooms: Map<RoomId, RoomState>
}

type RoomState = {
  roomId: string
  ephemeral: EphemeralStore
  members: Set<PeerID>
  createdAt: Date
  lastActivity: Date
}

type RoomId = string
```

### Protocol Messages

```typescript
// Room lifecycle messages
type ChannelMsgJoinRoom = {
  type: "channel/join-room"
  roomId: string
  identity: PeerIdentityDetails
}

type ChannelMsgLeaveRoom = {
  type: "channel/leave-room"
  roomId: string
}

// Room presence updates
type ChannelMsgRoomPresence = {
  type: "channel/room-presence"
  roomId: string
  data: Uint8Array  // Encoded EphemeralStore update
}

// Room membership sync (sent on join)
type ChannelMsgRoomMembership = {
  type: "channel/room-membership"
  roomId: string
  members: PeerIdentityDetails[]
}

// Add to EstablishedMsg union
type EstablishedMsg =
  | ChannelMsgSyncRequest
  | ChannelMsgSyncResponse
  | ChannelMsgDirectoryRequest
  | ChannelMsgDirectoryResponse
  | ChannelMsgDeleteRequest
  | ChannelMsgDeleteResponse
  | ChannelMsgJoinRoom        // NEW
  | ChannelMsgLeaveRoom       // NEW
  | ChannelMsgRoomPresence    // NEW
  | ChannelMsgRoomMembership  // NEW
```

### Message Flow

#### Joining a Room

```
Client A                    Synchronizer                    Client B
   |                             |                             |
   |-- joinRoom("lobby") ------->|                             |
   |                             |                             |
   |                        Create RoomState                   |
   |                        Add A to members                   |
   |                             |                             |
   |<-- Room instance ----------|                             |
   |                             |                             |
   |                             |-- join-room --------------->|
   |                             |                             |
   |                             |<-- join-room ---------------|
   |                             |                             |
   |<-- room-membership ---------|                             |
   |                             |-- room-membership --------->|
```

#### Setting Presence

```
Client A                    Synchronizer                    Client B
   |                             |                             |
   | room.presence.set(...)      |                             |
   |                             |                             |
   |-- room-presence ----------->|                             |
   |    (local update)           |                             |
   |                             |                             |
   |                        Apply to RoomState                 |
   |                             |                             |
   |                             |-- room-presence ----------->|
   |                             |                             |
   |                             |                        Apply update
   |                             |                        Emit event
```

#### Leaving a Room

```
Client A                    Synchronizer                    Client B
   |                             |                             |
   |-- leaveRoom("lobby") ------>|                             |
   |                             |                             |
   |                        Remove A from members              |
   |                        Clear A's presence                 |
   |                             |                             |
   |                             |-- leave-room -------------->|
   |                             |                             |
   |                             |                        Update UI
   |                             |                             |
   |                        If members.size === 0:             |
   |                        Start timeout timer                |
   |                             |                             |
   |                        After timeout:                     |
   |                        Delete RoomState                   |
```

## Implementation Plan

### Phase 1: Core Room Infrastructure

#### 1.1 Update Type Definitions

**File**: `packages/repo/src/types.ts`

```typescript
export type RoomId = string

export type RoomState = {
  roomId: RoomId
  ephemeral: EphemeralStore
  members: Set<PeerID>
  createdAt: Date
  lastActivity: Date
  timeoutHandle?: NodeJS.Timeout
}

export function createRoomState({ roomId, timeout = 30000 }: { 
  roomId: RoomId
  timeout?: number 
}): RoomState {
  return {
    roomId,
    ephemeral: new EphemeralStore(timeout),
    members: new Set(),
    createdAt: new Date(),
    lastActivity: new Date(),
  }
}
```

#### 1.2 Add Room Messages to Channel Protocol

**File**: `packages/repo/src/channel.ts`

```typescript
export type ChannelMsgJoinRoom = {
  type: "channel/join-room"
  roomId: string
  identity: PeerIdentityDetails
}

export type ChannelMsgLeaveRoom = {
  type: "channel/leave-room"
  roomId: string
}

export type ChannelMsgRoomPresence = {
  type: "channel/room-presence"
  roomId: string
  data: Uint8Array
}

export type ChannelMsgRoomMembership = {
  type: "channel/room-membership"
  roomId: string
  members: PeerIdentityDetails[]
}

// Update EstablishedMsg union
export type EstablishedMsg =
  | ChannelMsgSyncRequest
  | ChannelMsgSyncResponse
  | ChannelMsgDirectoryRequest
  | ChannelMsgDirectoryResponse
  | ChannelMsgDeleteRequest
  | ChannelMsgDeleteResponse
  | ChannelMsgJoinRoom
  | ChannelMsgLeaveRoom
  | ChannelMsgRoomPresence
  | ChannelMsgRoomMembership
```

#### 1.3 Create Room Class

**File**: `packages/repo/src/room.ts`

```typescript
import { getLogger, type Logger } from "@logtape/logtape"
import type { EphemeralStore } from "loro-crdt"
import type { Synchronizer } from "./synchronizer.js"
import type { PeerIdentityDetails, RoomId } from "./types.js"

export class Room {
  readonly roomId: RoomId
  private readonly synchronizer: Synchronizer
  private readonly logger: Logger

  constructor(roomId: RoomId, synchronizer: Synchronizer, logger?: Logger) {
    this.roomId = roomId
    this.synchronizer = synchronizer
    this.logger = (logger ?? getLogger(["@loro-extended", "repo"])).with({
      roomId,
    })
  }

  get presence(): EphemeralStore {
    const roomState = this.synchronizer.getRoomState(this.roomId)
    if (!roomState) {
      throw new Error(`Room ${this.roomId} not found`)
    }
    return roomState.ephemeral
  }

  getMembers(): PeerIdentityDetails[] {
    const roomState = this.synchronizer.getRoomState(this.roomId)
    if (!roomState) return []
    
    return Array.from(roomState.members)
      .map(peerId => this.synchronizer.getPeerState(peerId)?.identity)
      .filter((identity): identity is PeerIdentityDetails => identity !== undefined)
  }

  onMemberJoined(callback: (member: PeerIdentityDetails) => void): () => void {
    // Subscribe to room membership events
    return this.synchronizer.emitter.on("room-member-joined", (event) => {
      if (event.roomId === this.roomId) {
        callback(event.member)
      }
    })
  }

  onMemberLeft(callback: (member: PeerIdentityDetails) => void): () => void {
    return this.synchronizer.emitter.on("room-member-left", (event) => {
      if (event.roomId === this.roomId) {
        callback(event.member)
      }
    })
  }

  leave(): void {
    this.synchronizer.leaveRoom(this.roomId)
  }
}
```

#### 1.4 Update Synchronizer Model

**File**: `packages/repo/src/synchronizer-program.ts`

```typescript
export type SynchronizerModel = {
  identity: PeerIdentityDetails
  documents: Map<DocId, DocState>
  channels: Map<ChannelId, Channel>
  peers: Map<PeerID, PeerState>
  rooms: Map<RoomId, RoomState>  // NEW
}

// Update init function
export function init(
  identity: PeerIdentityDetails,
): [SynchronizerModel, Command?] {
  return [
    {
      identity,
      documents: new Map(),
      channels: new Map(),
      peers: new Map(),
      rooms: new Map(),  // NEW
    },
  ]
}
```

#### 1.5 Add Room Messages to Synchronizer

**File**: `packages/repo/src/synchronizer-program.ts`

```typescript
export type SynchronizerMessage =
  // ... existing messages
  | { type: "synchronizer/room-join"; roomId: RoomId; options?: RoomOptions }
  | { type: "synchronizer/room-leave"; roomId: RoomId }
  | { type: "synchronizer/room-presence-local"; roomId: RoomId; data: Uint8Array }
  | { type: "synchronizer/room-timeout"; roomId: RoomId }

export type Command =
  // ... existing commands
  | { type: "cmd/subscribe-room-presence"; roomId: RoomId }
  | { type: "cmd/emit-room-member-joined"; roomId: RoomId; member: PeerIdentityDetails }
  | { type: "cmd/emit-room-member-left"; roomId: RoomId; member: PeerIdentityDetails }
```

### Phase 2: Message Handlers

#### 2.1 Handle Join Room

**File**: `packages/repo/src/synchronizer/handle-room-join.ts`

```typescript
import { isEstablished } from "../channel.js"
import type { Command, SynchronizerModel } from "../synchronizer-program.js"
import { createRoomState, type RoomId } from "../types.js"
import { batchAsNeeded } from "./utils.js"

export function handleRoomJoin(
  msg: { type: "synchronizer/room-join"; roomId: RoomId; options?: { timeout?: number } },
  model: SynchronizerModel,
): Command | undefined {
  const { roomId, options } = msg
  
  let roomState = model.rooms.get(roomId)
  
  // Create room if it doesn't exist
  if (!roomState) {
    roomState = createRoomState({ roomId, timeout: options?.timeout })
    model.rooms.set(roomId, roomState)
  }
  
  // Add ourselves to the room
  roomState.members.add(model.identity.peerId)
  roomState.lastActivity = new Date()
  
  // Clear any pending timeout
  if (roomState.timeoutHandle) {
    clearTimeout(roomState.timeoutHandle)
    roomState.timeoutHandle = undefined
  }
  
  const commands: Command[] = []
  
  // Send join-room to all established channels (except storage)
  for (const channel of model.channels.values()) {
    if (isEstablished(channel) && channel.kind !== "storage") {
      commands.push({
        type: "cmd/send-message",
        envelope: {
          toChannelIds: [channel.channelId],
          message: {
            type: "channel/join-room",
            roomId,
            identity: model.identity,
          },
        },
      })
    }
  }
  
  // Subscribe to local presence updates
  commands.push({
    type: "cmd/subscribe-room-presence",
    roomId,
  })
  
  return batchAsNeeded(...commands)
}
```

#### 2.2 Handle Leave Room

**File**: `packages/repo/src/synchronizer/handle-room-leave.ts`

```typescript
import { isEstablished } from "../channel.js"
import type { Command, SynchronizerModel } from "../synchronizer-program.js"
import type { RoomId } from "../types.js"
import { batchAsNeeded } from "./utils.js"

export function handleRoomLeave(
  msg: { type: "synchronizer/room-leave"; roomId: RoomId },
  model: SynchronizerModel,
): Command | undefined {
  const { roomId } = msg
  const roomState = model.rooms.get(roomId)
  
  if (!roomState) return
  
  // Remove ourselves from the room
  roomState.members.delete(model.identity.peerId)
  roomState.lastActivity = new Date()
  
  const commands: Command[] = []
  
  // Send leave-room to all established channels (except storage)
  for (const channel of model.channels.values()) {
    if (isEstablished(channel) && channel.kind !== "storage") {
      commands.push({
        type: "cmd/send-message",
        envelope: {
          toChannelIds: [channel.channelId],
          message: {
            type: "channel/leave-room",
            roomId,
          },
        },
      })
    }
  }
  
  // If room is now empty, start timeout
  if (roomState.members.size === 0) {
    const timeout = setTimeout(() => {
      // Dispatch room-timeout message
      commands.push({
        type: "cmd/dispatch",
        dispatch: {
          type: "synchronizer/room-timeout",
          roomId,
        },
      })
    }, 30000) // 30 second timeout
    
    roomState.timeoutHandle = timeout as any
  }
  
  return batchAsNeeded(...commands)
}
```

#### 2.3 Handle Room Presence (Incoming)

**File**: `packages/repo/src/synchronizer/handle-room-presence.ts`

```typescript
import type { ChannelHandlerContext } from "./types.js"
import type { ChannelMsgRoomPresence } from "../channel.js"
import type { Command } from "../synchronizer-program.js"

export function handleRoomPresence(
  msg: ChannelMsgRoomPresence,
  ctx: ChannelHandlerContext,
): Command | undefined {
  const { roomId, data } = msg
  const roomState = ctx.model.rooms.get(roomId)
  
  if (!roomState) {
    ctx.logger.warn("Received presence for unknown room", { roomId })
    return
  }
  
  // Apply the ephemeral update
  roomState.ephemeral.apply(data)
  roomState.lastActivity = new Date()
  
  return
}
```

### Phase 3: Repo Integration

#### 3.1 Add Room Methods and Events to Repo

**File**: `packages/repo/src/repo.ts`

```typescript
import { Room } from "./room.js"
import type { RoomId } from "./types.js"

// Add to RepoEvents type
type RepoEvents = {
  "room-created": { roomId: string; room: Room }
  "room-destroyed": { roomId: string }
  "room-member-joined": { roomId: string; member: PeerIdentityDetails }
  "room-member-left": { roomId: string; member: PeerIdentityDetails }
  "doc-created": { docId: string }
  "doc-destroyed": { docId: string }
}

export class Repo {
  // ... existing code
  
  readonly #rooms: Map<RoomId, Room> = new Map()
  
  /**
   * Join a room for presence and awareness.
   * Creates the room if it doesn't exist.
   */
  joinRoom(roomId: RoomId, options?: { timeout?: number }): Room {
    let room = this.#rooms.get(roomId)
    const isNewRoom = !room
    
    if (!room) {
      room = new Room(roomId, this.#synchronizer, this.logger)
      this.#rooms.set(roomId, room)
    }
    
    // Tell synchronizer to join the room
    this.#synchronizer.joinRoom(roomId, options)
    
    // Emit room-created event for new rooms
    if (isNewRoom) {
      this.#synchronizer.emitter.emit("room-created", { roomId, room })
    }
    
    return room
  }
  
  /**
   * Leave a room.
   */
  leaveRoom(roomId: RoomId): void {
    const room = this.#rooms.get(roomId)
    if (room) {
      this.#synchronizer.leaveRoom(roomId)
      this.#rooms.delete(roomId)
    }
  }
  
  /**
   * Get a room if already joined.
   */
  getRoom(roomId: RoomId): Room | undefined {
    return this.#rooms.get(roomId)
  }
  
  /**
   * Get all rooms we're currently in.
   */
  getRooms(): Room[] {
    return Array.from(this.#rooms.values())
  }
  
  /**
   * Get all document IDs.
   */
  getDocIds(): DocId[] {
    return Array.from(this.#handles.keys())
  }
  
  /**
   * Subscribe to repo events.
   * Events are forward-only - query state first, then subscribe.
   */
  on<K extends keyof RepoEvents>(
    event: K,
    listener: (data: RepoEvents[K]) => void
  ): () => void {
    return this.#synchronizer.emitter.on(event, listener)
  }
}
```

#### 3.2 Add Room Methods and Events to Synchronizer

**File**: `packages/repo/src/synchronizer.ts`

```typescript
// Update SynchronizerEvents type
type SynchronizerEvents = {
  "ready-state-changed": {
    docId: string
    readyStates: ReadyState[]
  }
  "room-created": { roomId: string; room: Room }
  "room-destroyed": { roomId: string }
  "room-member-joined": { roomId: string; member: PeerIdentityDetails }
  "room-member-left": { roomId: string; member: PeerIdentityDetails }
  "doc-created": { docId: string }
  "doc-destroyed": { docId: string }
}

export class Synchronizer {
  // ... existing code
  
  joinRoom(roomId: RoomId, options?: { timeout?: number }): void {
    this.#dispatch({
      type: "synchronizer/room-join",
      roomId,
      options,
    })
  }
  
  leaveRoom(roomId: RoomId): void {
    this.#dispatch({
      type: "synchronizer/room-leave",
      roomId,
    })
  }
  
  getRoomState(roomId: RoomId): RoomState | undefined {
    return this.model.rooms.get(roomId)
  }
  
  // Add to executeCommand
  #executeCommand(command: Command) {
    switch (command.type) {
      // ... existing cases
      
      case "cmd/subscribe-room-presence": {
        this.#executeSubscribeRoomPresence(command.roomId)
        break
      }
      
      case "cmd/emit-room-member-joined": {
        this.emitter.emit("room-member-joined", {
          roomId: command.roomId,
          member: command.member,
        })
        break
      }
      
      case "cmd/emit-room-member-left": {
        this.emitter.emit("room-member-left", {
          roomId: command.roomId,
          member: command.member,
        })
        break
      }
      
      case "cmd/emit-room-destroyed": {
        this.emitter.emit("room-destroyed", {
          roomId: command.roomId,
        })
        break
      }
    }
  }
  
  #executeSubscribeRoomPresence(roomId: RoomId) {
    const roomState = this.model.rooms.get(roomId)
    if (!roomState) return
    
    // Subscribe to local ephemeral updates
    roomState.ephemeral.subscribeLocalUpdates((data) => {
      this.#dispatch({
        type: "synchronizer/room-presence-local",
        roomId,
        data,
      })
    })
  }
}
```

### Phase 4: Testing

#### 4.1 Unit Tests

**File**: `packages/repo/src/room.test.ts`

```typescript
import { describe, it, expect } from "vitest"
import { Repo } from "./repo.js"

describe("Room", () => {
  it("should create and join a room", () => {
    const repo = new Repo({ adapters: [] })
    const room = repo.joinRoom("test-room")
    
    expect(room.roomId).toBe("test-room")
    expect(repo.getRoom("test-room")).toBe(room)
  })
  
  it("should set and get presence", () => {
    const repo = new Repo({ adapters: [] })
    const room = repo.joinRoom("test-room")
    
    room.presence.set("cursor", { x: 100, y: 200 })
    const cursor = room.presence.get("cursor")
    
    expect(cursor).toEqual({ x: 100, y: 200 })
  })
  
  it("should leave a room", () => {
    const repo = new Repo({ adapters: [] })
    const room = repo.joinRoom("test-room")
    
    repo.leaveRoom("test-room")
    
    expect(repo.getRoom("test-room")).toBeUndefined()
  })
})
```

#### 4.2 Integration Tests

**File**: `packages/repo/src/room-sync.test.ts`

```typescript
import { describe, it, expect } from "vitest"
import { Repo } from "./repo.js"
import { BridgeAdapter } from "./adapter/bridge-adapter.js"

describe("Room Synchronization", () => {
  it("should sync presence between peers", async () => {
    const bridge = new BridgeAdapter()
    const repoA = new Repo({ adapters: [bridge.createClient()] })
    const repoB = new Repo({ adapters: [bridge.createClient()] })
    
    const roomA = repoA.joinRoom("lobby")
    const roomB = repoB.joinRoom("lobby")
    
    // Wait for rooms to establish
    await new Promise(resolve => setTimeout(resolve, 100))
    
    // Set presence in A
    roomA.presence.set("cursor", { x: 100, y: 200 })
    
    // Wait for sync
    await new Promise(resolve => setTimeout(resolve, 100))
    
    // Check presence in B
    const allPresence = roomB.presence.getAllStates()
    expect(allPresence[repoA.identity.peerId]).toEqual({
      cursor: { x: 100, y: 200 }
    })
  })
  
  it("should track room members", async () => {
    const bridge = new BridgeAdapter()
    const repoA = new Repo({ 
      adapters: [bridge.createClient()],
      identity: { name: "Alice" }
    })
    const repoB = new Repo({ 
      adapters: [bridge.createClient()],
      identity: { name: "Bob" }
    })
    
    const roomA = repoA.joinRoom("lobby")
    const roomB = repoB.joinRoom("lobby")
    
    // Wait for sync
    await new Promise(resolve => setTimeout(resolve, 100))
    
    const membersA = roomA.getMembers()
    const membersB = roomB.getMembers()
    
    expect(membersA).toHaveLength(2)
    expect(membersB).toHaveLength(2)
    expect(membersA.map(m => m.name).sort()).toEqual(["Alice", "Bob"])
  })
})
```

## Event System Design

### Forward-Only Events with State Queries

The event system follows a **state + events** pattern:

1. **Events are forward-only**: Listeners only receive events emitted after subscription
2. **State queries are synchronous**: Use `getRooms()`, `getDocIds()`, etc. to get current state
3. **Pattern**: Query state first, then subscribe to changes

### Usage Pattern

```typescript
const repo = new Repo({ adapters: [networkAdapter] })

// Pattern: Query existing state first
const existingRooms = repo.getRooms()
for (const room of existingRooms) {
  console.log("Existing room:", room.roomId)
  handleRoom(room)
}

// Then subscribe to future changes
repo.on("room-created", ({ roomId, room }) => {
  console.log("New room:", roomId)
  handleRoom(room)
})

repo.on("room-member-joined", ({ roomId, member }) => {
  console.log(`${member.name} joined ${roomId}`)
})
```

### Why This Approach?

- **Clear semantics**: State queries and change notifications are distinct
- **No hidden magic**: Developers explicitly query state, then subscribe
- **Best performance**: No replay overhead or state tracking
- **Familiar pattern**: Similar to DOM APIs and other event systems

## Usage Examples

### Example 1: Chat with Typing Indicators

```typescript
import { Repo } from "@loro-extended/repo"

const repo = new Repo({ adapters: [networkAdapter] })

// Join the chat room
const chatRoom = repo.joinRoom("chat-general")

// Set typing status
chatRoom.presence.set("typing", { isTyping: true })

// Listen for others typing
chatRoom.presence.subscribe((event) => {
  const allPresence = chatRoom.presence.getAllStates()
  const typingUsers = Object.entries(allPresence)
    .filter(([_, data]) => data.typing?.isTyping)
    .map(([peerId, _]) => peerId)
  
  console.log("Users typing:", typingUsers)
})

// Listen for members joining (forward-only)
repo.on("room-member-joined", ({ roomId, member }) => {
  if (roomId === "chat-general") {
    console.log(`${member.name} joined the chat`)
  }
})

// Access chat messages (separate from room)
const chatDoc = repo.get("chat-general-messages")
chatDoc.change(doc => {
  doc.messages.push({ text: "Hello!", author: repo.identity.peerId })
})
```

### Example 2: Multiplayer Game

```typescript
// Join game lobby
const lobby = repo.joinRoom("game-lobby")

// Get existing members first
const existingMembers = lobby.getMembers()
for (const member of existingMembers) {
  console.log(`${member.name} is in the lobby`)
}

// Then listen for new members
repo.on("room-member-joined", ({ roomId, member }) => {
  if (roomId === "game-lobby") {
    console.log(`${member.name} joined the lobby`)
  }
})

// Set player status
lobby.presence.set("player", {
  name: "Alice",
  ready: false,
  character: "wizard"
})

// When game starts, join game room
const gameRoom = repo.joinRoom("game-session-123")

// Update position frequently
setInterval(() => {
  gameRoom.presence.set("position", {
    x: player.x,
    y: player.y,
    velocity: player.velocity
  })
}, 100)

// Access game state (separate document)
const gameState = repo.get("game-session-123-state")
```

### Example 3: Collaborative Editor

```typescript
// Join workspace
const workspace = repo.joinRoom("team-alpha-workspace")

// Get existing members
const members = workspace.getMembers()
console.log(`${members.length} people in workspace`)

// Listen for new members
repo.on("room-member-joined", ({ roomId, member }) => {
  if (roomId === "team-alpha-workspace") {
    showNotification(`${member.name} joined the workspace`)
  }
})

// Set user presence
workspace.presence.set("user", {
  name: "Alice",
  avatar: "🦊",
  currentDoc: "design-doc",
  cursor: { line: 42, column: 10 }
})

// Listen for presence changes
workspace.presence.subscribe((event) => {
  if (event.updated.length > 0) {
    updateCursors(workspace.presence.getAllStates())
  }
})

// Access documents (separate from room)
const designDoc = repo.get("design-doc")
const chatDoc = repo.get("team-chat")
```

## Migration Guide

### For Existing Applications

If you're currently using documents for presence (conflating concerns):

**Before:**
```typescript
const doc = repo.get("chat-room")
// Mixing persistent and ephemeral data
doc.change(d => {
  d.messages.push({ text: "Hello" })  // Persistent
  d.onlineUsers.set(myId, { typing: true })  // Should be ephemeral!
})
```

**After:**
```typescript
// Separate concerns
const room = repo.joinRoom("chat-room")
const doc = repo.get("chat-messages")

// Ephemeral presence
room.presence.set("status", { typing: true })

// Persistent messages
doc.change(d => {
  d.messages.push({ text: "Hello" })
})
```

## Future Enhancements

### 1. Room Permissions

```typescript
repo.joinRoom("private-room", {
  permissions: {
    canJoin: (peerId) => authorizedUsers.includes(peerId)
  }
})
```

### 2. Room Discovery

```typescript
// List available rooms
const rooms = await repo.discoverRooms()

// Search rooms by pattern
const teamRooms = await repo.discoverRooms("team-*")
```

### 3. Hierarchical Rooms

```typescript
// Parent-child room relationships
const workspace = repo.joinRoom("workspace-123")
const channel = workspace.joinSubRoom("general")
```

### 4. Room Metadata

```typescript
repo.joinRoom("lobby", {
  metadata: {
    name: "Main Lobby",
    description: "Welcome!",
    capacity: 100
  }
})
```

## Conclusion

This implementation provides a clean separation between persistent documents and ephemeral presence, following the proven "room" paradigm from real-time gaming and collaboration tools. The architecture is:

- **Orthogonal**: Rooms and documents are independent
- **Flexible**: Developers can create their own conventions
- **Efficient**: Uses Loro's EphemeralStore for optimal performance
- **Clean**: Storage adapters never see ephemeral data
- **Scalable**: Supports multiple rooms per user and multiple users per room