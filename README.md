# Photoshop MCP — Digital Painting Edition

Community-maintained fork of [alisaitteke/photoshop-mcp](https://github.com/alisaitteke/photoshop-mcp), focused on native digital-painting workflows in Photoshop.

**Original project / upstream:** [alisaitteke/photoshop-mcp](https://github.com/alisaitteke/photoshop-mcp)<br>
**This fork:** [lavalava45/photoshop-mcp-digital-painting](https://github.com/lavalava45/photoshop-mcp-digital-painting)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS-lightgrey.svg)]()

> This is an independent fork. It is not an official release of the upstream project and is not affiliated with or endorsed by Adobe Inc.

## What this fork adds

The upstream project already provides a broad Photoshop automation MCP. This edition keeps that toolset and adds a focused painting and visual-control layer for brush-driven work:

- installed brush-preset discovery and exact preset selection;
- brush size, hardness, opacity, flow, spacing, angle, roundness, flip, pressure, airbrush, and smoothing controls;
- batched raster painting with Brush, Pencil, Eraser, and Smudge;
- straight, polyline, and Bezier strokes;
- one-point dabs/stamps;
- per-stroke color, size, opacity, and flow overrides;
- automatic cost-aware batching for large heterogeneous paint passes;
- interpolated size/opacity/flow dynamics along open strokes;
- Photoshop `simulatePressure` support;
- explicit measurement, landmark, and guide tools for reference/proportion work;
- reusable landmark-frame transforms and normalized landmark-set comparison;
- a materialized preview pipeline for direct stdio/COS workflows without a second Photoshop export;
- more reliable nested-layer targeting and ordering with recursive lookup and stable layer IDs;
- strict optional `document_id` pinning for document-bound tools, with fail-closed validation and returned target metadata;
- an agent visual-control workflow with semantic passes, previews, measurement checkpoints, occlusion reasoning, cleanup, sticky Photoshop routing, and a state-based Definition of Done.

The current build exposes **130 tools** (**114 atomic/non-recipe + 16 recipes**) and **24 prompts**.

## Digital-painting tools

```text
photoshop_list_brush_presets
photoshop_select_brush_preset
photoshop_get_brush_settings
photoshop_set_brush
photoshop_set_foreground_color
photoshop_paint_strokes
photoshop_measure_points
photoshop_add_guides
photoshop_list_guides
photoshop_clear_guides
photoshop_transform_landmarks
photoshop_compare_landmarks
```

For proportion-sensitive work, the landmark tools let an agent reuse the same named points across differently sized or framed references without hard-coding portrait-specific math. `photoshop_transform_landmarks` maps points between semantic frames while preserving local `u/v` position; `photoshop_compare_landmarks` reports per-point normalized error plus mean, RMSE, and maximum error. Both are pure geometry helpers and do not perform automatic landmark detection.

The painting workflow is also exposed as the MCP guide prompt:

```text
ps.digital_painting_control
```

That guide is intended for iterative drawing rather than one-shot stroke dumping:

```text
plan → block-in → preview → construction → preview
→ values/color → preview → detail → preview → cleanup → final preview
```

## Install this fork

If you want the painting extensions, install **this repository from GitHub**. The upstream npm package does not contain the fork-specific painting tools.

Requirements:

- Adobe Photoshop;
- Node.js 18 or newer;
- Windows or macOS;
- Git, or a downloaded GitHub source archive.

Clone and build:

```bash
git clone https://github.com/lavalava45/photoshop-mcp-digital-painting.git
cd photoshop-mcp-digital-painting
npm ci
npm run build:server
```

The MCP server entry point is:

```text
<repo>/dist/index.js
```

Point your MCP host directly at that file over stdio. Example:

```json
{
  "mcpServers": {
    "photoshop-painting": {
      "command": "node",
      "args": ["/absolute/path/to/photoshop-mcp-digital-painting/dist/index.js"],
      "env": {
        "PHOTOSHOP_PATH": "/absolute/path/to/Photoshop"
      }
    }
  }
}
```

`PHOTOSHOP_PATH` is only required when Photoshop is not detected automatically.

For Chat On Steroids, this project uses **Chat On Steroids Core + direct stdio MCP**. The shared Plugins connector is not the execution path or health check for this fork.

See [`INSTALL.md`](INSTALL.md) for the full clean-machine setup.

## Verify the installation

Static checks:

```bash
npm run build:server
npm run lint
npm run verify:photoshop-prompts
npm run verify:tool-counts
```

With Photoshop running, execute the live painting smoke test:

```bash
node scripts/test-painting-tools.mjs
node scripts/test-measurement-tools.mjs
node scripts/test-landmark-ergonomics.mjs
npm run test:painting-batching
npm run test:painting-batching-live
npm run test:document-targeting
npm run test:document-targeting-live
```

The current verified tool-count result is:

```text
tool counts consistent: 130 = 114 atomic + 16 recipes
```

The fork has been live-tested primarily on **Photoshop 2026 for Windows**. During the current validation, 123 installed brush presets were enumerated and the painting smoke test completed with `PAINTING_TEST_OK`.

## Documentation

- [`INSTALL.md`](INSTALL.md) — installation and MCP host configuration
- [`docs/digital-painting.md`](docs/digital-painting.md) — painting API and design notes
- [`docs/digital-painting-agent-skill.md`](docs/digital-painting-agent-skill.md) — visual-control workflow, checkpoints, cleanup, and Definition of Done
- [`docs/available-tools.md`](docs/available-tools.md) — complete tool reference
- [`docs/architecture.md`](docs/architecture.md) — architecture inherited from upstream plus fork integration points
- [`docs/development.md`](docs/development.md) — build and development workflow
- [`RELEASE_CHECKLIST.md`](RELEASE_CHECKLIST.md) — validation before publishing a release
- [`docs/troubleshooting.md`](docs/troubleshooting.md) — common connection and Photoshop issues

The repository also retains upstream documentation for the broader Photoshop MCP feature set. Those inherited documents may describe upstream features that are not specific to Digital Painting Edition.

## Layer API consistency

The fork also tightens several inherited layer-operation contracts that matter in multi-layer painting workflows:

- `photoshop_get_layers` now exposes recursive layer `id`, `path`, and `depth` metadata;
- layer ordering resolves targets recursively, so layers returned by `photoshop_get_layers` can also be targeted when they live inside groups;
- `photoshop_move_layer_to_position` accepts `targetLayerId` (preferred over a possibly duplicated name);
- `photoshop_move_layer_up`, `photoshop_move_layer_down`, `photoshop_move_layer_to_top`, and `photoshop_move_layer_to_bottom` keep nested layers inside their current parent stack;
- core layer tools now return structured JSON envelopes instead of a mixture of plain-text confirmations and JSON.

Regression coverage is provided by:

```bash
node scripts/test-layer-api-contracts.mjs
node scripts/test-layer-api-live.mjs
```

The live test creates its own temporary Photoshop document, exercises grouped/nested layers and id-based ordering, and closes that temporary document without saving.

## Upstream and attribution

This fork is based on [Photoshop MCP](https://github.com/alisaitteke/photoshop-mcp), originally created by Ali Sait Teke.

The upstream source, documentation, and assets retain their original copyright and license notices. This fork is maintained independently; references to the upstream project do not imply that its original author maintains or endorses this fork.

## Analytics

The upstream anonymous usage-analytics subsystem remains in this fork. Aggregated analytics are enabled by default and can be disabled; see [`docs/anonymous-usage-analytics.md`](docs/anonymous-usage-analytics.md).

## License

MIT. See [`LICENSE`](LICENSE). The original upstream copyright notice is retained there.
