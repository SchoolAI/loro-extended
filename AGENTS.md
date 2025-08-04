1. To run all tests, use `pnpm test`
2. To run a subset of tests specify the package and optionally the .test.ts file:
```bash
pnpm --filter @loro-extended/change -- test run
pnpm --filter @loro-extended/repo -- test run src/e2e.test.ts
```
