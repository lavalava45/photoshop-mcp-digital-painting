# Installation — Digital Painting Fork

This repository is a digital-painting-focused fork of Photoshop MCP. It keeps
the upstream editing/automation toolset and adds brush presets, brush dynamics,
raster stroke painting, dabs/stamps, per-stroke overrides, explicit
measurement/guide tools, and the `ps.digital_painting_control` guide prompt.

This document describes a clean installation from a GitHub checkout. Do not
install the upstream npm package if you want the painting extensions from this
fork.

## Requirements

- Adobe Photoshop installed and scriptable.
- Photoshop should be running before the first smoke test.
- Node.js 18 or newer.
- Git, if cloning the repository. A GitHub source ZIP also works.
- Windows or macOS for the upstream Photoshop MCP. The painting fork is
  currently live-tested primarily on Windows with Photoshop 2026.

## 1. Download the repository

### Option A — Git clone

On the GitHub repository page, choose **Code → HTTPS** and copy the repository
URL, then run:

```bash
git clone <repository-url>
cd photoshop-mcp-digital-painting
```

Keep the checkout in a stable directory that will not be deleted by a package
manager. Examples:

```text
C:\Users\<you>\Documents\GitHub\photoshop-mcp-digital-painting
D:\Tools\photoshop-mcp-digital-painting
```

Do **not** point your MCP client at a temporary download directory if you plan
to keep using the server after updates/reboots.

### Option B — GitHub source ZIP

Choose **Code → Download ZIP**, extract the entire repository to a stable
directory, and open a terminal in that directory.

Git is recommended if you want easy updates later.

## 2. Install dependencies

From the repository root:

```bash
npm install
```

This fork currently does not commit a root npm lockfile, so use `npm install`
for a clean checkout.

## 3. Build the MCP server

```bash
npm run build:server
```

The MCP entry point is then:

```text
<repo>\dist\index.js
```

Do not point an MCP client at `src/`; use the built `dist/index.js`.

## 4. Tell the server where Photoshop is

If Photoshop is not detected automatically, set `PHOTOSHOP_PATH` to the full
Photoshop executable path.

Example for Photoshop 2026 on Windows:

```text
PHOTOSHOP_PATH=C:\Program Files\Adobe\Adobe Photoshop 2026\Photoshop.exe
```

This is especially important on versions newer than the common paths known by
the upstream detector.

## 5. Connect from Chat On Steroids

For ordinary Photoshop work in Chat On Steroids, use the live-accepted **Plugins →
`dist/cos-plugin.js` → embedded Guard → Photoshop** route. The dedicated entry point
enables `PHOTOSHOP_GUARD_MODE=required`: known read-only Photoshop tools stay directly
callable, while public raw mutating tools fail closed with `guard_required` and must be
dispatched through `photoshop_guard_cycle_auto`.

Configure the Chat On Steroids custom plugin to launch the built entry point:

```text
<repo>\dist\cos-plugin.js
```

Replace the example repository path with your actual checkout location.

Pass `PHOTOSHOP_PATH` in the stdio transport environment when automatic detection is insufficient, for example:

```json
{
  "PHOTOSHOP_PATH": "C:\\Program Files\\Adobe\\Adobe Photoshop 2026\\Photoshop.exe"
}
```

After rebuilding/updating the fork, refresh the Chat On Steroids Plugins schema through
the normal host UI. The accepted native catalog is **148 tools total / 13 Guard tools**.
A stale legacy 64-tool snapshot is not a limitation of this server.

For local development, distinguish **schema refresh** from **process restart**:

- ChatGPT **Settings → Plugins → Refresh** refreshes the connector/schema view.
- To make a rebuilt `dist/cos-plugin.js` take effect, in the **Chat On Steroids app** use
  **Plugins → Photoshop MCP Digital Painting Fork → … → Restart**. This restarts only the
  custom MCP child process; restarting the whole Chat On Steroids application is unnecessary.
- Do not use old restart-helper scripts for this workflow.
- If `uxp-plugin/main.js` changed, use **Reload** for Photoshop MCP UXP Bridge in Adobe UXP
  Developer Tool. If `manifest.json` changed, use **Unload → Load** instead.

### 5a. Load the Photoshop UXP companion

Non-interfering `photoshop_save_document` persistence and Neural Filters require the
repository's UXP companion. In **Adobe UXP Developer Tool**, add:

```text
<repo>\uxp-plugin\manifest.json
```

and choose **Load**. The plugin starts its localhost long-poll service at plugin creation;
the panel does not need to stay in the foreground. Verify the MCP-side bridge endpoint:

```text
http://127.0.0.1:38452/health
```

A healthy bridge reports `plugin_connected: true` and `transport: "long-poll"`.

The current live-tested Photoshop 2026 / UXP runtime requires the companion manifest's
network permission to be `domains: "all"` for the local HTTP bridge; narrowed loopback
entries are rejected by UXP with `Manifest entry not found`. The Node server still listens
only on `127.0.0.1`. If Adobe fixes loopback matching in a later runtime, this permission
can be narrowed without changing the bridge protocol.

`photoshop_save_document` is intentionally UXP-only and fails closed when this companion
is unavailable; it does not fall back to foreground-prone COM/ExtendScript saving.

The older **Core → `photoshop-session.mjs` → persistent daemon → `dist/index.js`**
route remains in the repository for development, diagnostics, recovery experiments and
legacy regression/live-test coverage. It is not the normal production transport.

If the native Plugins route is genuinely absent or stale, Core may be used to diagnose
the repository/server independently. Do not interpret a stale Plugins schema as proof
that Photoshop or the fork itself is unavailable.

## 6. Generic MCP client configuration

For Cursor, Claude Desktop, VS Code integrations, or another MCP host that
accepts stdio command configuration, use the same built entry point:

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

On Windows, use normal escaped Windows paths in JSON.

## 7. Verify the installation

First run the static checks:

```bash
npm run build:server
npm run lint
npm run verify:photoshop-prompts
```

With Photoshop running, run the live painting and measurement smoke tests:

```bash
node scripts/test-painting-tools.mjs
npm run test:measurement-tools
npm run test:landmark-ergonomics
```

The MCP server should expose the digital-painting tools including:

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

The guide prompt should include:

```text
ps.digital_painting_control
```

If those entries are missing, the MCP host is almost certainly launching the
upstream package or an old build instead of this fork.

## Updating an existing checkout

For a normal release checkout:

```bash
git pull --ff-only
npm ci
npm run build:server
```

Then restart the direct stdio MCP process in your client so it reloads the rebuilt `dist/index.js` and refreshes the tool/prompt catalog.

## Developer setup

For development, upstream syncing, linting, test suites, and branch workflow,
see [`docs/development.md`](docs/development.md).

For the painting API, see [`docs/digital-painting.md`](docs/digital-painting.md).

For the agent visual-control workflow, see
[`docs/digital-painting-agent-skill.md`](docs/digital-painting-agent-skill.md).

## Troubleshooting

See [`docs/troubleshooting.md`](docs/troubleshooting.md). In particular:

- confirm Photoshop is running;
- confirm `PHOTOSHOP_PATH` points to the correct executable when needed;
- confirm your MCP client launches this repository's `dist/index.js`;
- rebuild after pulling source changes;
- restart the direct stdio MCP process after a build so the host refreshes its tool schema.
