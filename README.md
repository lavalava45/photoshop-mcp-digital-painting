# Photoshop MCP — Digital Painting Edition

> **Community fork.** Based on [alisaitteke/photoshop-mcp](https://github.com/alisaitteke/photoshop-mcp) by Ali Sait Teke, with a focused extension for native digital-painting workflows in Photoshop.
>
> **Original project / Upstream:** [alisaitteke/photoshop-mcp](https://github.com/alisaitteke/photoshop-mcp)<br>
> **This fork:** [lavalava45/photoshop-mcp-digital-painting](https://github.com/lavalava45/photoshop-mcp-digital-painting)

### What this edition adds

- brush preset discovery and exact preset selection;
- brush dynamics control, including pressure, opacity, flow, spacing, angle, roundness, airbrush, and smoothing;
- batched raster painting with Brush, Pencil, Eraser, and Smudge strokes, including Bezier paths, dabs, and per-stroke overrides;
- an agent-oriented visual-control workflow with semantic passes, checkpoints, cleanup, occlusion handling, and a fresh-composition rule for evaluation.

<p align="center">
  <a href="https://github.com/alisaitteke/photoshop-mcp">
    <img src="./images/readme-hero-v2.png" alt="Photoshop MCP — tell Photoshop what you want, AI does the clicking" width="100%" />
  </a>
</p>

_The hero artwork and upstream package/release/website badges below are retained from the original project. Links that point to `alisaitteke/photoshop-mcp` or `@alisaitteke/photoshop-mcp` refer to upstream unless explicitly marked otherwise._

**Languages:** English · [简体中文](README.zh-CN.md) · [Español](README.es.md) · [Deutsch](README.de.md) · [日本語](README.ja.md) · [Türkçe](README.tr.md) · **[Website](https://photoshop-mcp.com/)**

[![npm version](https://img.shields.io/npm/v/@alisaitteke/photoshop-mcp.svg)](https://www.npmjs.com/package/@alisaitteke/photoshop-mcp)
[![GitHub release](https://img.shields.io/github/v/release/alisaitteke/photoshop-mcp?include_prereleases)](https://github.com/alisaitteke/photoshop-mcp/releases)
[![Action Plan](https://img.shields.io/badge/Action%20Plan-beta-amber.svg)](docs/standalone-ui.md#action-plan-beta)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS-lightgrey.svg)]()
[![MCP Registry](https://img.shields.io/badge/MCP%20Registry-io.github.alisaitteke%2Fphotoshop--mcp-purple.svg)](https://registry.modelcontextprotocol.io)
[![MCP Toplist](https://mcptoplist.com/badge/io.github.alisaitteke%2Fphotoshop-mcp.svg)](https://mcptoplist.com/server/io.github.alisaitteke%2Fphotoshop-mcp)
[![Website](https://img.shields.io/badge/website-photoshop--mcp-cyan.svg)](https://photoshop-mcp.com/)

**Chat with Photoshop like a colleague.** Describe what you want in plain words —
"remove this background", "resize these for Instagram" — and your AI assistant
does the clicking for you. Works with Cursor, Claude, or the built-in chat
window. No code, no scripts, no IDE required.

> **Note:** This is an unofficial, community-maintained project and is not affiliated with or endorsed by Adobe Inc.

## What can it do?

- ✂️ **Remove backgrounds** — subject isolated with a clean, editable mask
- 👤 **Retouch portraits** — skin smoothing, tone fixes, dodge & burn setup
- 🌐 **Export for web & social** — sRGB, sharpened, correctly sized for Instagram, X, and more
- 🎞️ **Make carousels** — split one wide design into seamless, numbered slides
- 💧 **Watermark in bulk** — a whole folder of photos in one go, originals untouched
- 🎨 **Color grade & more** — film looks, sky replacement, generative fill (Adobe account required)
- ⏪ **Stay safe** — every multi-step "recipe" is a single undo step in Photoshop

Under the hood: 124 tools (108 atomic/non-recipe + 16 one-step recipes) — full list in
[`docs/available-tools.md`](docs/available-tools.md).

## Try saying

```
Remove the background from this portrait — keep it editable with a mask.
```

<img src="./images/recipe-remove-bg.svg" alt="Remove background: subject isolated on transparency" width="640" />

```
Enhance this portrait — smooth the skin and fix the tones, medium intensity.
```

<img src="./images/recipe-enhance-portrait.svg" alt="Enhance portrait: skin smoothing + auto tone in one undoable step" width="640" />

```
Prepare this design for web, then export Instagram and X post variants.
```

<img src="./images/recipe-prepare-web.svg" alt="Prepare for web: sRGB, downscale, sharpen, optimized JPEG" width="640" />

```
Split this wide banner into a 5-slide seamless Instagram carousel.
```

<img src="./images/recipe-carousel.svg" alt="Split one wide document into numbered carousel slides" width="640" />

More recipes (batch watermark, passport photos, CSV-driven cards, mockups, …) and
pre-engineered prompt templates: [`docs/prompt-layer.md`](docs/prompt-layer.md).

## Get started

You need **Photoshop running** (Windows or macOS, any version 2012+) and **Node.js 18+**.

> **Digital Painting Fork:** the npm commands and one-click links below point to
> the upstream Photoshop MCP package and do not include this fork's painting
> extensions. To install this fork from GitHub, follow [`INSTALL.md`](INSTALL.md)
> and launch this checkout's built `dist/index.js`.

### Option 1 — Easiest: the built-in chat window

```bash
npx -p @alisaitteke/photoshop-mcp photoshop-mcp-ui
```

A chat window opens in your browser. Sign in with an AI provider API key — or
reuse your existing **Claude Code** / **Gemini CLI** account, no key needed.

![Standalone UI Screenshot](./images/frame_generic_light.png)

Details, providers, and security notes: [`docs/standalone-ui.md`](docs/standalone-ui.md).

### Option 2 — Inside your AI app (Cursor, Claude, VS Code)

[![Install in Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en/install-mcp?name=photoshop&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBhbGlzYWl0dGVrZS9waG90b3Nob3AtbWNwIl19)
[![Install in VS Code](https://img.shields.io/badge/Install%20in-VS%20Code-0098FF)](https://vscode.dev/redirect/mcp/install?name=photoshop&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40alisaitteke%2Fphotoshop-mcp%22%5D%7D)

Claude Code:

```bash
claude mcp add photoshop -- npx -y @alisaitteke/photoshop-mcp
```

Or add this to your MCP client's config (Cursor, Claude Desktop, …):

```json
{
  "mcpServers": {
    "photoshop": {
      "command": "npx",
      "args": ["-y", "@alisaitteke/photoshop-mcp"]
    }
  }
}
```

## How it works

1. **You type** what you want in plain language.
2. **The AI plans** the steps, checking the document state first.
3. **Photoshop executes** — each recipe lands as one undoable step.

Something went wrong? The AI reads the structured error and knows what to try
next. Common fixes: [`docs/troubleshooting.md`](docs/troubleshooting.md).

## Documentation

- [Install this fork](INSTALL.md) — clean GitHub clone/ZIP, build, MCP client and Chat On Steroids setup
- [Release checklist](RELEASE_CHECKLIST.md) — validation and documentation checks before publishing a tag
- [Digital painting extension](docs/digital-painting.md) — brush/preset/stroke API added by this fork
- [Digital painting agent skill](docs/digital-painting-agent-skill.md) — checkpoints, occlusion control, cleanup and Definition of Done
- [Available tools](docs/available-tools.md) — all 124 tools with parameters
- [Standalone UI](docs/standalone-ui.md) — providers, auth modes, Action Plan, security
- [Prompt layer](docs/prompt-layer.md) — prompt templates and recipes
- [Architecture](docs/architecture.md) — how the bridge works under the hood
- [Development](docs/development.md) — build from source, tests

## Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a PR.

## Maintainer

Built by **[Ali Sait Teke](https://alisait.com)** — [GitHub](https://github.com/alisaitteke) · [LinkedIn](https://www.linkedin.com/in/alisait/).

## License

MIT

Anonymous, aggregated usage analytics are collected by default and can be
disabled anytime — details in [`docs/anonymous-usage-analytics.md`](docs/anonymous-usage-analytics.md).
