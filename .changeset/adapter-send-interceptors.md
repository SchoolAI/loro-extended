---
"@loro-extended/repo": minor
---

Add send interceptor pattern to Adapter base class

Adapters now support a middleware-style interceptor chain for outgoing messages. This enables:
- Simulating network conditions (delay, packet loss)
- Debugging message flow
- Testing message sequences

```typescript
// Delay all messages by 3 seconds
const unsubscribe = adapter.addSendInterceptor((ctx, next) => {
  setTimeout(next, 3000)
})

// Drop 10% of messages
adapter.addSendInterceptor((ctx, next) => {
  if (Math.random() > 0.1) next()
})

// Log all messages
adapter.addSendInterceptor((ctx, next) => {
  console.log('Sending:', ctx.envelope.message.type)
  next()
})

// Remove interceptor
unsubscribe()

// Clear all interceptors
adapter.clearSendInterceptors()
```
