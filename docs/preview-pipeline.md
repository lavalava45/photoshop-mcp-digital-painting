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

The preview is still generated only once in Photoshop. Node reads that same
temporary JPEG buffer, writes it to `materialize_path`, returns the materialized
path in the metadata, and then removes Photoshop's temporary file.

`materialize_path` must be an absolute path. Missing parent directories are
created automatically. The tool does not modify the source document.

## Chat On Steroids Core workflow

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

This is the recommended verification loop for the project's Core + direct
stdio workflow:

```text
Photoshop edit
→ photoshop_get_preview (materialize_path, include_image=false)
→ local preview JPEG
→ visual inspection
→ next semantic pass
```

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
