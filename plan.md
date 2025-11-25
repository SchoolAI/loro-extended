# Plan: Add Linting with Biome

The goal is to add a `lint` script to the monorepo that uses Biome to lint and fix issues.

## Todo List

- [ ] Add `lint` script to root `package.json`
    - `lint`: `biome check --write .`
- [ ] Add `lint` script to `packages/repo/package.json`
    - `lint`: `biome check --write .`
- [ ] Add `lint` script to `packages/adapters/package.json`
    - `lint`: `biome check --write .`
- [ ] Add `lint` script to `packages/change/package.json`
    - `lint`: `biome check --write .`
- [ ] Add `lint` script to `packages/react/package.json`
    - `lint`: `biome check --write .`
- [ ] Add `lint` script to `examples/todo-app/package.json`
    - `lint`: `biome check --write .`
- [ ] Run `pnpm lint` from the root to verify and fix existing issues.

## Notes

- `biome check --write` runs the formatter, linter, and import sorter, and applies safe fixes.
- Running it from the root with `.` will check all files in the project, respecting `.gitignore` and `biome.json` ignore settings.
- Adding scripts to individual packages allows developers to lint specific packages if desired.