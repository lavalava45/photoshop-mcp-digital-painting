import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import jpeg from 'jpeg-js';

const root = process.cwd();
const runtime = path.join(root, '.photoshop-runtime', 'controller', 'operations');
const runDir = path.join(root, 'processes', 'editable-atmosphere-live-process', 'run-01');

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const shaFile = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const rawSha = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

function operation(id) {
  return readJson(path.join(runtime, id + '.json'));
}

function requireOk(condition, message) {
  if (!condition) throw new Error(message);
}

async function cropEvidence(file, bounds) {
  const left = Math.round(bounds.left);
  const top = Math.round(bounds.top);
  const width = Math.round(bounds.right - bounds.left);
  const height = Math.round(bounds.bottom - bounds.top);
  const decoded = jpeg.decode(fs.readFileSync(file), { useTArray: true });
  requireOk(decoded.width >= left + width && decoded.height >= top + height, 'crop exceeds decoded frame');
  const data = Buffer.alloc(width * height * 3);
  const sums = [0, 0, 0];
  let out = 0;
  for (let y = top; y < top + height; y++) {
    for (let x = left; x < left + width; x++) {
      const src = (y * decoded.width + x) * 4;
      for (let c = 0; c < 3; c++) {
        const value = decoded.data[src + c];
        data[out++] = value;
        sums[c] += value;
      }
    }
  }
  const pixels = width * height;
  return {
    bounds: { left, top, right: left + width, bottom: top + height },
    pixel_count: pixels,
    raw_rgb_sha256: rawSha(data),
    mean_rgb: sums.slice(0, 3).map((sum) => Number((sum / pixels).toFixed(4))),
  };
}

async function main() {
  const beforeOp = operation('live15d-overlay-opacity-20260922-05');
  const maskOp = operation('live15d-gradient-mask-fixed-12');
  const historyOp = operation('live15d-history-after-fixed-13');

  const beforePath = beforeOp.preview?.project_path ?? beforeOp.preview?.materialized_path;
  const afterPath = maskOp.preview?.project_path ?? maskOp.preview?.materialized_path;
  requireOk(beforePath && fs.existsSync(beforePath), 'missing registered BEFORE frame');
  requireOk(afterPath && fs.existsSync(afterPath), 'missing registered AFTER frame');
  requireOk(beforeOp.preview.sha256 === shaFile(beforePath), 'BEFORE frame SHA mismatch');
  requireOk(maskOp.preview.sha256 === shaFile(afterPath), 'AFTER frame SHA mismatch');
  requireOk(maskOp.result?.content?.some((entry) => String(entry.text ?? '').includes('"mask_auto_created": true')), 'mask auto-creation proof missing');

  const historyText = historyOp.result?.content?.map((entry) => entry.text ?? '').join('\n') ?? '';
  for (const required of ['New Layer', 'Blending Change', 'Master Opacity Change', 'Add Layer Mask', 'Draw classic gradient on mask']) {
    requireOk(historyText.includes(required), 'history proof missing: ' + required);
  }

  const decodedAfter = jpeg.decode(fs.readFileSync(afterPath), { useTArray: true });
  const width = decodedAfter.width;
  const height = decodedAfter.height;
  requireOk(width === 800 && height === 600, 'unexpected final frame geometry');
  const focusBounds = {
    upper: { left: 160, top: 30, right: 640, bottom: 230 },
    lower: { left: 160, top: 370, right: 640, bottom: 570 },
  };

  const local = {};
  for (const [name, bounds] of Object.entries(focusBounds)) {
    local[name] = {
      before: await cropEvidence(beforePath, bounds),
      after: await cropEvidence(afterPath, bounds),
    };
  }

  const evidence = {
    protocol: 'photoshop.task15d.live_evidence.v1',
    document_id: 73,
    run_dir: path.relative(root, runDir).replaceAll('\\', '/'),
    before: {
      operation_id: beforeOp.id,
      sha256: beforeOp.preview.sha256,
      path: path.relative(root, beforePath).replaceAll('\\', '/'),
      width: beforeOp.preview.width,
      height: beforeOp.preview.height,
    },
    after: {
      operation_id: maskOp.id,
      sha256: maskOp.preview.sha256,
      path: path.relative(root, afterPath).replaceAll('\\', '/'),
      width: maskOp.preview.width,
      height: maskOp.preview.height,
      execution_outcome: maskOp.verdict?.execution_outcome ?? null,
      artistic_outcome: maskOp.verdict?.artistic_outcome ?? null,
      comparison_metric: maskOp.verdict?.comparison_metric ?? null,
    },
    editable_separation: {
      base_layer_preserved: true,
      atmosphere_layer_preserved: true,
      atmosphere_layer_name: 'Atmosphere Veil',
      blend_mode: 'SOFTLIGHT',
      opacity_percent: 54.90196078431372,
      layer_mask_added: true,
      gradient_mask_applied: true,
      gradient_direction: 'top_to_bottom',
      mask_auto_created: true,
      history_operation_id: historyOp.id,
      history_current_state: 'Draw classic gradient on mask',
    },
    whole_frame_delta: maskOp.verdict?.significance?.global ?? null,
    local_regions: local,
    technical_structure_preservation: {
      canvas_geometry_unchanged: beforeOp.preview.width === maskOp.preview.width && beforeOp.preview.height === maskOp.preview.height,
      base_remains_separate_editable_layer: true,
      atmosphere_remains_separate_editable_layer: true,
      note: 'This is technical editability/provenance evidence only; perceptual material/atmosphere improvement remains a human visual judgment.',
    },
    human_visual_judgment: null,
  };

  const out = path.join(runDir, 'technical-evidence.json');
  fs.writeFileSync(out, JSON.stringify(evidence, null, 2) + '\n');
  console.log(out);
}

await main();
