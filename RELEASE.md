# Releasing @loro-extended

This is a handy guide I made to help me recall the steps I need to take to update all @loro-extended packages for relase to npmjs.com.

## Step-by-Step Process

### 1. Create a Changeset (Minor Bump)

Run the interactive changeset command each time you make a commit worthy of note:

```bash
pnpm changeset
```

This will prompt you to:

1. **Select packages** - Use arrow keys and spacebar to select which packages to include (your project has `@loro-extended/adapters`, `@loro-extended/change`, `@loro-extended/react`, `@loro-extended/repo` in a "fixed" group, meaning they'll all be versioned together)
2. **Select bump type** - Choose `minor` for a minor version bump (e.g., 1.0.0 → 1.1.0)
3. **Write a summary** - Describe what changed (this becomes the changelog entry)

This creates a markdown file in [`.changeset/`](.changeset/) with a random name like `fuzzy-lions-dance.md`.

### 2. Version the Packages

When you're ready to release, run:

```bash
pnpm changeset version
```

This will:

- Consume all pending changeset files in `.changeset/`
- Update `package.json` versions for affected packages
- Update `CHANGELOG.md` files with your summaries

### 3. Build and Publish

```bash
pnpm build                    # Build all packages
pnpm changeset publish        # Publish to npm
```

The `publish` command will publish all packages with updated versions to npmjs.com.

## Complete Workflow Example

```bash
# 1. Create changeset for minor bump
pnpm changeset
# → Select packages, choose "minor", write summary

# 2. Commit the changeset file
git add .changeset/
git commit -m "chore: add changeset for feature X"

# 3. When ready to release, version packages
pnpm changeset version

# 4. Commit version bumps
git add .
git commit -m "chore: version packages"

# 5. Build and publish
pnpm build
pnpm changeset publish

# 6. Push tags and commits
git push --follow-tags
```

## Prerequisites for Publishing

Before publishing, ensure you're authenticated with npm:

```bash
npm login
# or
npm whoami  # to check if already logged in
```
