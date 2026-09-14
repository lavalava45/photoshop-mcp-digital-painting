# AGENTS.md — Photoshop MCP Digital Painting Fork

> **Navigation map, not a reference manual.**
> Start with [README.md](README.md), [INSTALL.md](INSTALL.md), or [llms.txt](llms.txt).
>
> **Fork notice:** this repository is the independent community fork
> [lavalava45/photoshop-mcp-digital-painting](https://github.com/lavalava45/photoshop-mcp-digital-painting),
> based on the original [alisaitteke/photoshop-mcp](https://github.com/alisaitteke/photoshop-mcp).
> `photoshop-mcp.com`, `@alisaitteke/photoshop-mcp`, and `io.github.alisaitteke/photoshop-mcp`
> belong to the upstream project and do **not** distribute the fork-specific painting extensions.

## Entry strategy

| Scenario | Path |
| -------- | ---- |
| Cursor / Claude Desktop / VS Code | Clone this fork, build it, and configure stdio to `node <fork>/dist/index.js` |
| Claude Code | Add a local stdio server pointing to this fork's built `dist/index.js` |
| Chat On Steroids | Core → direct stdio → this fork's `dist/index.js` |
| Local development | `npm install && npm run build:server && node dist/index.js` — see [docs/development.md](docs/development.md) |

**Prerequisites:** Photoshop running on Windows or macOS, Node.js 18+. This is unofficial and not affiliated with Adobe.

**Tool surface:** 131 MCP tools — 115 atomic/non-recipe `photoshop_*` + 16 recipe `photoshop_recipe_*`; 24 MCP prompt templates (`ps.*`).

## Architecture (agent view)

```
AI host (Cursor / Claude / UI)
  │  MCP stdio
  ▼
PhotoshopMCPServer (Node.js)
  │  ExtendScript via AppleScript (macOS) or COM (Windows)
  ▼
Adobe Photoshop

Optional: UXP bridge plugin (uxp-plugin/) on 127.0.0.1:38452 for Neural Filters only.
```

Deep dive: [docs/architecture.md](docs/architecture.md).

## Recommended workflow

Follow the server `instructions` advertised on MCP `initialize` ([src/prompts/instructions.ts](src/prompts/instructions.ts)):

```
1. DISCOVER: tools/list + prompts/list (or get_capabilities once per session)
2. STATE:    photoshop_get_state before mutating; photoshop_get_preview after major steps
3. ACT:      prefer photoshop_recipe_* for multi-step outcomes (single undo step)
4. RECOVER:  on error, read structured envelope (code, suggested_next_tool) → get_state → retry one step
```

### Tool selection

| Need | Use |
| ---- | --- |
| Multi-step outcome (remove BG, export for web, portrait enhance) | `photoshop_recipe_*` |
| Single precise edit | atomic `photoshop_*` |
| Vague user intent | MCP prompt `prompts/get` (e.g. `ps.remove_background`) then call linked recipe/tool |
| Generative AI (Fill, Remove, Expand) | `photoshop_generative_*` — requires Adobe account + credits |
| Neural Filters (skin smooth, colorize, …) | `photoshop_neural_filter` — requires UXP bridge loaded |
| Version / feature check | `photoshop_get_capabilities` |

Full catalog: [docs/available-tools.md](docs/available-tools.md). Prompt layer: [docs/prompt-layer.md](docs/prompt-layer.md).

## MCP client configuration

```json
{
  "mcpServers": {
    "photoshop": {
      "command": "node",
      "args": ["/absolute/path/to/photoshop-mcp-digital-painting/dist/index.js"],
      "env": { "LOG_LEVEL": "1" }
    }
  }
}
```

Examples: [examples/cursor-config.json](examples/cursor-config.json), [examples/claude-desktop-config.json](examples/claude-desktop-config.json).

### Environment variables

| Variable | Purpose |
| -------- | ------- |
| `LOG_LEVEL` | `0`=DEBUG, `1`=INFO, `2`=WARN, `3`=ERROR |
| `PHOTOSHOP_PATH` | Optional custom Photoshop install path |
| `PSMCP_UI_TOKEN` | Pin standalone UI API token (see README) |

## Troubleshooting (common agent blockers)

| Symptom | Fix |
| ------- | --- |
| Photoshop not found | Start Photoshop; set `PHOTOSHOP_PATH` if non-standard install |
| Tool times out | Large operations may need retries; check `get_state` for partial progress |
| `generative_unavailable` / `version_unsupported` | Call `get_capabilities`; feature may need newer Photoshop or Adobe login |
| Neural filter fails | **Add Plugin** → `uxp-plugin/manifest.json` → **Load** in UXP Developer Tools — see [docs/development.md](docs/development.md#uxp-bridge-plugin-neural-filters) |
| No active document | Ask user to open/create a document, then `get_state` |

More: [docs/troubleshooting.md](docs/troubleshooting.md).

## Distribution

| Channel | Identifier |
| ------- | ---------- |
| This fork | https://github.com/lavalava45/photoshop-mcp-digital-painting |
| Fork npm package | **None** — build from this repository |
| Fork MCP Registry entry | **None** — use local stdio |
| Original/upstream project | https://github.com/alisaitteke/photoshop-mcp |

## Key files

| File | Purpose |
| ---- | ------- |
| [llms.txt](llms.txt) | LLM-oriented project summary |
| [README.md](README.md) | Human docs, install, example prompts |
| [server.json](server.json) | MCP Registry metadata |
| [src/core/server.ts](src/core/server.ts) | MCP server entry |
| [src/tools/](src/tools/) | Tool implementations |
| [src/prompts/](src/prompts/) | MCP prompt templates |
| [CONTRIBUTING.md](CONTRIBUTING.md) | PR and release workflow |

## Contributing (agents editing this repo)

- Canonical language for code, comments, commits, and PRs: **English**.
- Before PR: `npm run lint`, `npm run build:server`, `npm run verify:photoshop-prompts`.
- Do not add AI-attribution footers to commits or PR descriptions.
