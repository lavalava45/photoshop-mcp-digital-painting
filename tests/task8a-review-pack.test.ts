import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import manifest from './fixtures/task8a-heldout-manifest.json';
import {
  blankHumanReference,
  buildReviewPack,
  publicPackManifest,
  renderReviewHtml,
  validateReviewSources,
} from '../scripts/task8a-review-pack.mjs';

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function createSourceFixtureRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task8a-review-sources-'));
  tempDirs.push(root);
  const sources = new Set(
    manifest.cases.flatMap(item => [item.source_before, item.source_after]),
  );
  for (const relative of sources) {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `fixture bytes for ${relative}\n`);
  }
  return root;
}

function sha256(file: string) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

describe('Task 8/8a human adjudication review pack', () => {
  it('validates every source and publishes only neutral filenames plus complete source hashes', () => {
    const sourceRoot = createSourceFixtureRoot();
    const sources = validateReviewSources(manifest, sourceRoot);
    expect(sources).toHaveLength(manifest.cases.length * 2);
    expect(sources.every(row => row.size_bytes > 0 && /^[0-9a-f]{64}$/.test(row.sha256))).toBe(true);

    const publicManifest = publicPackManifest(manifest, sources);
    expect(publicManifest.cases).toHaveLength(manifest.cases.length);
    for (const row of publicManifest.cases) {
      expect(Object.keys(row).sort()).toEqual(['after', 'before', 'case_id']);
      expect(row.before.filename).toMatch(/^case-\d{3}-before\.(jpg|png)$/);
      expect(row.after.filename).toMatch(/^case-\d{3}-after\.(jpg|png)$/);
      expect(JSON.stringify(row)).not.toMatch(/processes[\\/]|sampling_stratum|source_|producer|verdict/i);
    }
  });

  it('renders a blinded review with required controls and no curator/source label leakage', () => {
    const html = renderReviewHtml(manifest);
    for (const item of manifest.cases) {
      expect(html).toContain(item.case_id);
      expect(html).toContain(item.brief);
      expect(html).toContain(item.pass_goal);
      expect(html).toContain(item.neutral_before_filename);
      expect(html).toContain(item.neutral_after_filename);
      expect(html).not.toContain(item.source_before);
      expect(html).not.toContain(item.source_after);
      expect(html).not.toContain(item.sampling_stratum);
      expect(html).not.toContain(item.subject_style);
    }
    expect(html).toContain('data-field="finding_expected"');
    expect(html).toContain('data-field="ambiguity_expected"');
    expect(html).toContain('data-field="useful_action"');
    expect(html).toContain('data-field="human_note"');
    expect(html).not.toMatch(/improvement_candidate|regression_candidate|producer reports|producer verdicts/i);
  });

  it('creates a directly usable blank human-reference template keyed only by neutral case ids', () => {
    const blank = blankHumanReference(manifest);
    expect(Object.keys(blank.references)).toEqual(manifest.cases.map(item => item.case_id));
    for (const reference of Object.values(blank.references)) {
      expect(reference).toEqual({
        status: 'pending',
        finding_expected: null,
        ambiguity_expected: null,
        useful_action: null,
        human_note: '',
        adjudicated_by: '',
        adjudicated_at: null,
      });
    }
  });

  it('copies all images byte-for-byte and records hashes matching both source and review copy', () => {
    const sourceRoot = createSourceFixtureRoot();
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task8a-review-pack-'));
    tempDirs.push(outputDir);
    const result = buildReviewPack({ outputDir, root: sourceRoot });
    expect(fs.existsSync(path.join(outputDir, 'review.html'))).toBe(true);
    expect(fs.existsSync(path.join(outputDir, 'human-reference.blank.json'))).toBe(true);
    expect(fs.existsSync(path.join(outputDir, 'pack-manifest.json'))).toBe(true);

    for (const item of manifest.cases) {
      for (const side of ['before', 'after'] as const) {
        const copied = path.join(outputDir, 'images', item[`neutral_${side}_filename`]);
        const source = path.resolve(sourceRoot, item[`source_${side}`]);
        const recorded = result.packManifest.cases.find(row => row.case_id === item.case_id)?.[side].sha256;
        expect(fs.existsSync(copied)).toBe(true);
        expect(sha256(copied)).toBe(sha256(source));
        expect(recorded).toBe(sha256(source));
      }
    }
  });
});
