# Loro-Extended Todo App Example

This example demonstrates a collaborative todo list application built with React, Vite, and `@loro-extended/repo`.

## Development

To start the development server for both the frontend and backend, run:

```bash
pnpm dev
```

This will:
- Start the Vite development server on `http://localhost:5173`.
- Start the backend server on `http://localhost:3001`.
- The frontend will automatically proxy API requests to the backend, so you can interact with the app seamlessly from the Vite server URL.

## Build

To build the application for production, run:

```bash
pnpm build
```

This command transpiles the server-side TypeScript and builds the static frontend assets into the `dist` directory.

## Serve

To run the production server, first build the application, then run:

```bash
pnpm serve
```

This will start the production server, which serves the built frontend assets and handles the backend API calls.
