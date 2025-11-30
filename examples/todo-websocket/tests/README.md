# Todo App (WebSocket) E2E Tests

This directory contains end-to-end tests for the Todo App (WebSocket version) using Playwright.

## Test Structure

- `e2e/basic-functionality.spec.ts` - Tests basic CRUD operations for todos
- `e2e/persistence.spec.ts` - Tests data persistence across sessions
- `e2e/multi-client-sync.spec.ts` - Tests real-time synchronization between multiple clients
- `e2e/fixtures/` - Helper functions and utilities for tests

## Running Tests

### Prerequisites

1. Install dependencies:
```bash
pnpm install
```

2. Install Playwright browsers:
```bash
pnpm exec playwright install
```

### Running the Tests

1. Start the development server (if not already running):
```bash
pnpm dev
```

2. In another terminal, run the tests:
```bash
# Run all tests
pnpm test:e2e

# Run tests with UI mode (interactive)
pnpm test:e2e:ui

# Run tests in headed mode (see browser)
pnpm exec playwright test --headed

# Run specific test file
pnpm exec playwright test basic-functionality

# Run tests with debug mode
pnpm exec playwright test --debug
```

## Test Coverage

The tests cover:

1. **Basic Functionality**
   - Creating todos
   - Toggling todo completion
   - Deleting todos

2. **Persistence**
   - Client-side persistence via IndexedDB
   - Server-side persistence via LevelDB
   - Data synchronization between clients

3. **Multi-Client Synchronization**
   - Real-time sync of new todos
   - Sync of todo completion status
   - Sync of todo deletion
   - Handling concurrent edits

## Troubleshooting

### Tests Failing Due to Timing Issues

If tests are failing due to synchronization timing, you can increase the timeout:

```typescript
await expect(element).toBeVisible({ timeout: 10000 });
```

### Port Conflicts

If you see port conflict errors, make sure:
- No other process is using port 5173 (client)
- No other process is using port 5170 (server)

### Database Issues

The tests use the LevelDB database at `loro-todo-websocket-app.db`. If you need to clean the database:

```bash
rm -rf loro-todo-websocket-app.db
```

## Writing New Tests

When writing new tests:

1. Use the helper functions from `fixtures/test-helpers.ts`
2. Always wait for the repo state to be 'ready' before interacting
3. Use specific selectors to avoid ambiguity
4. Clean up resources (close pages) after tests

Example:

```typescript
import { test, expect } from '@playwright/test';
import { createTodo, waitForRepoState } from './fixtures/test-helpers';

test('my new test', async ({ page }) => {
  await page.goto('/');
  await waitForRepoState(page, 'ready');
  
  await createTodo(page, 'Test Todo');
  
  // Your test assertions here
});