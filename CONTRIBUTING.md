# Contributing to Photoshop MCP

Thank you for your interest in contributing! This is a community-maintained project and is not affiliated with or endorsed by Adobe Inc.

> **Fork notice:** this checkout is the independent digital-painting fork at
> `lavalava45/photoshop-mcp-digital-painting`. The original project is
> `alisaitteke/photoshop-mcp`. Do not publish fork builds under the upstream npm scope
> `@alisaitteke`, the upstream MCP Registry id, or the upstream website/domain.

## Language policy

This project uses **English** as its canonical language for all project artifacts:

- **Pull request titles, descriptions, and commit messages** must be written in English.
- **Source code, comments, and user-facing UI strings** must be written in English.
- **Documentation** (README, guides, inline docs) must be written in English.

Issues and review comments may be written in any language, but English is preferred so maintainers and future contributors can search and reference them easily.

## Before you start

1. Search [fork issues](https://github.com/lavalava45/photoshop-mcp-digital-painting/issues) and [pull requests](https://github.com/lavalava45/photoshop-mcp-digital-painting/pulls) to avoid duplicate work. Check upstream separately when the issue may originate there.
2. For large or architectural changes, open an issue first to discuss the approach.
3. For bug fixes and small improvements, a PR without a prior issue is fine.

## Development setup

### Prerequisites

- **Node.js** ≥ 18
- **npm**
- **Adobe Photoshop** installed and scriptable (required only for integration tests)

### Getting started

```bash
git clone https://github.com/lavalava45/photoshop-mcp-digital-painting.git
cd photoshop-mcp-digital-painting
npm install
npm run build
```

### UI development

The standalone web UI runs a Hono backend and a Vite + Vue frontend:

```bash
npm run dev:ui
```

This starts the server on port 5174 (with hot reload) and the web dev server concurrently.

## Distribution and releases

This fork is source-distributed from
[lavalava45/photoshop-mcp-digital-painting](https://github.com/lavalava45/photoshop-mcp-digital-painting)
and is normally used through a local stdio build. It currently has **no fork npm
package, no fork MCP Registry entry, and no fork directory-listing release flow**.

The repository intentionally does not contain GitHub Actions that publish to npm,
the MCP Registry, Smithery, Glama, or other third-party catalogs. Do not add
credentials or publishing commands for upstream identifiers to this fork.

For a source release of the fork:

1. Run the validation suite documented below.
2. Update the fork's changelog/version metadata if a tagged GitHub source release is desired.
3. Keep `server.json`, `mcpb/manifest.json`, package metadata, links, and release notes
   under the fork's own `lavalava45/photoshop-mcp-digital-painting` identity.
4. Create/push a Git tag or GitHub Release only under this repository. No external
   registry publication is implied by a GitHub tag.

The original project's release and registry procedures belong to
[alisaitteke/photoshop-mcp](https://github.com/alisaitteke/photoshop-mcp). Consult
that repository when auditing upstream changes; do not copy its distribution
credentials or identifiers into this fork.

## Project layout

| Path | Purpose |
| --- | --- |
| `src/` | MCP server core, tools, recipes, and UI backend |
| `web/` | Vue 3 standalone UI (Tailwind v4, shadcn-vue) |
| `scripts/` | Integration and verification test scripts |
| `docs/` | Additional project documentation |

See [`docs/architecture.md`](docs/architecture.md) for a detailed breakdown.

## Making changes

1. Branch from `master`.
2. Keep diffs focused — avoid unrelated refactors in the same PR.
3. Follow existing patterns:
   - Provider adapters in `src/ui/providers/`
   - MCP tools in `src/tools/`
   - Recipe tools in `src/tools/recipes/`
   - Prompt templates in `src/prompts/templates/`

## Code style

- **TypeScript** with strict mode enabled (`tsconfig.json`).
- **ESLint:** `npm run lint`
- **Prettier:** `npm run format:check` (check) or `npm run format` (auto-fix)

Match the style of surrounding code. Prefer extending existing abstractions over introducing parallel patterns.

## Testing

Tests are tiered by whether Photoshop must be running:

### Required (no Photoshop needed)

```bash
npm run verify:canonical
```

Run this before every PR. It performs a clean server build, verifies the package surface,
runs lint and the complete source Vitest acceptance inventory, checks acceptance-matrix
test references for drift, and runs the compact-v2, painting-policy, prompt and tool-count
verifiers.

`npm run format:check` is currently **advisory/non-gating** while the inherited repository
format baseline is being normalized. Do not treat a repository-wide Prettier failure as a
canonical verification failure unless formatting is explicitly promoted into
`verify:canonical`.

### Recommended (Photoshop must be running)

```bash
npm run test:mcp-local    # prompt-layer smoke tests
npm run spike:issue-2     # issue #2 targeted regression
npm run test:mcp-all      # full sequential tool sweep
```

Integration tests communicate with a live Photoshop instance over stdio — the same path used by Cursor and Claude Desktop. Note which tests you ran in your PR description.

## Pull request checklist

- [ ] PR title, description, and commit messages are in **English**
- [ ] Code comments and user-facing strings are in **English**
- [ ] `npm run verify:canonical` passes
- [ ] Integration tests run (if applicable — requires Photoshop)
- [ ] Screenshots attached for UI changes

A [pull request template](.github/pull_request_template.md) is provided automatically when you open a PR on GitHub.

## Reporting bugs

Open a [fork GitHub Issue](https://github.com/lavalava45/photoshop-mcp-digital-painting/issues) and include:

- Operating system (Windows / macOS) and version
- Photoshop version
- Node.js version
- Steps to reproduce
- Expected vs. actual behavior
- Relevant log output (`LOG_LEVEL=0` for debug)

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
