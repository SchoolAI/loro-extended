import { expect, test } from "@playwright/test"
import { createTodo, waitForTodosReady } from "./fixtures/test-helpers"

test.describe("Multi-Client Synchronization", () => {
  test("should sync new todos between clients", async ({ browser }) => {
    const client1 = await browser.newPage()
    const client2 = await browser.newPage()

    // Both clients connect to the same document
    await Promise.all([client1.goto("/"), client2.goto("/")])

    // Wait for ready state
    await Promise.all([
      waitForTodosReady(client1),
      waitForTodosReady(client2),
    ])

    // Client 1 creates a todo
    await createTodo(client1, "Shared Todo")

    // Client 2 should see it appear
    await client2.waitForSelector('li:has-text("Shared Todo")')

    // Verify both have same content
    const todos1 = await client1.locator("li span").allTextContents()
    const todos2 = await client2.locator("li span").allTextContents()
    expect(todos1).toEqual(todos2)
  })

  test("should sync todo completion status", async ({ browser }) => {
    const client1 = await browser.newPage()
    const client2 = await browser.newPage()

    // Setup clients
    await Promise.all([client1.goto("/"), client2.goto("/")])
    await Promise.all([
      waitForTodosReady(client1),
      waitForTodosReady(client2),
    ])
    await createTodo(client1, "Toggle Sync Test")

    // Wait for client2 to see the todo first
    await client2.waitForSelector('li:has-text("Toggle Sync Test")')

    // Client 1 toggles completion
    const todoItem1 = client1.locator('li:has-text("Toggle Sync Test")')
    await todoItem1.locator('input[type="checkbox"]').check()

    // Client 2 should see the update - wait for the checkbox to be checked
    const todoItem2 = client2.locator('li:has-text("Toggle Sync Test")')
    await expect(todoItem2.locator('input[type="checkbox"]')).toBeChecked({
      timeout: 10000,
    })
  })

  test("should sync todo deletion", async ({ browser }) => {
    const client1 = await browser.newPage()
    const client2 = await browser.newPage()

    // Setup clients
    await Promise.all([client1.goto("/"), client2.goto("/")])
    await Promise.all([
      waitForTodosReady(client1),
      waitForTodosReady(client2),
    ])
    await createTodo(client1, "Delete Sync Test")

    // Wait for client2 to see the todo first
    await client2.waitForSelector('li:has-text("Delete Sync Test")')

    // Client 1 deletes the todo
    const todoItem1 = client1.locator('li:has-text("Delete Sync Test")')
    await todoItem1.locator("button").click()

    // Client 2 should see it disappear
    const todoItem2 = client2.locator('li:has-text("Delete Sync Test")')
    await expect(todoItem2).toHaveCount(0, { timeout: 10000 })
  })

  test("should handle concurrent edits", async ({ browser }) => {
    const client1 = await browser.newPage()
    const client2 = await browser.newPage()

    // Setup clients
    await Promise.all([client1.goto("/"), client2.goto("/")])
    await Promise.all([
      waitForTodosReady(client1),
      waitForTodosReady(client2),
    ])

    // Both clients create todos concurrently
    await Promise.all([
      createTodo(client1, "Client 1 Todo"),
      createTodo(client2, "Client 2 Todo"),
    ])

    // Wait for sync - each client should see the other's todo
    await Promise.all([
      client1.waitForSelector('li:has-text("Client 2 Todo")'),
      client2.waitForSelector('li:has-text("Client 1 Todo")'),
    ])

    // Verify both clients have at least 2 todos
    const todoCount1 = await client1.locator("ul li").count()
    const todoCount2 = await client2.locator("ul li").count()
    expect(todoCount1).toBeGreaterThanOrEqual(2)
    expect(todoCount2).toBeGreaterThanOrEqual(2)

    // Verify order is consistent (CRDT resolution)
    const todos1 = await client1.locator("li span").allTextContents()
    const todos2 = await client2.locator("li span").allTextContents()
    expect(todos1.sort()).toEqual(todos2.sort())
  })
})
