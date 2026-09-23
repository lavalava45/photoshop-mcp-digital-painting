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
const backendSource = await readFile(path.join(root, 'src', 'platform', 'photoshop-backend.ts'), 'utf8');
const legacySource = await readFile(path.join(root, 'src', 'api', 'extendscript.ts'), 'utf8');

const tools = createColorSamplingTools({});
assert(tools.length === 2, 'Expected exactly two color-sampling tools');
const tool = tools.find((entry) => entry.tool.name === 'photoshop_sample_color').tool;
const batchTool = tools.find((entry) => entry.tool.name === 'photoshop_sample_colors').tool;
assert(tool.name === 'photoshop_sample_color', 'Expected photoshop_sample_color');
assert(batchTool.name === 'photoshop_sample_colors', 'Expected photoshop_sample_colors');
assert(tool.inputSchema.required.includes('x') && tool.inputSchema.required.includes('y'), 'x/y must be required');
assert(tool.inputSchema.properties.radius.minimum === 0, 'radius minimum should be 0');
assert(tool.inputSchema.properties.radius.maximum === 100, 'radius maximum should be 100');

assert(source.includes('new PhotoshopBackendRouter(connection)'), 'Color sampling should route through PhotoshopBackendRouter');
assert(source.includes('backendRouter.sampleColor('), 'Single sampling should dispatch through the semantic backend router');
assert(source.includes('backendRouter.sampleColors('), 'Batch sampling should dispatch through the semantic backend router');
assert(backendSource.includes("backendFor('color.sample')"), 'Single sampling should select its backend before dispatch');
assert(backendSource.includes("backendFor('colors.sample')"), 'Batch sampling should select its backend before dispatch');

// Retain regression coverage for the legacy fallback implementation without
// requiring that fallback mechanism from the UXP-first public path.
assert(legacySource.includes("duplicate('__MCP_COLOR_SAMPLE__'"), 'Legacy single-sample fallback should use a temporary duplicate');
assert(legacySource.includes('colorSamplers.add'), 'Legacy point sampling should use a Color Sampler on the duplicate');
assert(legacySource.includes('activeLayer.applyAverage()'), 'Legacy average mode should use Photoshop Average on the duplicate');
assert(legacySource.includes('SaveOptions.DONOTSAVECHANGES'), 'Legacy temporary duplicate must close without saving');
assert(legacySource.includes("mode: __mcpRadius > 0 ? 'AVERAGE' : 'POINT'"), 'Legacy result should identify sample mode');
assert(legacySource.includes("hex: '#'"), 'Legacy result should include HEX color');
assert(legacySource.includes("mode: 'POINT_BATCH'"), 'Legacy batch sampler should identify POINT_BATCH mode');
assert(batchTool.inputSchema.properties.points.maxItems === 1024, 'Batch sampler should allow up to 1024 points');

const invalidConnection = {
  async getVersion() { return '2026'; },
  async executeScript() { throw new Error('connection should not be used for invalid input'); },
};
const invalidHandler = createColorSamplingTools(invalidConnection)[0].handler;
for (const radius of [-1, 1.5, 101]) {
  const result = await invalidHandler({ x: 10, y: 10, radius });
  assert(result.isError === true, `radius=${radius} should fail validation`);
}

const invalidBatchHandler = createColorSamplingTools(invalidConnection)[1].handler;
const emptyBatch = await invalidBatchHandler({ points: [] });
assert(emptyBatch.isError === true, 'empty points batch should fail validation');

console.log('COLOR_SAMPLING_TEST_OK');
