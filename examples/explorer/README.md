# Loro Explorer

A TUI (Terminal User Interface) tool for inspecting Loro documents stored in LevelDB.

This tool is designed to help developers debug and visualize the state of Loro documents persisted by the `@loro-extended/adapters/storage/level-db` adapter. It allows you to navigate through documents, view their update history, and inspect the reconstructed document state at any point in time.

## Features

- **Document List**: View all documents stored in the database.
- **Record History**: Inspect the sequence of updates and snapshots for a selected document.
- **Time-Travel Inspection**: Select any record to view the document's state as it existed at that specific point in time.
- **Split-Screen View**: Simultaneously view the record list and the corresponding document state.
- **Keyboard Navigation**:
  - `Up`/`Down` or `j`/`k`: Navigate lists.
  - `Enter`: Select a document.
  - `Esc`: Go back to the document list.
  - `Shift+J`/`Shift+K` or `PgUp`/`PgDn`: Scroll the document state view.
  - `q`: Quit the application.

## Usage

Run the explorer from the project root or the explorer directory:

```bash
pnpm dev ../chat/loro-chat-app.db
```

## Development

To build and run the explorer during development:

```bash
cd examples/explorer
pnpm install
pnpm build
pnpm start
```

## How it Works

The explorer reads the raw key-value pairs from LevelDB. The keys are expected to follow the format used by `LevelDBStorageAdapter`: `[docId]::[type]::[timestamp]`.

1.  **Scanning**: It scans the database to identify unique Document IDs.
2.  **Reconstruction**: When a document is selected, it loads all associated records (updates and snapshots).
3.  **Visualization**: It uses `loro-crdt` to reconstruct the document state by applying updates sequentially up to the selected record, allowing you to see how the document evolved over time.