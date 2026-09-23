import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ['dist/index.js'],
  env: {
    ...process.env,
    ...(process.env.PHOTOSHOP_PATH ? { PHOTOSHOP_PATH: process.env.PHOTOSHOP_PATH } : {}),
  },
});

const client = new Client({ name: 'preview-pipeline-smoke', version: '1.0.0' });
let tempDir;

function metadataFrom(result) {
  const text = result?.content?.find((item) => item.type === 'text')?.text;
  if (!text) throw new Error('Tool returned no metadata text');
  const parsed = JSON.parse(text);
  if (result.isError || parsed.ok === false) throw new Error(text);
  return parsed;
}

function assertJpeg(buffer, label) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    throw new Error(`${label} is not a JPEG buffer`);
  }
}

try {
  await client.connect(transport);

  const docsResult = await client.callTool({ name: 'photoshop_list_documents', arguments: {} });
  const docs = metadataFrom(docsResult);
  const requestedDocumentId = Number(process.env.PHOTOSHOP_TEST_DOCUMENT_ID);
  const documentId = Number.isFinite(requestedDocumentId) && requestedDocumentId > 0
    ? Math.trunc(requestedDocumentId)
    : docs.details?.active_document_id;
  if (typeof documentId !== 'number') throw new Error('Open a Photoshop document before running this smoke test');

  const richResult = await client.callTool({
    name: 'photoshop_get_preview',
    arguments: {
      document_id: documentId,
      max_dimension_px: 384,
      quality: 7,
      focus_region: { left: 0, top: 0, right: 128, bottom: 128 },
      focus_max_dimension_px: 512,
    },
  });
  const richMetadata = metadataFrom(richResult);
  const imageBlocks = richResult.content?.filter((item) => item.type === 'image') ?? [];
  const imageBlock = imageBlocks[0];
  if (!imageBlock?.data) throw new Error('Default preview response is missing MCP image content');
  if (imageBlocks.length !== 2) throw new Error(`Expected overview + focus image blocks, got ${imageBlocks.length}`);
  if (!richMetadata.focus?.sha256) throw new Error('Focus preview metadata is missing');
  const richBuffer = Buffer.from(imageBlock.data, 'base64');
  assertJpeg(richBuffer, 'MCP image block');
  if (richBuffer.length !== richMetadata.bytes) {
    throw new Error(`Image block byte count mismatch: ${richBuffer.length} != ${richMetadata.bytes}`);
  }

  tempDir = await mkdtemp(join(tmpdir(), 'photoshop-mcp-preview-'));
  const materializedPath = join(tempDir, 'preview.jpg');
  const fileResult = await client.callTool({
    name: 'photoshop_get_preview',
    arguments: {
      document_id: documentId,
      max_dimension_px: 384,
      quality: 7,
      materialize_path: materializedPath,
      include_image: false,
      focus_region: { left: 0, top: 0, right: 128, bottom: 128 },
      focus_max_dimension_px: 512,
    },
  });
  const fileMetadata = metadataFrom(fileResult);
  if (fileResult.content?.some((item) => item.type === 'image')) {
    throw new Error('include_image=false unexpectedly returned an image block');
  }
  const materialized = await readFile(materializedPath);
  assertJpeg(materialized, 'Materialized preview');
  const sha256 = createHash('sha256').update(materialized).digest('hex');
  if (sha256 !== fileMetadata.sha256) {
    throw new Error(`Materialized preview SHA-256 mismatch: ${sha256} != ${fileMetadata.sha256}`);
  }
  if (fileMetadata.materialized_path !== materializedPath) {
    throw new Error(`Unexpected materialized path: ${fileMetadata.materialized_path}`);
  }
  const focusPath = fileMetadata.focus?.materialized_path;
  if (typeof focusPath !== 'string') throw new Error('Materialized focus path is missing');
  const focusBuffer = await readFile(focusPath);
  assertJpeg(focusBuffer, 'Materialized focus preview');
  const focusSha256 = createHash('sha256').update(focusBuffer).digest('hex');
  if (focusSha256 !== fileMetadata.focus.sha256) {
    throw new Error(`Materialized focus SHA-256 mismatch: ${focusSha256} != ${fileMetadata.focus.sha256}`);
  }

  console.log('PREVIEW_PIPELINE_TEST_OK');
} finally {
  await client.close().catch(() => {});
  if (tempDir) await rm(tempDir, { recursive: true, force: true }).catch(() => {});
}
