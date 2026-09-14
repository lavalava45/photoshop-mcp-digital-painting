import assert from 'node:assert/strict';
import { createMeasurementTools } from '../dist/tools/measurement-tools.js';

function toolByName(name) {
  const tools = createMeasurementTools({});
  const entry = tools.find((item) => item.tool.name === name);
  assert(entry, `Missing tool: ${name}`);
  return entry;
}

function parseResult(result) {
  assert(result?.content?.[0]?.type === 'text', 'Expected text result');
  return JSON.parse(result.content[0].text);
}

const transformTool = toolByName('photoshop_transform_landmarks');
const compareTool = toolByName('photoshop_compare_landmarks');

const referencePoints = [
  { name: 'eyeL', x: 640, y: 865 },
  { name: 'eyeR', x: 1000, y: 825 },
  { name: 'nose', x: 835, y: 1090 },
  { name: 'mouth', x: 835, y: 1315 },
  { name: 'chin', x: 805, y: 1510 },
];

const sourceFrame = { left: 560, top: 365, right: 1110, bottom: 1510 };
const targetFrame = { left: 310.8, top: 245, right: 593.2, bottom: 833 };

const transformedResult = parseResult(await transformTool.handler({
  points: referencePoints,
  source_frame: sourceFrame,
  target_frame: targetFrame,
}));

assert.equal(transformedResult.ok, true);
assert.equal(transformedResult.details.landmark_detection, false);
assert.equal(transformedResult.details.points.length, referencePoints.length);

const expectedEyeL = transformedResult.details.points.find((p) => p.name === 'eyeL');
assert(expectedEyeL);
assert(Math.abs(expectedEyeL.x - 351.87636363636364) < 1e-9);
assert(Math.abs(expectedEyeL.y - 501.7685589519651) < 1e-9);

const compareResult = parseResult(await compareTool.handler({
  reference_points: referencePoints,
  reference_frame: sourceFrame,
  candidate_points: transformedResult.details.points,
  candidate_frame: targetFrame,
}));

assert.equal(compareResult.ok, true);
assert.equal(compareResult.details.compared_count, referencePoints.length);
assert(compareResult.details.summary.rmse < 1e-12);
assert(compareResult.details.summary.max_error < 1e-12);

const shifted = transformedResult.details.points.map((p) =>
  p.name === 'mouth' ? { ...p, x: p.x + 10, y: p.y - 5 } : p
);
shifted.push({ name: 'extra', x: 0, y: 0 });

const shiftedResult = parseResult(await compareTool.handler({
  reference_points: referencePoints,
  reference_frame: sourceFrame,
  candidate_points: shifted,
  candidate_frame: targetFrame,
}));

assert.equal(shiftedResult.ok, true);
assert.equal(shiftedResult.details.summary.max_error_point, 'mouth');
assert.deepEqual(shiftedResult.details.extra_in_candidate, ['extra']);
assert(shiftedResult.details.summary.max_error > 0);

const invalidFrame = parseResult(await transformTool.handler({
  points: referencePoints,
  source_frame: { left: 10, top: 0, right: 10, bottom: 20 },
  target_frame: targetFrame,
}));
assert.equal(invalidFrame.ok, false);
assert.equal(invalidFrame.isError, undefined);

const noShared = await compareTool.handler({
  reference_points: [{ name: 'a', x: 1, y: 1 }],
  reference_frame: { left: 0, top: 0, right: 10, bottom: 10 },
  candidate_points: [{ name: 'b', x: 1, y: 1 }],
  candidate_frame: { left: 0, top: 0, right: 10, bottom: 10 },
});
assert.equal(noShared.isError, true);

console.log('LANDMARK_ERGONOMICS_TEST_OK');
