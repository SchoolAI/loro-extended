import { PostgresStorageAdapter } from "@loro-extended/adapter-postgres/server"
import { change, Repo, Shape } from "@loro-extended/repo"
import { Pool } from "pg"

// Define the document schema
const DocSchema = Shape.doc({
  root: Shape.struct({
    message: Shape.plain.string(),
    timestamp: Shape.plain.number(),
    updated: Shape.plain.boolean(),
    updateTime: Shape.plain.number(),
  }),
})

async function main() {
  console.log("🐘 PostgreSQL Storage Adapter Example\n")

  // Connect to PostgreSQL
  const pool = new Pool({
    connectionString: "postgres://loro:loro@localhost:5432/loro_example",
  })

  console.log("📦 Creating storage adapter...")
  const storage = new PostgresStorageAdapter({ client: pool })

  console.log("🔧 Creating repo with storage...")
  const repo = new Repo({
    identity: {
      peerId: "server-1" as `${number}`,
      name: "server",
      type: "user",
    },
    adapters: [storage],
  })

  // Create and modify a document
  console.log("\n📝 Creating document...")
  const handle = repo.getHandle("my-doc", DocSchema)
  change(handle.doc, doc => {
    doc.root.message = "Hello from PostgreSQL!"
    doc.root.timestamp = Date.now()
  })

  console.log("✅ Document created:", handle.docId)
  console.log("📄 Content:", JSON.stringify(handle.doc.toJSON(), null, 2))

  // Wait for storage to persist
  console.log("\n⏳ Waiting for storage to persist...")
  await new Promise(resolve => setTimeout(resolve, 200))

  // Query the database directly to see stored data
  console.log("\n🔍 Querying database directly...")
  const result = await pool.query(
    "SELECT key, length(data) as size FROM loro_storage",
  )
  console.log("📊 Stored chunks:")
  for (const row of result.rows) {
    console.log(`   - ${row.key}: ${row.size} bytes`)
  }

  // Make another change
  console.log("\n📝 Making another change...")
  change(handle.doc, doc => {
    doc.root.updated = true
    doc.root.updateTime = Date.now()
  })

  console.log(
    "📄 Updated content:",
    JSON.stringify(handle.doc.toJSON(), null, 2),
  )

  // Wait for storage to persist
  await new Promise(resolve => setTimeout(resolve, 200))

  // Query again to see new chunks
  console.log("\n🔍 Querying database again...")
  const result2 = await pool.query(
    "SELECT key, length(data) as size FROM loro_storage ORDER BY key",
  )
  console.log("📊 All stored chunks:")
  for (const row of result2.rows) {
    console.log(`   - ${row.key}: ${row.size} bytes`)
  }

  // Clean up
  console.log("\n🧹 Cleaning up...")
  await pool.end()
  console.log("✅ Done!")
}

main().catch(error => {
  console.error("❌ Error:", error)
  process.exit(1)
})
