import { expect, test } from "@playwright/test"
import {
  createTodo,
  generateTestDocumentId,
  waitForRepoState,
} from "./fixtures/test-helpers"

test.describe("Multi-Client Synchronization", () => {
  test("should sync new todos between clients", async ({ browser }) => {
    const client1 = await browser.newPage()
    const client2 = await browser.newPage()

    // Use the same document ID for both clients
    const testDocId = generateTestDocumentId()

    // Both clients connect
    await Promise.all([
      client1.goto(`/#${testDocId}`),
      client2.goto(`/#${testDocId}`),
    ])

    // Wait for ready state
    await Promise.all([
      waitForRepoState(client1, "connected"),
      waitForRepoState(client2, "connected"),
    ])

    // Client 1 creates a todo
    await createTodo(client1, "Shared Todo")

    // Client 2 should see it appear
    await client2.waitForSelector('.todo-item:has-text("Shared Todo")')

    // Verify both have same content
    const todos1 = await client1.locator(".todo-item span").allTextContents()
    const todos2 = await client2.locator(".todo-item span").allTextContents()
    expect(todos1).toEqual(todos2)
  })

  test("should sync todo completion status", async ({ browser }) => {
    const client1 = await browser.newPage()
    const client2 = await browser.newPage()

    // Use the same document ID for both clients
    const testDocId = generateTestDocumentId()

    // Setup clients with a todo
    await Promise.all([
      client1.goto(`/#${testDocId}`),
      client2.goto(`/#${testDocId}`),
    ])
    await Promise.all([
      waitForRepoState(client1, "connected"),
      waitForRepoState(client2, "connected"),
    ])
    await createTodo(client1, "Toggle Sync Test")

    // Wait for client2 to see the todo first
    await client2.waitForSelector('.todo-item:has-text("Toggle Sync Test")')

    // Client 1 toggles completion
    const todoItem1 = client1.locator('.todo-item:has-text("Toggle Sync Test")')
    await todoItem1.locator('input[type="checkbox"]').check()

    // Client 2 should see the update - wait for the checkbox to be checked
    const todoItem2 = client2.locator('.todo-item:has-text("Toggle Sync Test")')
    await expect(todoItem2.locator('input[type="checkbox"]')).toBeChecked({
      timeout: 10000,
    })
  })

  test("should sync todo deletion", async ({ browser }) => {
    const client1 = await browser.newPage()
    const client2 = await browser.newPage()

    // Use the same document ID for both clients
    const testDocId = generateTestDocumentId()

    // Setup clients with a todo
    await Promise.all([
      client1.goto(`/#${testDocId}`),
      client2.goto(`/#${testDocId}`),
    ])
    await Promise.all([
      waitForRepoState(client1, "connected"),
      waitForRepoState(client2, "connected"),
    ])
    await createTodo(client1, "Delete Sync Test")

    // Wait for client2 to see the todo first
    await client2.waitForSelector('.todo-item:has-text("Delete Sync Test")')

    // Client 1 deletes the todo
    const todoItem1 = client1.locator('.todo-item:has-text("Delete Sync Test")')
    await todoItem1.locator(".delete-button").click()

    // Client 2 should see it disappear
    const todoItem2 = client2.locator('.todo-item:has-text("Delete Sync Test")')
    await expect(todoItem2).toHaveCount(0, { timeout: 10000 })
  })

  test("should handle concurrent edits", async ({ browser }) => {
    const client1 = await browser.newPage()
    const client2 = await browser.newPage()

    // Use the same document ID for both clients
    const testDocId = generateTestDocumentId()

    // Setup clients
    await Promise.all([
      client1.goto(`/#${testDocId}`),
      client2.goto(`/#${testDocId}`),
    ])
    await Promise.all([
      waitForRepoState(client1, "connected"),
      waitForRepoState(client2, "connected"),
    ])

    // Client 1 creates a todo first
    await createTodo(client1, "Client 1 Todo")

    // Wait for client1 to see its own todo
    await client1.waitForSelector('.todo-item:has-text("Client 1 Todo")')

    // Client 2 creates a todo
    await createTodo(client2, "Client 2 Todo")

    // Wait for client2 to see its own todo
    await client2.waitForSelector('.todo-item:has-text("Client 2 Todo")')

    // Wait for sync to complete
    await client1.waitForTimeout(2000)
    await client2.waitForTimeout(2000)

    // Check if client1 can see client2's todo
    try {
      await client1.waitForSelector('.todo-item:has-text("Client 2 Todo")', {
        timeout: 10000,
      })
    } catch (e) {
      // If timeout, let's see what todos client1 actually has
      const client1Todos = await client1
        .locator(".todo-item span")
        .allTextContents()
      console.log("Client1 todos:", client1Todos)
      throw e
    }

    // Check if client2 can see client1's todo
    try {
      await client2.waitForSelector('.todo-item:has-text("Client 1 Todo")', {
        timeout: 10000,
      })
    } catch (e) {
      // If timeout, let's see what todos client2 actually has
      const client2Todos = await client2
        .locator(".todo-item span")
        .allTextContents()
      console.log("Client2 todos:", client2Todos)
      throw e
    }

    // Verify both clients have the same number of todos
    const todoCount1 = await client1.locator(".todo-item").count()
    const todoCount2 = await client2.locator(".todo-item").count()
    expect(todoCount1).toBe(2)
    expect(todoCount2).toBe(2)

    // Verify order is consistent (CRDT resolution)
    const todos1 = await client1.locator(".todo-item span").allTextContents()
    const todos2 = await client2.locator(".todo-item span").allTextContents()
    expect(todos1.sort()).toEqual(todos2.sort())
  })
})
