# Development

Build, lint, and test the photoshop-mcp server locally.

← Back to [README](../README.md)

### From Source

```bash
git clone <this-fork-repository-url>
cd photoshop-mcp-digital-painting
npm ci
npm run build
```

For end-user installation and MCP host configuration, see [`../INSTALL.md`](../INSTALL.md).

Keep the official repository as a separate `upstream` remote when developing
the fork:

```bash
git remote add upstream https://github.com/alisaitteke/photoshop-mcp.git
git fetch upstream
```

### Build

```bash
npm run build
```

### Watch Mode

```bash
npm run dev
```

### Lint & Format

```bash
npm run lint
npm run format
```

### Integration tests (requires running Photoshop)

```bash
npm run build:server
npm run spike:issue-2     # issue #2 targeted regression (10 checks)
npm run test:mcp-local    # prompt-layer smoke
npm run test:mcp-all      # full sequential tool sweep
npm run test:measurement-tools # measurement/guides live smoke
npm run test:landmark-ergonomics # pure geometry landmark regression; Photoshop not required
npm run test:painting-batching # offline batching/dynamics regression
npm run test:painting-batching-live # live AUTO batching + taper regression
npm run test:document-targeting # offline document-id contract regression
npm run test:document-targeting-live # two-document pinning/race regression
npm run test:color-sampling # offline sample-color contract
npm run test:color-sampling-live # live point + local-average color sampling
npm run spike:photoshop-actions  # generative AI action probes → scripts/output/generative-probe-report.json
npm run verify:photoshop-prompts
```

### UXP bridge plugin (Neural Filters + fast-lane diagnostics)

Neural Filters (`photoshop_neural_filter`) require the companion plugin in `uxp-plugin/`:

1. Install [Adobe UXP Developer Tools](https://developer.adobe.com/photoshop/uxp/2022/guides/devtool/).
2. **Add Plugin** → select `uxp-plugin/manifest.json` in this repo → **Load** (or **Load & Watch**) from the plugin's ••• menu. After `main.js` changes, **Reload** is sufficient. After `manifest.json` changes, use **Unload** then **Load** so the manifest is re-read.
3. Open the **MCP Bridge** panel in Photoshop. The plugin keeps a localhost long-poll
   open to `127.0.0.1:38452`, so commands are delivered immediately instead of on a
   fixed polling interval.
4. Start `photoshop-mcp` or the web UI — the server starts the bridge HTTP listener automatically.

Override port with `PHOTOSHOP_UXP_BRIDGE_PORT` (default `38452`).

`GET /health` reports both listener health and `plugin_connected`, which is true only
when the Photoshop UXP plugin has an active/recent long-poll with the bridge. For read-only live
round-trip checks, `POST /diagnostic/ping` sends a no-op metadata command through the plugin,
`POST /diagnostic/batchplay` executes one read-only `batchPlay` application-property read,
and `POST /diagnostic/state` executes the same semantic UXP state read used by
`photoshop_get_state`. These endpoints do not mutate the open document.

The bridge transport is now a localhost **long-poll**, not a fixed 400 ms polling loop.
The UXP plugin keeps one `/poll` request open; the Node side completes it immediately when
a command appears, and `/result` resolves the exact waiting command promise immediately.
This removes the former 400 ms command polling delay and 250 ms result polling delay.

#### Applying local code changes without restarting all of CoS

After `npm run build:server`, the already-running Chat On Steroids MCP child does not
necessarily reload new files merely because the ChatGPT Plugins schema was refreshed.
Use the supported host control instead:

```text
Chat On Steroids app
→ Plugins
→ Photoshop MCP Digital Painting Fork
→ …
→ Restart
```

This restarts only `dist/cos-plugin.js`; do not restart the entire Chat On Steroids app and
do not use obsolete restart-helper scripts. Confirm code freshness with the child PID /
creation time if necessary.

The UXP runtime is independent of the Node MCP child. After changing `uxp-plugin/main.js`:

```text
Adobe UXP Developer Tool
→ Photoshop MCP UXP Bridge
→ …
→ Reload
```

For `manifest.json` changes use **Unload → Load**. After reload, `/health` should normally
show `plugin_connected: true`, `transport: "long-poll"`, and one waiting long-poll request.

Current 2026-09-23 post-migration cutover check: the restarted Photoshop MCP child is PID
`10772` and is running repository HEAD `67c0c00a94e071520532692fdbe95b3b535ddb80`
with `dist/cos-plugin.js` SHA-256
`9023114D837A4307EBBE81D280226E1A6AD8F02DFAB35E4EC12208C0F8118801`.
`photoshop_ping` reports `connected=true`, `ready=true`, selected transport `uxp`,
long-poll bridge revision `compact-v2-20260924-targeting`, and an exact expected/actual revision
match. Guard reports compact protocol `photoshop.guard.compact.v2`, runtime state
`photoshop.guard.runtime-state.v2`, required mode with raw mutation bypass blocked, and no
pending/uncertain work at the cutover check. This verifies code/companion freshness; it is not
a substitute for the separate representative post-migration behavioral acceptance trace.

#### 2026-09-18 localhost transport microbenchmark

On Photoshop 2026 for Windows, a read-only diagnostic microbenchmark measured the transport
overhead rather than a representative painting workload:

- old UXP fixed-poll path: median ~250 ms full round trip;
- current UXP long-poll `batchPlay` diagnostic: median 9 ms over 30 sequential calls,
  p95 11 ms; the read-only Photoshop action itself measured 0–1 ms;
- current COM/ExtendScript read-only micro-call with the foreground guard: median ~540 ms.

These numbers do **not** imply that real painting is 60× faster; expensive Photoshop work
still dominates its own execution time. They do show that the current UXP transport overhead
is in the low-millisecond range. During the 30-call UXP run, a 5 ms foreground monitor saw
zero Photoshop foreground transitions.

#### Phase-1 semantic backend acceptance

`photoshop_get_state` is the first general production tool migrated behind
`PhotoshopBackendRouter`. Routing is UXP-first when the companion is connected and falls back
to ExtendScript only when backend availability is resolved **before dispatch**. There is no
automatic cross-backend replay after a request has started.

The public MCP schema and state payload remain unchanged. Phase-1 live acceptance on Windows /
Photoshop 2026 now includes both empty-session parity and an open-document parity check against
legacy COM/ExtendScript. On the open 64×48 RGB test document, UXP matched document id/name,
dimensions, resolution, color mode, selection state, active-layer name/kind/opacity/blend mode,
visibility/lock/background flag and bounds. Action Manager's `numberOfLayers` excludes the
background layer, so the UXP normalizer explicitly folds `hasBackgroundLayer` back in to preserve
the legacy `doc.layers.length` contract.

Foreground acceptance was then repeated against the production state diagnostic with an open
document: 40 consecutive `get_state` reads while Chrome remained foreground, sampled every
~5 ms, produced zero Photoshop foreground samples and zero foreground transitions. Round-trip
latency for that run was 9–22 ms, averaging 11.88 ms. A final real
`Chat_On_Steroids_Plugins → photoshop_get_state` call returned the same normalized payload,
confirming that acceptance is not limited to the diagnostic endpoint.

#### Phase-2 read-cluster acceptance

The next four P0 read-only tools now use the same `PhotoshopBackendRouter` policy:
`photoshop_get_document_info`, `photoshop_list_documents`,
`photoshop_get_selection_bounds`, and `photoshop_get_layers`. They remain UXP-first while the
bridge is healthy and select ExtendScript only before dispatch when it is not.

On the same open 64×48 RGB document, direct COM/ExtendScript calls matched the UXP production
results for document info, the open-document list, and selection bounds. The layer tool was
captured before migration and the migrated public route reproduced its complete one-layer
legacy payload (`Background`, id 1, `ArtLayer`, depth/path, visibility, opacity, blend mode and
kind) plus the same session context.

No-focus-steal acceptance used Chrome as the foreground application with 5 ms sampling:
`list_documents` completed 40 calls at 8–13 ms (9.85 ms average), selection bounds completed
40 calls at 8–12 ms (8.93 ms average), and layer listing completed 40 calls at 8–13 ms
(9.9 ms average). All three runs recorded **zero** Photoshop foreground samples and **zero**
foreground transitions. `get_document_info` reuses the already accepted `state.read`
descriptor path.

#### Phase-3 brush-read acceptance

`photoshop_list_brush_presets` and `photoshop_get_brush_settings` now use the same
UXP-first/pre-dispatch-ExtendScript-fallback routing policy. Preset enumeration reads the
application `presetManager`; settings read the application `currentToolOptions` descriptor
and normalize the embedded brush object without switching tools.

Live preset parity matched all 123 installed brush presets and reproduced the exact filtered
`soft` result. Its 40-call foreground run recorded zero Photoshop samples/transitions at
9–15 ms, 10.72 ms average. Brush settings then matched direct COM/ExtendScript on all 14 public
fields (size, hardness, angle, roundness, spacing, opacity, flow, flip X/Y, pressure
size/opacity, airbrush, smoothing enabled and smoothing amount). Its 40-call foreground run
recorded zero Photoshop samples/transitions at 9–13 ms, 10.07 ms average.

During investigation, a direct Action Manager `Get` targeting `brush` produced a Photoshop
27.8 modal error and stalled the companion long-poll. That probe is not part of production code;
the accepted implementation uses only application `currentToolOptions`.

#### Phase-4 preview acceptance

`photoshop_get_preview` now routes UXP-first through the Imaging API. The UXP backend reads
composite pixels directly instead of duplicating, cropping, flattening and saving temporary
Photoshop documents. Whole-document and focus-region geometry remained identical to the legacy
contract. On the live 64×48 document, the legacy and UXP JPEGs differed as encoded byte streams,
but both whole and focus captures were **pixel-identical after JPEG decode**
(`mean_abs_rgb=0`, `max_abs_rgb=0`). The 40-call foreground run recorded zero Photoshop
samples/transitions at 13–51 ms, 36.22 ms average.

Photoshop 27.8 requires `imaging.getPixels` to run within `core.executeAsModal` even for a
read-only capture. The accepted implementation uses that scope without a history mutation; the
foreground acceptance above verifies that it does not activate Photoshop.

#### Phase-5 color-sampling acceptance

`photoshop_sample_color` and `photoshop_sample_colors` now share the same UXP Imaging API
read lane. The public single-average sample preserved legacy point/radius/bounds/mode/RGB/HEX
semantics, and the point-batch route preserved count, chunk metadata, caller ids (including
`null`) and RGB/HEX values. On the live white test document the public UXP results matched the
captured legacy baselines exactly. Forty-call foreground runs recorded zero Photoshop
samples/transitions: single sample 14–89 ms (43.32 ms average), batch sample 11–91 ms
(44.58 ms average).

#### Phase-6 history and measurement acceptance

`photoshop_get_history` now routes UXP-first. The implementation reads the target
`historyState` descriptor to obtain the count/current item, enumerates indexed states with
read-only `batchPlay`, and reuses the accepted session-state normalizer for the legacy
`context` block. On the live document, its complete public output matched direct
COM/ExtendScript: two states, current index/name, undo/redo flags, snapshot flags and context.
Forty foreground-acceptance calls recorded zero Photoshop samples/transitions at 9–26 ms,
11.88 ms average.

`photoshop_measure_points` no longer sends a JSX program. It reads the active document via the
migrated `document.info` semantic backend and calculates caller-supplied points, distances and
ratios in Node. Numeric output is rounded to the legacy ExtendScript serialization precision so
the public payload remains field-for-field compatible.

#### Phase-8 P0 mutation acceptance

`photoshop_select_brush_preset`, `photoshop_set_brush`,
`photoshop_set_foreground_color`, `photoshop_fill_layer`,
`photoshop_paint_regions`, `photoshop_paint_strokes`, and
`photoshop_paint_dabs` now use the same UXP-first / pre-dispatch-ExtendScript-fallback policy.
Backend selection remains final before mutation dispatch; uncertain execution is reconciled from
fresh state/preview evidence rather than replayed through another backend.

Live disposable A/B acceptance covered public metadata, stable document/layer targeting,
selection restoration, decoded pixel output, Photoshop history semantics and foreground focus.
`fill_layer` matched the exact legacy `Select Canvas → Fill → Deselect` history sequence.
`paint_regions` matched ADD/SUBTRACT hole geometry and one-step `MCP Paint Regions` history.
`paint_strokes` matched stored-foreground and combined explicit-color/style behavior with one
`MCP Digital Painting` history step. `paint_dabs` preserved ordered adjacent style runs:
an overlapping red → blue → red test finished red on both backends with three style runs, two
unique styles, one internal batch and one `MCP Paint Dabs` history step.

The accepted UXP region implementation uses UXP `PathPointInfo`/`SubPathInfo` construction,
then Action Manager path-to-selection/fill/deselect/delete because the ExtendScript
`PathItem.fillPath` route is not directly available in this host. For strokes/dabs,
`doc.pathItems.getByName(pathName)` is used to obtain the actual PathItem before
`strokePath`.

Photoshop 27.8 can restore stale brush opacity/flow when `app.foregroundColor` is assigned
inside the same painting modal. The UXP mutation implementation therefore writes color first
and then re-applies the desired size/opacity/flow through the whole-`currentToolOptions`
writer. A baseline 7/12 brush plus explicit 100/100 cyan stroke was used as the live regression
case and matched the legacy path after the fix.

Guard treats explicit `photoshop_set_active_document` as preparation/navigation rather than a
visual mutation. This prevents checkpoint cadence from blocking a deliberate tab switch while
preserving the rule that document-bound semantic tools never switch documents implicitly.

Migration inventory and priorities are maintained in
[`docs/uxp-migration-inventory.md`](uxp-migration-inventory.md), generated from the current
registered tool sources by `scripts/dev/generate-uxp-migration-inventory.mjs`.

### Exact full-canvas raster registration

Do not rely on clipboard copy/paste when exact full-canvas registration matters. Photoshop can
center trimmed transparent clipboard content, which changes its absolute document-space placement
even when the source originally had full-canvas coordinates. For exact registration, prefer a
document-to-document layer duplicate from the opened source into the target document, then close
the source without saving. When a pre-rendered technical element is used as a fallback, keep it as
a full-canvas raster source so its transparent margins preserve the intended absolute coordinates.

### Native AI-adjacent Photoshop features

The MCP surface does not expose cloud text/image generation. Native Sky Replacement remains available as `photoshop_sky_replacement`; Neural Filters remain available through the UXP bridge.

## Integration test results

Local MCP integration tests run against a live Photoshop instance over stdio
(same path as Cursor / Claude Desktop). Last verified on **Photoshop 26.5.0**
(macOS).

*Recorded on PS 26.5.0 (macOS) after issue #2 fixes and Phase 2 test harness — re-run `npm run test:mcp-all` to refresh.*

| Suite | Command | Result |
|-------|---------|--------|
| Issue #2 regression | `npm run spike:issue-2` | Targeted checks (metadata, layers, place, Smart Object transform, jsString escapes, fonts, alert, CJK names) |
| Full tool + recipe sweep | `npm run test:mcp-all` | **119 pass**, **0 fail**, **4 skip** (123 total) |
| Prompt-layer smoke | `npm run test:mcp-local` | 21 prompt templates + core recipes |
| Prompt ↔ recipe parity | `npm run verify:photoshop-prompts` | 16↔16 strict match + 5 guides |

**Tool coverage:** 145 total tools (129 atomic/non-recipe `photoshop_*` + 16 recipe
`photoshop_recipe_*`) — re-run `npm run test:mcp-all` for a fresh pass count.

**Intentional skips** (environment-dependent, not regressions):

| Tool | Reason |
|------|--------|
| `photoshop_play_action` | Requires a real Actions palette entry on the machine |
| `photoshop_select_subject` | Requires a recognizable subject in the active layer |
| `photoshop_recipe_remove_background` | Synthetic test canvas has no recognizable subject for Select Subject |
| `photoshop_recipe_batch_mockup_replace` | Requires a Smart Object mockup PSD |

**PS 26 compatibility notes** (ExtendScript): layer masks use `stringID make`;
mask apply uses `delete` + `apply: true`; hue/saturation uses `Hst2` descriptors;
frequency separation uses `applyImageEvent` calculation descriptors. See
[`src/api/extendscript.ts`](../src/api/extendscript.ts) and
[`src/tools/recipes/_shared.ts`](../src/tools/recipes/_shared.ts).

Prerequisites: Photoshop installed and scriptable; run from the repo root after
`npm run build:server`.

## Usage Examples

Prompt the AI assistant in natural language — the MCP server picks the right tools.

### Create a Simple Design

> Create an 800×600 RGB document, add a light blue background layer, center the text "My Design" at 64pt, then save as `design.psd` on the Desktop.

### Batch Process Images

> Open my image, resize to 1920×1080, save as a high-quality JPEG to the Desktop, then close without saving the PSD.

### Design with Stock Images (Pexels)

Combine with a [Pexels MCP server](https://github.com/modelcontextprotocol/servers) if configured:

> Search Pexels for "nature landscape", place the downloaded photo in a 1920×1080 document, fit to fill the canvas, add "Beautiful Nature" as overlay text at the top, save as `nature-design.psd`.

## Quick Start Examples

### Common Use Cases

| Task | Prompt Example |
|------|----------------|
| **Basic Design** | "Create 1920x1080 document, add blue background, center text 'Hello'" |
| **Photo Edit** | "Open photo.jpg, apply auto levels, sharpen 100%, save as edited.jpg" |
| **Stock Image** | "Place image.jpg, fit to fill canvas, add overlay text 'Summer 2026'" |
| **Layer Effects** | "Set active layer blend mode to MULTIPLY, opacity 80%" |
| **Filters** | "Apply 10px Gaussian blur to current layer" |
| **Text Styling** | "Change text to Helvetica 64pt, color red, center aligned" |
| **Batch Work** | "Resize to 1080x1080, auto contrast, save as square.jpg, close" |
| **Masks** | "Select rectangle 100,100 to 500,500, create layer mask" |
| **Portrait recipe** | "Enhance portrait at medium intensity with skin smoothing, then preview" |
| **Background removal** | "Remove background from active layer, 2px feather, non-destructive mask" |
| **Web export** | "Prepare for web + export Instagram and X post variants to exports folder" |
| **Color grade** | "Apply warm_film color grade as adjustment layers" |
| **Frequency separation** | "Build FS stack at 6px — I'll paint the Low/High layers myself" |
| **State check** | "Ping Photoshop, get capabilities, then get_state before editing" |

## Context Tracking

Each tool returns comprehensive context information about the current state of Photoshop, including:

- **Document Info**: Name, dimensions, resolution, color mode, layer count
- **Active Layer Info**: Name, type, opacity, blend mode, visibility, lock state
- **Selection State**: Whether a selection is active
- **Operation Result**: Specific details about what was changed

This allows AI assistants to maintain awareness of which document is active,
which layer is being worked on, and current layer properties across multiple
commands.

**Example Response:**
```javascript
{
  "applied": true,
  "filter": "Gaussian Blur",
  "radius": 10,
  "wasRasterized": true,
  "context": {
    "hasDocument": true,
    "document": {
      "name": "design.psd",
      "width": 1920,
      "height": 1080,
      "resolution": 72,
      "colorMode": "RGBColorMode",
      "layerCount": 3,
      "hasSelection": false
    },
    "activeLayer": {
      "name": "Background",
      "kind": "NORMAL",
      "opacity": 100,
      "blendMode": "NORMAL",
      "visible": true,
      "locked": false,
      "isBackground": false
    }
  }
}
```
