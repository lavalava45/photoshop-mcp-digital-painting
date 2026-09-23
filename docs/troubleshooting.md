# Troubleshooting

Common issues when connecting to or scripting Photoshop through the MCP server.

← Back to [README](../README.md)

### "Photoshop not found"

1. Make sure Photoshop is installed in the default location
2. Or set `PHOTOSHOP_PATH` environment variable to custom installation path

```json
{
  "env": {
    "PHOTOSHOP_PATH": "C:\\Custom\\Path\\Adobe Photoshop 2025\\Photoshop.exe"
  }
}
```

### "Failed to connect to Photoshop"

1. Ensure Photoshop is running (the server will try to launch it if not)
2. Check that scripting is enabled in Photoshop preferences
3. On Windows, verify COM automation is not blocked by security settings

### Timeouts: Photoshop script vs MCP request

There are two separate timeout layers:

- **Photoshop script execution timeout** — the Windows executor defaults to 30 seconds for one ExtendScript/COM script. Painting `AUTO` batching keeps individual Photoshop scripts below this boundary when possible.
- **MCP client request timeout** — `@modelcontextprotocol/sdk` defaults to 60 seconds for one `callTool()` request. A painting call can legitimately exceed 60 seconds when it contains several sequential AUTO batches even though each Photoshop script completes within its own limit.

The repository's direct-stdio painting helpers use `scripts/mcp-request-options.mjs`, which raises the client-side request timeout to **180 seconds** by default. Override it for local scripts with `PHOTOSHOP_MCP_REQUEST_TIMEOUT_MS` when needed.

If another MCP host still stops a tool at 60 seconds, that limit belongs to that host/client; the MCP server cannot unilaterally increase a remote client's request timeout.

### Rebuilt CoS plugin still runs old code

**Symptom:** `npm run build:server` completed, but Chat On Steroids still behaves like the
previous build. A ChatGPT Plugins **Refresh** may have been performed already.

**Cause:** schema/connector refresh and child-process restart are different operations.

**Fix:** in the **Chat On Steroids app**, open **Plugins → Photoshop MCP Digital Painting
Fork → … → Restart**. This restarts only the custom `dist/cos-plugin.js` child. Do not
restart all of CoS and do not use legacy restart-helper scripts. If necessary, verify that
the child PID/creation time changed after Restart.

### UXP bridge still runs old `main.js`

**Fix:** Adobe UXP Developer Tool → Photoshop MCP UXP Bridge → `…` → **Reload**. If the
changed file is `manifest.json`, use **Unload → Load** instead. Then verify bridge health:

```text
GET http://127.0.0.1:38452/health
```

Healthy current development output includes `plugin_connected: true` and
`transport: "long-poll"`.

### UXP bridge says `Permission denied ... Manifest entry not found`

**Symptom:** the panel loads, but `/health` reports `plugin_connected: false` and UXP
reports a permission error for `http://127.0.0.1:38452/poll`.

**Current live-tested behavior:** Photoshop 2026 / the bundled UXP runtime used by this
fork rejects narrowed loopback HTTP declarations even when the exact host or exact
host-plus-port is listed. The development manifest therefore uses
`requiredPermissions.network.domains: "all"`. The MCP bridge server itself still binds
only to `127.0.0.1`, so the transport remains local to the machine.

After any permission change, use **Unload → Load**, not only Reload; manifest permissions
are snapshotted when the plugin is loaded. Confirm that `/health` shows
`plugin_connected: true` before running `photoshop_save_document` or a Neural Filter.

`photoshop_save_document` never falls back to COM/ExtendScript. If the bridge is not
connected it fails closed with `uxp_bridge_unavailable`, which avoids reintroducing the
foreground-stealing persistence path.

### `photoshop_execute_script` returns `Result: undefined`

**Symptom:** The tool succeeds but the result text is `"undefined"`, or you assume the script did not run.

**Cause:** ExtendScript runs inside a server-side IIFE wrapper. Without an explicit `return`, the inner block evaluates to `undefined` — side effects (layer renames, property changes, etc.) may still have applied.

**Fix:** Add an explicit return in your script:

```javascript
photoshop_execute_script({
  code: `
    app.activeDocument.activeLayer.name = "Updated";
    return { ok: true };
  `
})
```

See also the `photoshop_execute_script` section in [`docs/available-tools.md`](available-tools.md).

### Web UI: `401 unauthorized` from `/api/*`

**Symptom:** The UI shows "Session token rejected...", or a script calling `/api/*` gets `{"error":"unauthorized"}`.

**Cause:** The UI server holds your LLM provider API keys and can drive Photoshop, so every `/api/*` request must present the token generated when the server starts. The browser gets it automatically because the server injects it into `index.html`; anything else must send it explicitly.

**Fix:**

- In the browser: reload the page from the URL printed by `photoshop-mcp-ui`. An old tab kept open across a server restart carries the previous token.
- From a script: read the token from `~/.photoshop-mcp/ui-session.json` (chmod 600) and send it as a header.

```bash
TOKEN=$(node -p "require('$HOME/.photoshop-mcp/ui-session.json').token")
curl -H "x-psmcp-token: $TOKEN" http://127.0.0.1:5174/api/status
```

`Authorization: Bearer $TOKEN` works too. Set `PSMCP_UI_TOKEN` before starting the server to pin a known token instead.

### Web UI: `403 invalid_host` or `403 invalid_origin`

**Cause:** Two guards that run before the token check. `invalid_host` means the `Host` header did not resolve to the loopback address (or the `--host` you bound to) on the server's port — this is what blocks DNS rebinding. `invalid_origin` means the request came from a different origin than the UI itself.

**Fix:** Reach the UI through the exact URL the CLI printed (`http://127.0.0.1:<port>`), not through a hostname that merely points at your machine, and not from a page served on another port.

### Debug Logging

Enable detailed logging by setting `LOG_LEVEL=0`:

```json
{
  "env": {
    "LOG_LEVEL": "0"
  }
}
```
