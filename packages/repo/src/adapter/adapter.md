# What is an Adapter?

An adapter for `@loro-extended/repo` provides the Repo class with access to storage (e.g. postgres, leveldb, redis, files) and network (e.g. POST/SSE, WebSockets, WebRTC, etc.). The Adapter's job is to implement init/deinit, and generate channels as needed in order to send/receive Loro-compatible updates to LoroDoc. Each Adapter implementation is specific to the storage or network layer it is "adapting" to.

# When is an Adapter ready?

There is a coordination issue that takes place when a Repo is initialized. All Adapters must be created before a Repo initializes:

```ts
const bridge = new Bridge();

const repoA = new Repo({
  adapters: [new InlineNetworkAdapter(bridge, "a")],
});

const repoB = new Repo({
  adapters: [new InlineNetworkAdapter(bridge, "b")],
});
```

Many adapters need to listen for a connection (like InlineNetworkAdapter). 