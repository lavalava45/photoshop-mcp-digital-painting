# Social preview & LinkedIn

Assets and copy for sharing this project on LinkedIn, GitHub, and other channels.

## Open Graph image

| Asset | Path | Size |
| ----- | ---- | ---- |
| Social preview | [`images/og-social.png`](../images/og-social.png) | 1200×630 (LinkedIn / GitHub recommended) |
| README hero | [`images/readme-hero-v2.png`](../images/readme-hero-v2.png) | 1600×800 (GitHub README banner) |

The fork social preview must identify this repository, not the upstream author's personal site or product website. Do not use `photoshop-mcp.com` or `alisait.com` as the fork homepage.

### GitHub repository social preview

1. Open **Settings → General → Social preview** on [lavalava45/photoshop-mcp-digital-painting](https://github.com/lavalava45/photoshop-mcp-digital-painting).
2. Upload `images/og-social.png`.
3. Save — link previews on LinkedIn, Slack, and X will use this image when sharing the repo URL.

### Fork homepage

This fork currently has no separate public website. Use the GitHub repository URL as the canonical public identity.

---

## Suggested fork announcement

Copy, adjust, and attach `images/og-social.png` or a short screen recording of the standalone UI.

---

**Hook**

I have been extending the open-source Photoshop MCP project with a dedicated digital-painting fork focused on brush-driven agent workflows.

**Problem**

When LLMs call Photoshop one command at a time, they burn tokens, guess layer types, and break on the first ExtendScript error. Real creative workflows need undoable multi-step runs and a way for the agent to recover.

**What this fork adds**

- **Photoshop MCP** — 134 tools incl. 16 recipe workflows, digital-painting primitives, VisualMicroPlan execution, color sampling, and measurement/landmarks/guides

> `images/og-social.png` is generated: `npx playwright install chromium` once, then
> `npx tsx scripts/generate-og-image.ts`. It reads the tool counts from
> `site/data/meta.json`, so regenerate it after adding tools.
- Cross-platform: macOS (AppleScript) + Windows (COM)
- Bundled **standalone web UI** — chat with Claude, GPT, or Gemini; drive Photoshop without an IDE
- **Action Plan (beta)** — plan all steps in one LLM call, execute without per-step round-trips

**Technical call**

External automation can't invoke UXP plugins — only ExtendScript via AppleScript/COM. I chose compatibility across Photoshop 2012–2025 over bleeding-edge APIs. Structured error envelopes tell the agent which tool to call next when something fails.

**Links**

- Fork: https://github.com/lavalava45/photoshop-mcp-digital-painting
- Install: clone/build the fork and run `dist/index.js` over stdio; there is currently no fork npm package or MCP Registry entry
- Architecture: https://github.com/lavalava45/photoshop-mcp-digital-painting/blob/digital-painting/docs/architecture.md
- Original/upstream project: https://github.com/alisaitteke/photoshop-mcp

Feedback and contributors welcome. If your team builds agent tooling or creative automation, happy to connect.

---

## GitHub repo About (manual)

Set in repository **About** sidebar:

- **Description:** `Independent Photoshop MCP fork for AI-driven digital painting — 134 tools with brush dynamics, VisualMicroPlan execution, color sampling, previews, landmarks/guides, hardened document targeting, and recipes.`
- **Website:** leave blank unless a fork-owned site is created
- **Topics:** `mcp`, `model-context-protocol`, `typescript`, `ai-agents`, `photoshop`, `automation`, `vue`, `hono`, `developer-tools`, `cursor`, `claude`, `extendscript`
