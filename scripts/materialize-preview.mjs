import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

function getArg(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const requestedDocumentId = Number(getArg('--document-id', process.env.PHOTOSHOP_TEST_DOCUMENT_ID));
const maxDimension = Number(getArg('--max-dimension', '1024'));
const quality = Number(getArg('--quality', '8'));
const outputPath = resolve(getArg('--output', '.mcp-preview/latest.jpg'));

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ['dist/index.js'],
  env: {
    ...process.env,
    ...(process.env.PHOTOSHOP_PATH ? { PHOTOSHOP_PATH: process.env.PHOTOSHOP_PATH } : {}),
  },
});

const client = new Client({ name: 'preview-materializer', version: '1.0.0' });

function parseText(result) {
  const text = result?.content?.find((item) => item.type === 'text')?.text;
  if (!text) throw new Error('photoshop_get_preview returned no metadata text');
  const parsed = JSON.parse(text);
  if (result.isError || parsed.ok === false) throw new Error(text);
  return parsed;
}

try {
  await client.connect(transport);

  let documentId = Number.isFinite(requestedDocumentId) && requestedDocumentId > 0
    ? Math.trunc(requestedDocumentId)
    : undefined;

  if (!documentId) {
    const docsResult = await client.callTool({ name: 'photoshop_list_documents', arguments: {} });
    const docs = parseText(docsResult);
    documentId = docs.details?.active_document_id;
  }

  if (typeof documentId !== 'number') {
    throw new Error('Open a Photoshop document or pass --document-id <id>');
  }

  const result = await client.callTool({
    name: 'photoshop_get_preview',
    arguments: {
      document_id: documentId,
      max_dimension_px: maxDimension,
      quality,
      materialize_path: outputPath,
      include_image: false,
    },
  });
  const metadata = parseText(result);

  console.log(`PREVIEW_PATH=${metadata.materialized_path}`);
  console.log(`PREVIEW_DOCUMENT_ID=${documentId}`);
  console.log(`PREVIEW_SIZE=${metadata.width}x${metadata.height}`);
  console.log(`PREVIEW_BYTES=${metadata.bytes}`);
  console.log(`PREVIEW_SHA256=${metadata.sha256}`);
} finally {
  await client.close().catch(() => {});
}
