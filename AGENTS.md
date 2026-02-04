- To run all verifications including tests, use `pnpm turbo run verify`.
- Builds are cached by Turborepo. Only packages with changed source code (or dependencies) will rebuild. To force a full rebuild, use `pnpm build:all`.
- Running `pnpm turbo run verify` or `pnpm turbo run verify --filter=<pkg>` automatically builds workspace dependencies first.
- This is a monorepo. You can run commands inside a package via `pnpm turbo run <command> --filter=@loro-extended/[package-name]`. Example: `pnpm turbo run verify --filter=@loro-extended/change`
- To run a specific verification such as format, types, or tests specify the subset:

```bash
pnpm turbo run verify --filter=@loro-extended/change -- format
pnpm turbo run verify --filter=@loro-extended/repo -- logic
pnpm turbo run verify --filter=@loro-extended/repo -- logic -- -t 'specific test'
pnpm turbo run verify --filter=@loro-extended/adapter-websocket -- types
```

- For exploratory debugging, create a .test.ts file rather than a .js or .mjs file, as it will integrate with typescript.
- When fixing a bug, it's important to write a test that replicates the problem, and that you run the test to prove it fails. Then fix the bug, run the test, and prove it works.
