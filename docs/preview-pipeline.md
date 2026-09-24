# Preview Pipeline

`photoshop_get_preview` already returns a standard MCP `image` content block.
That is the preferred path for MCP hosts that render image content directly.

For terminal-oriented direct-stdio workflows such as Chat On Steroids Core,
the same tool can also materialize the generated JPEG to a caller-selected
path. This avoids a second Photoshop export/save call just so the agent can
inspect the image from the local filesystem.

## Tool behavior

Default behavior is unchanged:

```json
{
  "max_dimension_px": 1024,
  "quality": 8
}
```

The result contains:

- one MCP `image` content block containing the JPEG as base64;
- one text metadata block containing width, height and byte size.

For local work, add a document-space crop:

```json
{
  "max_dimension_px": 1000,
  "focus_region": { "left": 420, "top": 180, "right": 760, "bottom": 520 },
  "focus_max_dimension_px": 1200
}
```

The canonical whole-document frame remains the top-level preview and SHA used by
the hard preview barrier. The local crop is returned as `focus` metadata plus a
second image block (or `*-focus.jpg` when materialized). Its coordinates remain in
source-document pixels, so planning and correction coordinates do not depend on the
overview downscale.

For a terminal/direct-stdio client, pass an absolute `materialize_path` and set
`include_image` to `false`:

```json
{
  "document_id": 42,
  "max_dimension_px": 1024,
  "quality": 8,
  "materialize_path": "C:\\work\\preview.jpg",
  "include_image": false
}
```

The canonical preview is generated once. When `focus_region` is requested, a second
read-only crop export is generated in the same MCP tool call. Node materializes both
and removes Photoshop's temporary files.

`materialize_path` must be an absolute path. Missing parent directories are
created automatically. The tool does not modify the source document.

## Guard multiscale visual review

The compact-v2 Guard now resolves a deterministic minimum review profile before a visual pass:

- **COMPOSITION** — mandatory whole-frame context, Guard target long edge 1600 px, no crop tax;
- **OBJECT** — the same whole-frame context plus an exact source-document focus crop, target long
  edge 1200 px;
- **MICRO** — whole-frame context plus exact local evidence at target long edge 1600 px.

The standalone `photoshop_get_preview` defaults above are unchanged. The 1600/1200 values are Guard
policy for artistic review, not new global tool defaults. Existing local/detail VisualMicroPlan
significance guarantees remain stronger where applicable: small/local/detail/micro work and
`subtle_local` continue to use matching BEFORE/AFTER focus evidence rather than weakening the
existing pixel-change contract.

All review regions are expressed in source Photoshop document pixels. Guard preserves the semantic
`requested_region` separately from the actual `effective_region`. Read-only escalation crops use a
deterministic context pad (OBJECT 12%, minimum 24 px per side; MICRO 6%, minimum 12 px per side),
clamped only at canvas edges. Preview downscaling never rewrites the source coordinates.

If an overview/object review discovers a structured local problem that was not already covered by
adequate evidence, compact `previous_observation.review_findings[]` may provide an exact region. The
Guard then keeps the **same artistic operation pending**, captures at most two required crops in that
review round, binds them to the same document id and whole-frame SHA, returns those image blocks, and
asks for another observation for the same `previous_operation_id`. It does not replay the mutation or
dispatch `next_pass` while that evidence debt remains open. A changed whole-frame SHA, document id or
requested region requires fresh crop evidence.

This extension is additive to `photoshop.guard.compact.v2`; it does not introduce a second preview
renderer, controller, state store or closure protocol.

## Retiring direct-stdio preview helper

The repository includes a small direct-stdio helper:

```powershell
node scripts/materialize-preview.mjs --document-id 42 --max-dimension 1024 --quality 8
```

By default it writes:

```text
.mcp-preview/latest.jpg
```

The `.mcp-preview/` directory is git-ignored. The helper prints the resulting
path, document id, dimensions, byte size and SHA-256 digest. The resulting JPEG
can then be opened directly with the host's local file/image reader.

This helper may remain useful to isolated tests while the Core/controller dependencies
are migrated, but it is not a supported agent workflow and must not receive new
dependencies. Ordinary Chat On Steroids Photoshop work uses the native Plugins +
embedded-Guard route:

```text
Photoshop edit
→ photoshop_get_preview (overview + optional document-space focus crop)
→ inspect overview and local evidence
→ visual inspection
→ next semantic pass
```

For painting, `photoshop_execute_visual_microplan` can place one read-only preview
immediately before its single mutation and the mandatory preview immediately after.
With the same `focus_region`, the caller receives a direct before/after local comparison
inside one external MCP action; only the final canonical frame participates in the
next-mutation barrier.

It replaces the older workaround of calling `photoshop_get_preview`, seeing
only its text metadata in a terminal helper, and then issuing a separate
Photoshop JPEG export purely for inspection.

## Validation

With Photoshop running and a document open:

```powershell
node scripts/test-preview-pipeline.mjs
```

The smoke test verifies both paths:

1. default `photoshop_get_preview` returns a valid MCP image block;
2. materialized mode writes a JPEG from the same preview pipeline without
   returning the large base64 image block.

A successful run prints:

```text
PREVIEW_PIPELINE_TEST_OK
```
