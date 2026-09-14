import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { callToolWithTimeout } from './mcp-request-options.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const previewPath = path.join(root, '.mcp-preview', 'painting-batching-live.jpg');

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(root, 'dist', 'index.js')],
  cwd: root,
  env: {
    ...process.env,
    ANALYTICS_DISABLED: '1',
    ...(process.env.PHOTOSHOP_PATH ? { PHOTOSHOP_PATH: process.env.PHOTOSHOP_PATH } : {}),
  },
  stderr: 'inherit',
});

const client = new Client({ name: 'painting-batching-live-test', version: '1.0.0' });

function parseStructured(result) {
  const text = result?.content?.find((item) => item.type === 'text')?.text;
  if (!text) throw new Error('Tool returned no text payload');
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function call(name, args = {}) {
  const result = await callToolWithTimeout(client, { name, arguments: args });
  if (result.isError) {
    const text = result?.content?.find((item) => item.type === 'text')?.text;
    throw new Error(`${name} failed: ${text ?? 'unknown error'}`);
  }
  return { result, parsed: parseStructured(result) };
}

function parseCustomScriptResult(text) {
  if (typeof text !== 'string') return null;
  const marker = 'Result: ';
  const index = text.indexOf(marker);
  if (index < 0) return null;
  const raw = text.slice(index + marker.length).trim();
  let unwrapped = raw;
  try {
    unwrapped = JSON.parse(raw);
  } catch {}
  if (typeof unwrapped !== 'string') return unwrapped;
  try {
    return new Function(`return ${unwrapped}`)();
  } catch {
    return null;
  }
}

let tempDocumentId = null;
let initialBrush = null;
let initialForeground = null;

try {
  await client.connect(transport);

  const brush = await call('photoshop_get_brush_settings');
  initialBrush = brush.parsed?.details?.settings ?? null;

  const fg = await call('photoshop_execute_script', {
    code: `var c = app.foregroundColor.rgb; return {red:Number(c.red),green:Number(c.green),blue:Number(c.blue)};`,
  });
  initialForeground = parseCustomScriptResult(fg.parsed);

  await call('photoshop_create_document', { width: 900, height: 560, resolution: 72, colorMode: 'RGB' });
  const docs = await call('photoshop_list_documents');
  tempDocumentId = docs.parsed?.details?.active_document_id;
  if (typeof tempDocumentId !== 'number') throw new Error('Could not resolve temporary document id');

  await call('photoshop_create_layer', { document_id: tempDocumentId, name: 'Batching Dynamics Live Test' });
  await call('photoshop_set_brush', {
    document_id: tempDocumentId,
    size: 16,
    hardness: 80,
    opacity: 100,
    flow: 100,
    smoothing_enabled: false,
  });

  const mixed = Array.from({ length: 24 }, (_, i) => ({
    tool: 'BRUSH',
    points: [
      { x: 40, y: 30 + i * 16 },
      { x: 410, y: 30 + i * 16 },
    ],
    color: {
      red: 20 + ((i * 29) % 180),
      green: 30 + ((i * 17) % 160),
      blue: 40 + ((i * 11) % 140),
    },
    size: 4 + (i % 9) * 2,
    opacity: 35 + (i % 6) * 10,
    flow: 40 + (i % 5) * 12,
  }));

  const mixedResult = await call('photoshop_paint_strokes', {
    document_id: tempDocumentId,
    batch_mode: 'AUTO',
    strokes: mixed,
  });
  if (mixedResult.parsed?.details?.stroke_count !== 24) {
    throw new Error(`Expected 24 semantic strokes, got ${mixedResult.parsed?.details?.stroke_count}`);
  }
  if (!(mixedResult.parsed?.details?.batch_count > 1)) {
    throw new Error(`Expected AUTO to chunk the heterogeneous batch, got ${mixedResult.parsed?.details?.batch_count}`);
  }

  const dynamicResult = await call('photoshop_paint_strokes', {
    document_id: tempDocumentId,
    strokes: [{
      tool: 'BRUSH',
      color: { red: 20, green: 20, blue: 20 },
      points: [
        { x: 500, y: 430, right: [610, 250], smooth: true },
        { x: 830, y: 120, left: [720, 300], smooth: true },
      ],
      dynamics: {
        size: [46, 4],
        opacity: [100, 20],
        flow: [90, 35],
        steps: 32,
        easing: 'EASE_OUT',
      },
    }],
  });
  if (dynamicResult.parsed?.details?.render_stroke_count !== 32) {
    throw new Error(`Expected 32 render segments, got ${dynamicResult.parsed?.details?.render_stroke_count}`);
  }

  const preview = await call('photoshop_get_preview', {
    document_id: tempDocumentId,
    max_dimension_px: 1024,
    quality: 9,
    materialize_path: previewPath,
    include_image: false,
  });
  if (preview.parsed?.materialized_path !== previewPath) {
    throw new Error('Preview was not materialized to the expected path');
  }

  console.log(JSON.stringify({
    mixed: mixedResult.parsed?.details,
    dynamic: dynamicResult.parsed?.details,
    preview: preview.parsed,
  }, null, 2));
  console.log('PAINTING_BATCHING_LIVE_TEST_OK');
} finally {
  if (tempDocumentId !== null) {
    await callToolWithTimeout(client, {
      name: 'photoshop_close_document',
      arguments: { document_id: tempDocumentId, save: false },
    }).catch(() => {});
  }
  if (initialBrush) {
    const restore = {
      size: initialBrush.size,
      hardness: initialBrush.hardness,
      opacity: initialBrush.opacity,
      flow: initialBrush.flow,
      spacing: initialBrush.spacing,
      angle: initialBrush.angle,
      roundness: initialBrush.roundness,
      flip_x: initialBrush.flip_x,
      flip_y: initialBrush.flip_y,
      use_pressure_size: initialBrush.use_pressure_size,
      use_pressure_opacity: initialBrush.use_pressure_opacity,
      airbrush: initialBrush.airbrush,
      smoothing_enabled: initialBrush.smoothing_enabled,
      smoothing: initialBrush.smoothing,
    };
    await callToolWithTimeout(client, { name: 'photoshop_set_brush', arguments: restore }).catch(() => {});
  }
  if (initialForeground && Number.isFinite(initialForeground.red)) {
    await callToolWithTimeout(client, {
      name: 'photoshop_set_foreground_color',
      arguments: initialForeground,
    }).catch(() => {});
  }
  await client.close().catch(() => {});
}
