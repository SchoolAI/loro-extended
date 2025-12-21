# Plan: Refactor Chat Example with Loro Extended Best Practices

This plan outlines the steps to refactor the `examples/chat` application to utilize `loro-extended` best practices, specifically focusing on the "targetMessage" pattern for efficient streaming, type safety, and improved subscription handling.

## Goals
1.  **Efficiency**: Optimize LLM streaming by using direct mutable references (`targetMessage`) instead of repeated lookups.
2.  **Type Safety**: Remove `any` casts and use inferred types from schemas.
3.  **Clarity**: Use `TypedDocHandle` to simplify document and presence management.
4.  **Performance**: Use path-based subscriptions to reduce unnecessary re-renders and processing.

## Phase 1: Shared Types & Schema
Update shared types to derive TypeScript interfaces directly from Loro schemas.

- [x] **Update `examples/chat/src/shared/types.ts`**
    - Import `Infer` and `InferMutableType` from `@loro-extended/change`.
    - Remove manual `type Message = ...` definition.
    - Export derived types:
        ```typescript
        export type Message = Infer<typeof MessageSchema>
        export type MutableMessage = InferMutableType<typeof MessageSchema>
        export type ChatDoc = Infer<typeof ChatSchema>
        export type MutableChatDoc = InferMutableType<typeof ChatSchema>
        ```

## Phase 2: Server Refactoring
Refactor the server to use `TypedDocHandle` and the efficient streaming pattern.

- [x] **Update `examples/chat/src/server/server.ts`**
    - **Step 2.1: Adopt `TypedDocHandle`**
        - Import `TypedDocHandle` from `@loro-extended/repo`.
        - Replace `getChatDoc` helper with direct `new TypedDocHandle(...)` usage.
        - Update `subscribeToDocument` to use the new handle.

    - **Step 2.2: Refactor `appendAssistantMessage`**
        - Change return type from `string` (ID) to `MutableMessage`.
        - Implementation:
            ```typescript
            function appendAssistantMessage(handle: TypedDocHandle<typeof ChatSchema, typeof PresenceSchema>): MutableMessage {
              return handle.change(draft => {
                const message = { ... } // create message
                draft.messages.push(message)
                return draft.messages.get(draft.messages.length - 1) // Return mutable reference
              })
            }
            ```

    - **Step 2.3: Refactor `streamLLMResponse`**
        - Change signature to accept `targetMessage: MutableMessage` instead of `doc` and `id`.
        - Remove the `find` logic inside the loop.
        - Stream directly into `targetMessage.content`.
        - Remove `any` casts.

    - **Step 2.4: Optimize Subscriptions**
        - In `subscribeToDocument`, replace `handle.doc.subscribe()` with a path-based subscription:
            ```typescript
            handle.subscribe(
              p => p.messages,
              (messages) => {
                // Logic to check if last message needs reply
                processDocumentUpdate(docId, handle, messages)
              }
            )
            ```
        - Ensure `processDocumentUpdate` uses the passed `messages` array (or accesses it via handle) and handles the logic correctly without `any`.

## Phase 3: Client Updates
Ensure the client code aligns with the new shared types.

- [x] **Update `examples/chat/src/client/chat-app.tsx`**
    - Update imports to use the new `Message` type from `shared/types`.
    - Verify `sendMessage` and other functions work with the inferred types.
    - (Optional) Review `useDoc` usage to ensure it picks up the generic types correctly.

## Verification
- [ ] Run the chat server (`pnpm start` in `examples/chat` or equivalent).
- [ ] Run the chat client.
- [ ] Verify that messages are sent and received.
- [ ] Verify that AI responses stream correctly.
- [ ] Check server logs to ensure no errors during streaming.
