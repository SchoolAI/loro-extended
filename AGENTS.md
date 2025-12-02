1. To run all tests, use `pnpm test`
2. To run a subset of tests specify the package and optionally the .test.ts file:
```bash
pnpm --filter @loro-extended/change -- test run
pnpm --filter @loro-extended/repo -- test run src/e2e.test.ts
pnpm --filter @loro-extended/adapter-websocket test run
```
3. For exploratory debugging, create a .test.ts file rather than a .js or .mjs file, as it will integrate with typescript.
4. When fixing a bug, it's important to write a test that replicates the problem, and that you run the test to prove it fails. Then fix the bug, run the test, and prove it works.