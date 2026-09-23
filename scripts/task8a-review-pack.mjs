#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');
export const DEFAULT_MANIFEST = path.join(ROOT, 'tests', 'fixtures', 'task8a-heldout-manifest.json');
export const DEFAULT_OUTPUT = path.join(ROOT, 'task8a-review-pack');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function sha256File(file) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(file));
  return hash.digest('hex');
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function assertNeutralFilename(caseId, filename, side) {
  const expected = new RegExp(`^${caseId}-${side}\\.(?:jpg|png)$`);
  if (!expected.test(filename)) throw new Error(`non-neutral ${side} filename for ${caseId}: ${filename}`);
}

export function validateReviewSources(manifest, root = ROOT) {
  const seen = new Set();
  const sources = [];
  for (const item of manifest.cases ?? []) {
    if (!/^case-\d{3}$/.test(item.case_id)) throw new Error(`non-neutral case id: ${item.case_id}`);
    if (seen.has(item.case_id)) throw new Error(`duplicate case id: ${item.case_id}`);
    seen.add(item.case_id);
    assertNeutralFilename(item.case_id, item.neutral_before_filename, 'before');
    assertNeutralFilename(item.case_id, item.neutral_after_filename, 'after');

    for (const side of ['before', 'after']) {
      const source = path.resolve(root, item[`source_${side}`]);
      if (!fs.existsSync(source)) throw new Error(`missing ${side} source for ${item.case_id}: ${source}`);
      const stat = fs.statSync(source);
      if (!stat.isFile()) throw new Error(`${side} source is not a file for ${item.case_id}: ${source}`);
      sources.push({ case_id: item.case_id, side, source, size_bytes: stat.size, sha256: sha256File(source) });
    }
  }
  if (!sources.length) throw new Error('manifest contains no review cases');
  return sources;
}

export function blankHumanReference(manifest) {
  return {
    schema_version: 1,
    instructions: 'Complete only from independent human adjudication before viewing critic answers. Leave status pending until all fields for a case are decided.',
    references: Object.fromEntries((manifest.cases ?? []).map(item => [item.case_id, {
      status: 'pending',
      finding_expected: null,
      ambiguity_expected: null,
      useful_action: null,
      human_note: '',
      adjudicated_by: '',
      adjudicated_at: null,
    }])),
  };
}

export function publicPackManifest(manifest, sources) {
  const byKey = new Map(sources.map(source => [`${source.case_id}:${source.side}`, source]));
  return {
    schema_version: 1,
    cases: (manifest.cases ?? []).map(item => ({
      case_id: item.case_id,
      before: {
        filename: item.neutral_before_filename,
        sha256: byKey.get(`${item.case_id}:before`).sha256,
        size_bytes: byKey.get(`${item.case_id}:before`).size_bytes,
      },
      after: {
        filename: item.neutral_after_filename,
        sha256: byKey.get(`${item.case_id}:after`).sha256,
        size_bytes: byKey.get(`${item.case_id}:after`).size_bytes,
      },
    })),
  };
}

export function renderReviewHtml(manifest) {
  const cases = (manifest.cases ?? []).map(item => {
    const constraints = (item.preservation_constraints ?? []).map(value => `<li>${escapeHtml(value)}</li>`).join('');
    return `<section class="case" data-case-id="${escapeHtml(item.case_id)}">
      <h2>${escapeHtml(item.case_id)}</h2>
      <div class="images">
        <figure><img src="images/${encodeURIComponent(item.neutral_before_filename)}" alt="${escapeHtml(item.case_id)} before"><figcaption>Before</figcaption></figure>
        <figure><img src="images/${encodeURIComponent(item.neutral_after_filename)}" alt="${escapeHtml(item.case_id)} after"><figcaption>After</figcaption></figure>
      </div>
      <p><strong>Brief:</strong> ${escapeHtml(item.brief)}</p>
      <p><strong>Pass goal:</strong> ${escapeHtml(item.pass_goal)}</p>
      <div><strong>Preservation constraints:</strong><ul>${constraints}</ul></div>
      <div class="controls">
        <label>finding_expected
          <select data-field="finding_expected"><option value="">—</option><option value="true">true</option><option value="false">false</option></select>
        </label>
        <label>ambiguity_expected
          <select data-field="ambiguity_expected"><option value="">—</option><option value="true">true</option><option value="false">false</option></select>
        </label>
        <label>useful_action
          <select data-field="useful_action"><option value="">—</option><option value="keep">keep</option><option value="correct">correct</option><option value="rollback">rollback</option><option value="abstain">abstain</option></select>
        </label>
        <label>note<textarea data-field="human_note" rows="3"></textarea></label>
      </div>
    </section>`;
  }).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Task 8/8a Human Adjudication</title>
  <style>
    body{font:16px/1.45 system-ui,sans-serif;max-width:1320px;margin:0 auto;padding:24px;background:#151515;color:#eee}
    .intro,.case{background:#202020;border:1px solid #444;border-radius:10px;padding:18px;margin:0 0 22px}
    .images{display:grid;grid-template-columns:1fr 1fr;gap:16px}.images img{width:100%;height:auto;display:block;background:#111}.images figure{margin:0}.images figcaption{text-align:center;padding:6px}
    .controls{display:grid;grid-template-columns:repeat(3,minmax(180px,1fr));gap:12px;margin-top:16px}.controls label{display:flex;flex-direction:column;gap:5px}.controls label:last-child{grid-column:1/-1}
    select,textarea,input,button{font:inherit;padding:8px;background:#111;color:#eee;border:1px solid #666;border-radius:5px}button{cursor:pointer;margin-right:8px}#status{margin-left:8px}
    @media(max-width:800px){.images,.controls{grid-template-columns:1fr}.controls label:last-child{grid-column:auto}}
  </style>
</head>
<body>
  <div class="intro">
    <h1>Task 8/8a Human Adjudication</h1>
    <p>Judge only the visible before/after evidence against the brief, pass goal, and preservation constraints. Do not inspect project source material or critic answers while adjudicating.</p>
    <label>Reviewer identifier/role <input id="reviewer" autocomplete="off"></label>
    <p><button id="export" type="button">Download completed human-reference.json</button><span id="status"></span></p>
  </div>
  ${cases}
  <script>
    const ids = ${JSON.stringify((manifest.cases ?? []).map(item => item.case_id))};
    document.getElementById('export').addEventListener('click', () => {
      const reviewer = document.getElementById('reviewer').value.trim();
      const references = {};
      let incomplete = 0;
      for (const id of ids) {
        const section = document.querySelector('[data-case-id="' + id + '"]');
        const findingRaw = section.querySelector('[data-field="finding_expected"]').value;
        const ambiguityRaw = section.querySelector('[data-field="ambiguity_expected"]').value;
        const action = section.querySelector('[data-field="useful_action"]').value;
        const note = section.querySelector('[data-field="human_note"]').value.trim();
        const complete = findingRaw !== '' && ambiguityRaw !== '' && action !== '' && reviewer !== '';
        if (!complete) incomplete++;
        references[id] = {
          status: complete ? 'complete' : 'pending',
          finding_expected: findingRaw === '' ? null : findingRaw === 'true',
          ambiguity_expected: ambiguityRaw === '' ? null : ambiguityRaw === 'true',
          useful_action: action || null,
          human_note: note,
          adjudicated_by: reviewer,
          adjudicated_at: complete ? new Date().toISOString() : null
        };
      }
      if (incomplete) {
        document.getElementById('status').textContent = incomplete + ' case(s) incomplete; fill every decision and reviewer id before export.';
        return;
      }
      const payload = {schema_version:1,instructions:'Independent human adjudication completed before viewing critic answers.',references};
      const blob = new Blob([JSON.stringify(payload,null,2) + '\\n'], {type:'application/json'});
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob); link.download = 'human-reference.json'; link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 0);
      document.getElementById('status').textContent = 'Exported human-reference.json';
    });
  </script>
</body>
</html>\n`;
}

export function buildReviewPack({ manifestPath = DEFAULT_MANIFEST, root = ROOT, outputDir = DEFAULT_OUTPUT } = {}) {
  const manifest = readJson(manifestPath);
  const sources = validateReviewSources(manifest, root);
  const imagesDir = path.join(outputDir, 'images');
  fs.mkdirSync(imagesDir, { recursive: true });

  const sourceByKey = new Map(sources.map(source => [`${source.case_id}:${source.side}`, source]));
  for (const item of manifest.cases ?? []) {
    for (const side of ['before', 'after']) {
      const source = sourceByKey.get(`${item.case_id}:${side}`);
      const filename = item[`neutral_${side}_filename`];
      fs.copyFileSync(source.source, path.join(imagesDir, filename));
      const copiedHash = sha256File(path.join(imagesDir, filename));
      if (copiedHash !== source.sha256) throw new Error(`hash mismatch after copy: ${item.case_id} ${side}`);
    }
  }

  const packManifest = publicPackManifest(manifest, sources);
  fs.writeFileSync(path.join(outputDir, 'pack-manifest.json'), JSON.stringify(packManifest, null, 2) + '\n');
  fs.writeFileSync(path.join(outputDir, 'human-reference.blank.json'), JSON.stringify(blankHumanReference(manifest), null, 2) + '\n');
  fs.writeFileSync(path.join(outputDir, 'review.html'), renderReviewHtml(manifest));
  return { outputDir, packManifest };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [manifestArg, outputArg] = process.argv.slice(2);
  const result = buildReviewPack({
    manifestPath: manifestArg ? path.resolve(manifestArg) : DEFAULT_MANIFEST,
    outputDir: outputArg ? path.resolve(outputArg) : DEFAULT_OUTPUT,
  });
  process.stdout.write(JSON.stringify({
    ok: true,
    review_html: path.join(result.outputDir, 'review.html'),
    blank_response: path.join(result.outputDir, 'human-reference.blank.json'),
    pack_manifest: path.join(result.outputDir, 'pack-manifest.json'),
    cases: result.packManifest.cases.length,
  }, null, 2) + '\n');
}
