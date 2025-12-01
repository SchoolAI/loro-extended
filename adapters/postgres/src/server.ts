import { Buffer } from "node:buffer"
import {
  type Chunk,
  StorageAdapter,
  type StorageKey,
} from "@loro-extended/repo"

const KEY_SEP = "::"

/**
 * Minimal interface for query execution - works with Pool, Client, or custom implementations
 */
export interface QueryInterface {
  query(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: Record<string, unknown>[] }>
}

/**
 * Options for creating a PostgresStorageAdapter
 */
export interface PostgresStorageAdapterOptions {
  /** PostgreSQL Pool or Client instance */
  client: QueryInterface

  /** Table name (default: 'loro_storage') */
  tableName?: string

  /** Column name for the key (default: 'key') */
  keyColumn?: string

  /** Column name for the data (default: 'data') */
  dataColumn?: string

  /** Auto-create table if not exists (default: true) */
  createTable?: boolean
}

/**
 * PostgreSQL storage adapter for @loro-extended/repo
 *
 * This adapter stores Loro document data in a PostgreSQL database.
 * It follows the same patterns as the LevelDB and IndexedDB adapters.
 *
 * @example
 * ```typescript
 * import { Pool } from 'pg'
 * import { PostgresStorageAdapter } from '@loro-extended/adapter-postgres/server'
 *
 * const pool = new Pool({ connectionString: 'postgres://...' })
 * const storage = new PostgresStorageAdapter({ client: pool })
 * ```
 */
export class PostgresStorageAdapter extends StorageAdapter {
  readonly #client: QueryInterface
  readonly #tableName: string
  readonly #keyColumn: string
  readonly #dataColumn: string
  readonly #createTable: boolean
  #initialized = false

  constructor(options: PostgresStorageAdapterOptions) {
    super({ adapterType: "postgres" })
    this.#client = options.client
    this.#tableName = options.tableName ?? "loro_storage"
    this.#keyColumn = options.keyColumn ?? "key"
    this.#dataColumn = options.dataColumn ?? "data"
    this.#createTable = options.createTable ?? true
  }

  /**
   * Ensure the table exists before any operation
   */
  private async ensureTable(): Promise<void> {
    if (this.#initialized || !this.#createTable) {
      return
    }

    await this.#client.query(`
      CREATE TABLE IF NOT EXISTS ${this.#tableName} (
        ${this.#keyColumn} TEXT PRIMARY KEY,
        ${this.#dataColumn} BYTEA NOT NULL
      )
    `)

    // Create index for efficient prefix matching (range queries)
    await this.#client.query(`
      CREATE INDEX IF NOT EXISTS ${this.#tableName}_key_prefix_idx 
        ON ${this.#tableName} (${this.#keyColumn} text_pattern_ops)
    `)

    this.#initialized = true
  }

  /**
   * Convert a StorageKey array to a string using :: separator
   */
  private keyToString(key: StorageKey): string {
    return key.join(KEY_SEP)
  }

  /**
   * Convert a string back to a StorageKey array
   */
  private stringToKey(str: string): StorageKey {
    return str.split(KEY_SEP)
  }

  /**
   * Load a binary blob for a given key
   */
  async load(key: StorageKey): Promise<Uint8Array | undefined> {
    await this.ensureTable()

    const result = await this.#client.query(
      `SELECT ${this.#dataColumn} FROM ${this.#tableName} WHERE ${this.#keyColumn} = $1`,
      [this.keyToString(key)],
    )

    if (result.rows.length === 0) {
      return undefined
    }

    const data = result.rows[0][this.#dataColumn] as Buffer | Uint8Array | null
    // pg returns BYTEA as Buffer in Node.js
    if (data === null || data === undefined) {
      return undefined
    }
    if (Buffer.isBuffer(data)) {
      return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
    }
    if (data instanceof Uint8Array) {
      return data
    }
    return undefined
  }

  /**
   * Save a binary blob to a given key (upsert)
   */
  async save(key: StorageKey, data: Uint8Array): Promise<void> {
    await this.ensureTable()

    await this.#client.query(
      `INSERT INTO ${this.#tableName} (${this.#keyColumn}, ${this.#dataColumn})
       VALUES ($1, $2)
       ON CONFLICT (${this.#keyColumn}) DO UPDATE SET ${this.#dataColumn} = $2`,
      [this.keyToString(key), Buffer.from(data)],
    )
  }

  /**
   * Remove a binary blob from a given key
   */
  async remove(key: StorageKey): Promise<void> {
    await this.ensureTable()

    await this.#client.query(
      `DELETE FROM ${this.#tableName} WHERE ${this.#keyColumn} = $1`,
      [this.keyToString(key)],
    )
  }

  /**
   * Load all chunks whose keys begin with the given prefix
   */
  async loadRange(keyPrefix: StorageKey): Promise<Chunk[]> {
    await this.ensureTable()

    const prefix = this.keyToString(keyPrefix)

    // For empty prefix, load all; otherwise use LIKE for prefix matching
    const query =
      prefix === ""
        ? `SELECT ${this.#keyColumn}, ${this.#dataColumn} FROM ${this.#tableName}`
        : `SELECT ${this.#keyColumn}, ${this.#dataColumn} FROM ${this.#tableName} WHERE ${this.#keyColumn} LIKE $1`

    const result =
      prefix === ""
        ? await this.#client.query(query)
        : await this.#client.query(query, [`${prefix}${KEY_SEP}%`])

    return result.rows.map(row => {
      const keyStr = row[this.#keyColumn] as string
      const data = row[this.#dataColumn] as Buffer | Uint8Array | null

      let dataArray: Uint8Array
      if (Buffer.isBuffer(data)) {
        dataArray = new Uint8Array(
          data.buffer,
          data.byteOffset,
          data.byteLength,
        )
      } else if (data instanceof Uint8Array) {
        dataArray = data
      } else {
        dataArray = new Uint8Array(0)
      }

      return {
        key: this.stringToKey(keyStr),
        data: dataArray,
      }
    })
  }

  /**
   * Remove all chunks whose keys begin with the given prefix
   */
  async removeRange(keyPrefix: StorageKey): Promise<void> {
    await this.ensureTable()

    const prefix = this.keyToString(keyPrefix)

    // For empty prefix, delete all; otherwise use LIKE for prefix matching
    if (prefix === "") {
      await this.#client.query(`DELETE FROM ${this.#tableName}`)
    } else {
      await this.#client.query(
        `DELETE FROM ${this.#tableName} WHERE ${this.#keyColumn} LIKE $1`,
        [`${prefix}${KEY_SEP}%`],
      )
    }
  }
}
