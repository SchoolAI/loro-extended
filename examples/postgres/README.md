# PostgreSQL Storage Example

This example demonstrates how to use the `@loro-extended/adapter-postgres` storage adapter with `@loro-extended/repo`.

## Prerequisites

- Docker and Docker Compose (for running PostgreSQL)
- Node.js 18+
- pnpm

## Setup

1. Start PostgreSQL:

```bash
pnpm db:up
```

This starts a PostgreSQL container with:
- User: `loro`
- Password: `loro`
- Database: `loro_example`
- Port: `5432`

2. Install dependencies:

```bash
pnpm install
```

3. Run the example:

```bash
pnpm start
```

## What the Example Does

1. Creates a PostgreSQL connection pool
2. Creates a `PostgresStorageAdapter` with the pool
3. Creates a `Repo` with the storage adapter
4. Creates a document and makes changes
5. Queries the database directly to show stored chunks
6. Makes additional changes and shows how chunks accumulate

## Expected Output

```
🐘 PostgreSQL Storage Adapter Example

📦 Creating storage adapter...
🔧 Creating repo with storage...

📝 Creating document...
✅ Document created: my-doc
📄 Content: {
  "root": {
    "message": "Hello from PostgreSQL!",
    "timestamp": 1234567890123
  }
}

⏳ Waiting for storage to persist...

🔍 Querying database directly...
📊 Stored chunks:
   - my-doc::update::1234567890123-0000: 42 bytes

📝 Making another change...
📄 Updated content: {
  "root": {
    "message": "Hello from PostgreSQL!",
    "timestamp": 1234567890123,
    "updated": true,
    "updateTime": 1234567890456
  }
}

🔍 Querying database again...
📊 All stored chunks:
   - my-doc::update::1234567890123-0000: 42 bytes
   - my-doc::update::1234567890456-0000: 28 bytes

🧹 Cleaning up...
✅ Done!
```

## Cleanup

To stop and remove the PostgreSQL container:

```bash
pnpm db:down
```

To also remove the data volume:

```bash
docker-compose down -v