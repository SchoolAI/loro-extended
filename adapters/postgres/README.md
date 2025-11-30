# @loro-extended/adapter-postgres

PostgreSQL storage adapter for `@loro-extended/repo`.

## Installation

```bash
npm install @loro-extended/adapter-postgres pg
# or
pnpm add @loro-extended/adapter-postgres pg
```

## Usage

### Basic Usage

```typescript
import { Pool } from 'pg'
import { Repo } from '@loro-extended/repo'
import { PostgresStorageAdapter } from '@loro-extended/adapter-postgres/server'

// Create a PostgreSQL connection pool
const pool = new Pool({
  connectionString: 'postgres://user:password@localhost:5432/database'
})

// Create the storage adapter
const storage = new PostgresStorageAdapter({ client: pool })

// Create a repo with the storage adapter
const repo = new Repo({
  peerId: 'server-1',
  storage,
})

// Create and modify documents
const handle = repo.create('my-doc')
handle.change(doc => {
  doc.getMap('root').set('message', 'Hello from PostgreSQL!')
})
```

### Custom Table and Column Names

If you need to integrate with an existing database schema:

```typescript
const storage = new PostgresStorageAdapter({
  client: pool,
  tableName: 'my_loro_data',
  keyColumn: 'storage_key',
  dataColumn: 'blob',
})
```

### Disable Auto-Create Table

For production environments where you manage schema migrations separately:

```typescript
const storage = new PostgresStorageAdapter({
  client: pool,
  createTable: false,
})
```

You'll need to create the table manually:

```sql
CREATE TABLE IF NOT EXISTS loro_storage (
  key TEXT PRIMARY KEY,
  data BYTEA NOT NULL
);

-- Index for efficient prefix matching (range queries)
CREATE INDEX IF NOT EXISTS loro_storage_key_prefix_idx 
  ON loro_storage (key text_pattern_ops);
```

## API

### `PostgresStorageAdapter`

#### Constructor Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `client` | `Pool \| Client \| QueryInterface` | (required) | PostgreSQL connection |
| `tableName` | `string` | `'loro_storage'` | Table name for storage |
| `keyColumn` | `string` | `'key'` | Column name for keys |
| `dataColumn` | `string` | `'data'` | Column name for binary data |
| `createTable` | `boolean` | `true` | Auto-create table if not exists |
| `adapterId` | `string` | `'postgres'` | Adapter ID for logging |

#### QueryInterface

The adapter accepts any object that implements the `QueryInterface`:

```typescript
interface QueryInterface {
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>
}
```

This works with:
- `pg.Pool` - Connection pool (recommended)
- `pg.Client` - Single connection
- Custom implementations (e.g., for connection pooling libraries)

## Table Schema

The default table schema:

```sql
CREATE TABLE loro_storage (
  key TEXT PRIMARY KEY,
  data BYTEA NOT NULL
);

CREATE INDEX loro_storage_key_prefix_idx 
  ON loro_storage (key text_pattern_ops);
```

### Key Format

Keys are stored as text using `::` as a separator:

```
docId::update::1234567890-0001
```

This format supports efficient prefix queries using PostgreSQL's `LIKE` operator with the `text_pattern_ops` index.

## License

MIT