import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(root, 'dist', 'index.js')],
  cwd: root,
  env: {
    ...process.env,
    ANALYTICS_DISABLED: '1',
  },
  stderr: 'inherit',
});
const client = new Client({ name: 'painting-tools-test', version: '0.1.0' });
const call = async (name, args = {}) => {
  const result = await client.callTool({ name, arguments: args });
  console.log(`\n## ${name}\n${JSON.stringify(result, null, 2)}`);
  if (result.isError) throw new Error(`${name} failed`);
  return result;
};

try {
  await client.connect(transport);
  const tools = await client.listTools();
  const painting = tools.tools.filter((t) => t.name.includes('brush') || t.name.includes('paint_strokes') || t.name.includes('foreground_color'));
  console.log('PAINTING_TOOLS', painting.map((t) => t.name));
  await call('photoshop_list_brush_presets', { query: 'Hard Round', limit: 20 });
  await call('photoshop_select_brush_preset', { name: 'Hard Round Pressure Size' });
  await call('photoshop_create_document', { width: 800, height: 520, resolution: 72, colorMode: 'RGB' });
  await call('photoshop_create_layer', { name: 'Digital Painting API Test' });
  await call('photoshop_set_foreground_color', { red: 20, green: 20, blue: 20 });
  await call('photoshop_set_brush', {
    size: 28,
    hardness: 65,
    opacity: 72,
    flow: 55,
    spacing: 18,
    use_pressure_size: true,
    use_pressure_opacity: true,
    airbrush: true,
    smoothing_enabled: true,
    smoothing: 37,
  });
  await call('photoshop_get_brush_settings');
  await call('photoshop_paint_strokes', {
    strokes: [
      { points: [{ x: 90, y: 120 }, { x: 710, y: 120 }], tool: 'BRUSH' },
      { points: [{ x: 90, y: 260 }, { x: 710, y: 260 }], tool: 'BRUSH', simulate_pressure: true },
      {
        points: [
          { x: 90, y: 420, right: [240, 320], smooth: true },
          { x: 400, y: 340, left: [260, 340], right: [540, 340], smooth: true },
          { x: 710, y: 420, left: [560, 320], smooth: true }
        ],
        tool: 'BRUSH'
      },
      {
        points: [{ x: 400, y: 455 }],
        tool: 'BRUSH',
        color: { red: 180, green: 70, blue: 65 },
        size: 34,
        opacity: 80,
        flow: 75,
      },
    ]
  });
  console.log('\nPAINTING_TEST_OK');
} finally {
  await client.close();
}
