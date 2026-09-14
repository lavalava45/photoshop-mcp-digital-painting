# Layer API consistency

The layer API is being normalized so that layer discovery, selection and
ordering use the same addressing model and the same structured MCP result
shape.

## Addressing model

`photoshop_get_layers` recursively enumerates layers inside groups and now
returns, when Photoshop exposes them:

- `id` — Photoshop's internal layer id;
- `path` — slash-separated group/layer path;
- `depth` — nesting depth;
- `typename`, `kind`, visibility, opacity and blend mode.

For ordering operations, `targetLayerId` is preferred over a layer name because
names can be duplicated. Name lookup remains available for compatibility and is
recursive, matching the visibility of `photoshop_get_layers`.

`photoshop_move_layer_to_position` uses these rules:

- `ABOVE` / `BELOW` require `targetLayerId` or `targetLayerName`;
- `TOP` / `BOTTOM` do not require a target and stay inside the active layer's
  current parent stack;
- `targetLayerId` wins when both id and name are supplied.

Likewise, `photoshop_move_layer_up`, `photoshop_move_layer_down`,
`photoshop_move_layer_to_top`, and `photoshop_move_layer_to_bottom` operate
within the active layer's current document/group parent. Nested layers are not
silently treated as top-level layers and are not pulled out of their group by a
simple up/down/top/bottom operation.

## Result contract

Core layer creation/listing/selection/ordering handlers return the same JSON
success envelope used by newer atomic tools:

```json
{
  "ok": true,
  "summary": "...",
  "details": { "...": "..." },
  "next_suggested_tool": "..."
}
```

This replaces older plain-text responses such as `Layer created: ...`, which
were difficult for direct-stdio clients to parse reliably.

## Offline regression test

The consistency work can be tested without opening or controlling Photoshop:

```powershell
npm run build:server
node scripts/test-layer-api-contracts.mjs
```

The test uses a fake connection and generated ExtendScript strings. It checks
recursive lookup, id/path metadata, move-tool schema semantics and structured
success/error envelopes. It does not launch Photoshop or execute a script in a
live document.

A successful run prints:

```text
LAYER_API_CONTRACT_TEST_OK
```
