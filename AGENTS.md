1. To run all verifications including tests, use `pnpm verify`
2. This is a monorepo. You can run commands inside a package via `pnpm --filter @loro-extended/[package-name]`. Example: `pnpm --filter @loro-extended/change -- verify`
3. To run a specific verification such as format, types, or tests specify the subset:

```bash
pnpm --filter @loro-extended/change -- verify format
pnpm --filter @loro-extended/repo -- verify test
pnpm --filter @loro-extended/adapter-websocket -- verify types
```

4. For exploratory debugging, create a .test.ts file rather than a .js or .mjs file, as it will integrate with typescript.
5. When fixing a bug, it's important to write a test that replicates the problem, and that you run the test to prove it fails. Then fix the bug, run the test, and prove it works.
6. Instead of deleting markdown files used for planning, assessing, todos, etc. stash them. For example, instead of `rm packages/repo/src/binary-serialization-fix.md`, use `git add packages/repo/src/binary-serialization-fix.md && git stash push -m "binary-serialization-fix plan" packages/repo/src/binary-serialization-fix.md`.
