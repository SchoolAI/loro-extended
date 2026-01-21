# Quiz Challenge E2E Tests

This directory contains end-to-end tests for the Quiz Challenge application, focusing on multi-client synchronization.

## Overview

The tests verify that the LEA 3.0 (Loro Extended Architecture) synchronization works correctly between multiple browser clients. Key scenarios tested:

1. **Quiz Start Sync** - When one client starts the quiz, all clients see the state change
2. **Option Selection Sync** - Selected answers sync across clients in real-time
3. **Answer Submission Sync** - Submitted answers and AI feedback sync to all clients
4. **Bidirectional Control** - Any client can advance the quiz (not just the one who started)
5. **Full Flow Sync** - Complete quiz flow with 3 questions syncs correctly

## Running Tests

```bash
# Install dependencies first
pnpm install

# Run e2e tests
pnpm test:e2e

# Run with UI mode for debugging
pnpm exec playwright test --ui

# Run a specific test
pnpm exec playwright test -g "should sync quiz start"
```

## Test Architecture

### Server Configuration

Tests run against a server on port 8004 (configured in `playwright.config.ts`). The server is started automatically by Playwright's `webServer` configuration.

### Document Isolation

Each test uses a unique document ID (via URL hash) to ensure test isolation:
```typescript
const testDocId = generateTestDocumentId() // e.g., "test-quiz-abc123"
await client1.goto(`/#${testDocId}`)
```

### Test Helpers

Located in `fixtures/test-helpers.ts`:

- `generateTestDocumentId()` - Creates unique document IDs
- `waitForConnectionState(page, state)` - Waits for WebSocket connection
- `waitForQuizState(page, state)` - Waits for quiz state machine state
- `startQuiz(page)` - Clicks start button
- `selectOption(page, index)` - Selects an answer option
- `submitAnswer(page)` - Submits the current answer
- `nextQuestion(page)` - Advances to next question

## Debugging Sync Issues

If tests fail, check:

1. **Connection State** - Both clients should reach "connected" state
2. **Server Logs** - Look for LEA runtime startup messages
3. **WebSocket Traffic** - Use browser devtools to inspect WS frames
4. **Document ID** - Ensure both clients use the same document ID

Enable debug logging by setting:
```bash
DEBUG=loro-extended:* pnpm test:e2e
```
