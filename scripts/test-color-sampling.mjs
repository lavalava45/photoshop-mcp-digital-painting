import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createColorSamplingTools } from '../dist/tools/color-sampling-tools.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const source = await readFile(path.join(root, 'src', 'tools', 'color-sampling-tools.ts'), 'utf8');

const tools = createColorSamplingTools({});
assert(tools.length === 1, 'Expected exactly one color-sampling tool');
const tool = tools[0].tool;
assert(tool.name === 'photoshop_sample_color', 'Expected photoshop_sample_color');
assert(tool.inputSchema.required.includes('x') && tool.inputSchema.required.includes('y'), 'x/y must be required');
assert(tool.inputSchema.properties.radius.minimum === 0, 'radius minimum should be 0');
assert(tool.inputSchema.properties.radius.maximum === 100, 'radius maximum should be 100');

assert(source.includes("duplicate('__MCP_COLOR_SAMPLE__'"), 'Sampling should use a temporary duplicate');
assert(source.includes('colorSamplers.add'), 'Point sampling should use a Color Sampler on the duplicate');
assert(source.includes('activeLayer.applyAverage()'), 'Average mode should use Photoshop Average on the duplicate');
assert(source.includes('SaveOptions.DONOTSAVECHANGES'), 'Temporary duplicate must close without saving');
assert(source.includes("mode: __mcpRadius > 0 ? 'AVERAGE' : 'POINT'"), 'Result should identify sample mode');
assert(source.includes("hex: '#'"), 'Result should include HEX color');

const invalidConnection = {
  async getVersion() { return '2026'; },
  async executeScript() { throw new Error('connection should not be used for invalid input'); },
};
const invalidHandler = createColorSamplingTools(invalidConnection)[0].handler;
for (const radius of [-1, 1.5, 101]) {
  const result = await invalidHandler({ x: 10, y: 10, radius });
  assert(result.isError === true, `radius=${radius} should fail validation`);
}

console.log('COLOR_SAMPLING_TEST_OK');

