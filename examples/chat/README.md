# Loro Chat Example

A real-time collaborative chat application with AI streaming, demonstrating the power of [Loro](https://github.com/loro-dev/loro) CRDTs with React and reactive server-side AI responses.

## What Makes This Special?

This chat app showcases a **reactive architecture** where:

- **Real-time AI streaming** - LLM responses stream character-by-character directly into Loro Text containers
- **Server-side reactivity** - The server detects new messages via Loro sync and automatically triggers AI responses
- **Multi-user ready** - Supports multiple users chatting together, with @mentions to invoke the AI
- **Auto-mention mode** - In single-user conversations, the AI responds automatically to every message
- **Offline-first** - Works offline and syncs when reconnected
- **URL-based conversations** - Share a URL to invite others to your conversation
- **Beautiful UI** - Modern, mobile-friendly design with Tailwind CSS

## Architecture Highlights

### Reactive AI Streaming

Unlike traditional REST APIs where the client explicitly calls an endpoint, this app uses Loro's subscription system to reactively detect when users send messages:

```typescript
// Server subscribes to document changes
handle.doc.subscribe(() => {
  const messages = typedDoc.value.messages
  const lastMsg = messages[messages.length - 1]

  // Check for @mentions or auto-mention in single-user mode
  if (shouldRespondToMessage(lastMsg, typedDoc)) {
    // Create assistant message and stream LLM response into it
    streamLLMResponse(repo, docId, lastMsg.id)
  }
})
```

### Streaming into Loro Text

The server streams LLM tokens directly into a Loro `Text` container, which automatically syncs to all connected clients:

```typescript
const { textStream } = await streamText({
  model: openrouter("openai/gpt-4o"),
  messages: conversationHistory
})

let position = 0
for await (const chunk of textStream) {
  // Insert directly into the CRDT container
  textContainer.insert(position, chunk)
  position += chunk.length
  handle.doc.commit() // Triggers sync to all clients
}
```

### Type-Safe Schema

We use `@loro-extended/change` to define a type-safe schema shared between client and server:

```typescript
export const MessageSchema = Shape.map({
  id: Shape.plain.string(),
  role: Shape.plain.string(),      // 'user' | 'assistant'
  author: Shape.plain.string(),    // peerId or 'dot'
  content: Shape.text(),           // LoroText for streaming
  timestamp: Shape.plain.number(),
  mentions: Shape.plain.array(Shape.plain.string()) // Track @mentions
})

export const ChatSchema = Shape.doc({
  messages: Shape.list(MessageSchema),
})
```

## Multi-User Behavior

The app intelligently switches between "companion mode" and "assistant mode" based on the number of participants:

1.  **Single User (Companion Mode)**:
    - The AI responds to *every* message automatically.
    - Feels like a 1-on-1 conversation with the AI.

2.  **Multiple Users (Assistant Mode)**:
    - When a second user joins, the AI sends a system message: *"Just @dot mention me if you need me!"*
    - The AI stops auto-responding to allow humans to chat.
    - To invoke the AI, users must explicitly mention `@dot` in their message.

This transition happens automatically as soon as the server detects a second unique author in the document history.

## Getting Started

### Prerequisites

1. Get an OpenRouter API key at [https://openrouter.ai/keys](https://openrouter.ai/keys)
2. Install dependencies from the monorepo root:

```bash
pnpm install
```

### Setup

1. Create a `.env` file in this directory:

```bash
cp .env.example .env
```

2. Add your OpenRouter API key to `.env`:

```
OPENROUTER_API_KEY=your_actual_key_here
```

### Build the monorepo packages

```bash
pnpm -w build
```

### Run the development server

```bash
cd examples/chat
pnpm dev
```

This starts:

- React app on http://localhost:5173
- Express sync server on http://localhost:5170

Open multiple browser windows to see real-time collaboration in action!

## How It Works

### Client Flow

1. User types a message
2. Client adds message to Loro document with parsed @mentions
3. Loro automatically syncs to server
4. User sees their message immediately

### Server Flow

1. Server discovers document via `ready-state-changed` event
2. Server subscribes to document changes
3. When user message arrives, server checks if it should trigger AI
4. Server creates empty assistant message in the document
5. Server streams LLM response into the message's Text container
6. Each chunk triggers a Loro sync to all clients
7. Clients see the AI response streaming in real-time

## Project Structure

```
src/
├── client/          # React application
│   ├── App.tsx      # Main chat component (Tailwind CSS)
│   └── use-doc-id-from-hash.ts  # URL hash management
├── server/          # Express sync server
│   └── server.ts    # SSE endpoint + reactive AI streaming
└── shared/          # Shared types
    └── types.ts     # Chat schema definitions
```

## Learn More

- [Loro Documentation](https://loro.dev)
- [@loro-extended/change README](../../packages/change/README.md)
- [@loro-extended/repo README](../../packages/repo/README.md)
- [OpenRouter AI Documentation](https://openrouter.ai/docs)
- [Vercel AI SDK](https://sdk.vercel.ai/docs)
- [Tailwind CSS](https://tailwindcss.com/)

## Future Enhancements

- Multiple AI assistants (@gpt4, @claude, etc.)
- Message editing with conflict resolution
- Typing indicators (real-time presence)
- Rich text formatting
- File attachments
- Conversation search
