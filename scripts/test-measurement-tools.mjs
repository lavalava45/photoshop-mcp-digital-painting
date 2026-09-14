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

const client = new Client({ name: 'measurement-tools-smoke', version: '1.0.0' });
let createdDocumentId = null;

function parseToolResult(result) {
  const text = result?.content?.find((item) => item.type === 'text')?.text;
  if (!text) throw new Error('Tool returned no text payload');
  const parsed = JSON.parse(text);
  if (result.isError || parsed.ok === false) throw new Error(text);
  return parsed;
}

async function call(name, args = {}) {
  return parseToolResult(await client.callTool({ name, arguments: args }));
}

async function callExpectError(name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  const text = result?.content?.find((item) => item.type === 'text')?.text;
  if (!result.isError) throw new Error(`${name} unexpectedly succeeded`);
  return text ? JSON.parse(text) : null;
}

try {
  await client.connect(transport);
  const tools = (await client.listTools()).tools.map((tool) => tool.name);
  for (const required of [
    'photoshop_measure_points',
    'photoshop_add_guides',
    'photoshop_list_guides',
    'photoshop_clear_guides',
    'photoshop_transform_landmarks',
    'photoshop_compare_landmarks',
  ]) {
    if (!tools.includes(required)) throw new Error(`Missing measurement tool: ${required}`);
  }

  const docs = await call('photoshop_list_documents');
  const requestedDocumentId = Number(process.env.PHOTOSHOP_TEST_DOCUMENT_ID);
  let documentId;
  if (Number.isFinite(requestedDocumentId) && requestedDocumentId > 0) {
    documentId = Math.trunc(requestedDocumentId);
  } else {
    const created = await client.callTool({
      name: 'photoshop_create_document',
      arguments: { width: 320, height: 240, resolution: 72, colorMode: 'RGB' },
    });
    if (created.isError) throw new Error('Failed to create temporary Photoshop document for measurement smoke test');
    const afterCreate = await call('photoshop_list_documents');
    documentId = afterCreate.details?.active_document_id;
    createdDocumentId = documentId;
  }
  if (typeof documentId !== 'number') throw new Error('Open a Photoshop document before running this smoke test');

  const initial = await call('photoshop_list_guides', { document_id: documentId });
  const initialCount = initial.details?.guide_count ?? 0;

  await callExpectError('photoshop_add_guides', {
    document_id: documentId,
    guides: [
      { orientation: 'VERTICAL', position: 5 },
      { orientation: 'VERTICAL', position: 999999 },
    ],
  });
  const afterRejectedBatch = await call('photoshop_list_guides', { document_id: documentId });
  if ((afterRejectedBatch.details?.guide_count ?? 0) !== initialCount) {
    throw new Error('Rejected guide batch changed the document');
  }

  const added = await call('photoshop_add_guides', {
    document_id: documentId,
    guides: [
      { orientation: 'VERTICAL', position: 10 },
      { orientation: 'HORIZONTAL', position: 20 },
    ],
  });
  if ((added.details?.guide_count ?? 0) !== initialCount + 2) {
    throw new Error('Guide count did not increase by 2');
  }

  const measured = await call('photoshop_measure_points', {
    document_id: documentId,
    points: [
      { name: 'a', x: 0, y: 0 },
      { name: 'b', x: 3, y: 4 },
      { name: 'c', x: 6, y: 8 },
    ],
    measurements: [
      { name: 'ab', from: 'a', to: 'b' },
      { name: 'ac', from: 'a', to: 'c' },
    ],
    ratios: [{ name: 'ab_over_ac', numerator: 'ab', denominator: 'ac' }],
  });
  const distance = measured.details?.measurements?.find((item) => item.name === 'ab')?.distance;
  const ratio = measured.details?.ratios?.find((item) => item.name === 'ab_over_ac')?.value;
  if (Math.abs(distance - 5) > 1e-9) throw new Error(`Expected 3-4-5 distance, got ${distance}`);
  if (Math.abs(ratio - 0.5) > 1e-9) throw new Error(`Expected ratio 0.5, got ${ratio}`);
  if (measured.details?.landmark_detection !== false) {
    throw new Error('Measurement result must explicitly report landmark_detection=false');
  }

  const sourceFrame = { left: 0, top: 0, right: 100, bottom: 200 };
  const targetFrame = { left: 10, top: 20, right: 210, bottom: 620 };
  const sourcePoints = [
    { name: 'p1', x: 25, y: 50 },
    { name: 'p2', x: 75, y: 150 },
  ];
  const transformed = await call('photoshop_transform_landmarks', {
    points: sourcePoints,
    source_frame: sourceFrame,
    target_frame: targetFrame,
  });
  const p1 = transformed.details?.points?.find((item) => item.name === 'p1');
  if (!p1 || Math.abs(p1.x - 60) > 1e-9 || Math.abs(p1.y - 170) > 1e-9) {
    throw new Error(`Unexpected transformed p1: ${JSON.stringify(p1)}`);
  }
  if (transformed.details?.landmark_detection !== false) {
    throw new Error('Transform result must explicitly report landmark_detection=false');
  }

  const compared = await call('photoshop_compare_landmarks', {
    reference_points: sourcePoints,
    reference_frame: sourceFrame,
    candidate_points: transformed.details.points,
    candidate_frame: targetFrame,
  });
  if ((compared.details?.summary?.rmse ?? Infinity) > 1e-12) {
    throw new Error(`Expected zero landmark RMSE, got ${compared.details?.summary?.rmse}`);
  }
  if (compared.details?.landmark_detection !== false) {
    throw new Error('Comparison result must explicitly report landmark_detection=false');
  }

  const listed = await call('photoshop_list_guides', { document_id: documentId });
  const count = listed.details?.guide_count ?? 0;
  await call('photoshop_clear_guides', {
    document_id: documentId,
    indices: [count - 1, count - 2],
  });
  const final = await call('photoshop_list_guides', { document_id: documentId });
  if ((final.details?.guide_count ?? 0) !== initialCount) {
    throw new Error('Smoke-test guides were not restored to initial count');
  }

  console.log('MEASUREMENT_TEST_OK');
} finally {
  if (typeof createdDocumentId === 'number') {
    await client.callTool({
      name: 'photoshop_close_document',
      arguments: { document_id: createdDocumentId, save: false },
    }).catch(() => {});
  }
  await client.close().catch(() => {});
}
