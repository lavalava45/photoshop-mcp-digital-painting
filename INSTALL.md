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
npm ci
```

`npm ci` uses the committed `package-lock.json` and is the preferred
reproducible installation method for a release checkout.

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

For this fork, use **Chat On Steroids Core + a direct stdio MCP client**. Do not use the shared `Chat On Steroids Plugins` connector as the Photoshop execution path, health check, or fallback.

Launch the built server with a stdio client using a command equivalent to:

```json
{
  "kind": "command",
  "command": "C:\\Program Files\\nodejs\\node.exe",
  "args": [
    "D:\\Tools\\photoshop-mcp-digital-painting\\dist\\index.js"
  ]
}
```

Replace the example repository path with your actual checkout location.

Pass `PHOTOSHOP_PATH` in the stdio transport environment when automatic detection is insufficient, for example:

```json
{
  "PHOTOSHOP_PATH": "C:\\Program Files\\Adobe\\Adobe Photoshop 2026\\Photoshop.exe"
}
```

### Why not the shared Plugins connector

Chat On Steroids may expose only a subset of a large MCP server's tools through the shared `Chat On Steroids Plugins` connector. This fork currently exposes 130 tools, so the project standard is to bypass that surface entirely and connect directly over stdio from Chat On Steroids Core.

For Photoshop work in Chat On Steroids, `PLUGIN_DISABLED`, plugin runtime status, or a truncated Plugins catalog are therefore not diagnostic signals for this fork. Verify the direct stdio connection instead with `tools/list`, `prompts/list`, and `photoshop_ping`.

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
