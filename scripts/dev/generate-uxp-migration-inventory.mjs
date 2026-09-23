import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TOOLS = join(ROOT, 'src', 'tools');
const OUT = join(ROOT, 'docs', 'uxp-migration-inventory.md');

const PURE_NODE = new Set([
  'photoshop_ping',
  'photoshop_get_version',
  'photoshop_get_capabilities',
  'photoshop_get_painting_method_capabilities',
  'photoshop_select_painting_method',
  'photoshop_transform_landmarks',
  'photoshop_compare_landmarks',
]);

const AUTO_BENEFIT = new Set([
  'photoshop_execute_visual_microplan',
  'photoshop_analyze_value_structure',
  'photoshop_measure_points',
]);

const LEGACY = new Set([
  'photoshop_execute_script',
]);

const ALREADY_UXP = new Set([
  'photoshop_get_state',
  'photoshop_get_document_info',
  'photoshop_list_documents',
  'photoshop_get_selection_bounds',
  'photoshop_get_layers',
  'photoshop_list_brush_presets',
  'photoshop_get_brush_settings',
  'photoshop_get_preview',
  'photoshop_sample_color',
  'photoshop_sample_colors',
  'photoshop_get_history',
  'photoshop_select_brush_preset',
  'photoshop_set_brush',
  'photoshop_set_foreground_color',
  'photoshop_fill_layer',
  'photoshop_paint_regions',
  'photoshop_paint_strokes',
  'photoshop_paint_dabs',
  'photoshop_save_document',
  'photoshop_neural_filter',
  'photoshop_create_document',
  'photoshop_open_image',
  'photoshop_select_layer_by_name',
  'photoshop_create_layer',
  'photoshop_delete_layer',
  'photoshop_set_layer_opacity',
  'photoshop_set_layer_blend_mode',
  'photoshop_set_layer_visibility',
  'photoshop_set_layer_locked',
  'photoshop_rename_layer',
  'photoshop_duplicate_layer',
  'photoshop_move_layer_to_position',
  'photoshop_move_layer_to_top',
  'photoshop_move_layer_to_bottom',
  'photoshop_move_layer_up',
  'photoshop_move_layer_down',
  'photoshop_create_layer_mask',
  'photoshop_apply_gradient_mask',
  'photoshop_select_rectangle',
  'photoshop_select_ellipse',
  'photoshop_feather_selection',
  'photoshop_select_subject',
  'photoshop_undo',
  'photoshop_apply_layer_mask',
  'photoshop_close_document',
  'photoshop_content_aware_fill',
  'photoshop_contract_selection',
  'photoshop_create_clipping_mask',
  'photoshop_delete_layer_mask',
  'photoshop_deselect',
  'photoshop_expand_selection',
  'photoshop_fit_layer_to_document',
  'photoshop_flatten_image',
  'photoshop_invert_selection',
  'photoshop_merge_layer_down',
  'photoshop_merge_visible_layers',
  'photoshop_move_layer',
  'photoshop_release_clipping_mask',
  'photoshop_rotate_layer',
  'photoshop_save_selection',
  'photoshop_scale_layer',
  'photoshop_select_all',
  'photoshop_set_active_document',
  'photoshop_adjust_brightness_contrast',
  'photoshop_adjust_curves',
  'photoshop_adjust_exposure',
  'photoshop_adjust_hue_saturation',
  'photoshop_adjust_vibrance',
  'photoshop_apply_gaussian_blur',
  'photoshop_apply_gradient_map',
  'photoshop_apply_high_pass',
  'photoshop_apply_lut',
  'photoshop_apply_motion_blur',
  'photoshop_apply_noise',
  'photoshop_apply_photo_filter',
  'photoshop_apply_sharpen',
  'photoshop_apply_smart_blur',
  'photoshop_auto_contrast',
  'photoshop_auto_levels',
  'photoshop_desaturate',
  'photoshop_export_as',
  'photoshop_invert',
  'photoshop_list_fonts',
  'photoshop_set_text_alignment',
  'photoshop_set_text_color',
  'photoshop_set_text_font',
  'photoshop_update_text_content',
  'photoshop_add_guides',
  'photoshop_apply_layer_style',
  'photoshop_clear_guides',
  'photoshop_convert_to_smart_object',
  'photoshop_create_smart_object_via_copy',
  'photoshop_create_text_layer',
  'photoshop_crop_document',
  'photoshop_edit_smart_object_contents',
  'photoshop_generate_from_datasets',
  'photoshop_image_stack',
  'photoshop_import_datasets',
  'photoshop_list_datasets',
  'photoshop_list_guides',
  'photoshop_place_image',
  'photoshop_play_action',
  'photoshop_rasterize_layer',
  'photoshop_redo',
  'photoshop_replace_smart_object_contents',
  'photoshop_resize_image',
  'photoshop_sky_replacement',
]);

const UXP_ONLY = new Set([
  'photoshop_save_document',
  'photoshop_neural_filter',
]);

const READ_ONLY = new Set([
  ...PURE_NODE,
  'photoshop_get_state',
  'photoshop_get_preview',
  'photoshop_get_document_info',
  'photoshop_list_documents',
  'photoshop_get_layers',
  'photoshop_get_selection_bounds',
  'photoshop_get_history',
  'photoshop_list_brush_presets',
  'photoshop_get_brush_settings',
  'photoshop_sample_color',
  'photoshop_sample_colors',
  'photoshop_list_fonts',
  'photoshop_list_datasets',
  'photoshop_list_guides',
  'photoshop_measure_points',
  'photoshop_analyze_value_structure',
  'photoshop_guard_capabilities',
  'photoshop_guard_status',
  'photoshop_guard_resume',
  'photoshop_guard_job_poll',
  'photoshop_guard_art_director',
]);

const HOT_P0 = new Set([
  'photoshop_get_state',
  'photoshop_get_preview',
  'photoshop_get_layers',
  'photoshop_list_documents',
  'photoshop_get_document_info',
  'photoshop_get_selection_bounds',
  'photoshop_list_brush_presets',
  'photoshop_get_brush_settings',
  'photoshop_set_brush',
  'photoshop_select_brush_preset',
  'photoshop_set_foreground_color',
  'photoshop_sample_color',
  'photoshop_sample_colors',
  'photoshop_paint_strokes',
  'photoshop_paint_dabs',
  'photoshop_paint_regions',
  'photoshop_fill_layer',
]);

const COMMON_P1 = /(?:create_layer|delete_layer|rename_layer|duplicate_layer|set_layer_|select_layer|move_layer|merge_layer|merge_visible|flatten_image|selection|layer_mask|clipping_mask|fit_layer|scale_layer|rotate_layer)/;

function categoryFor(source, name) {
  if (name.startsWith('photoshop_recipe_')) return 'recipe';
  if (name.startsWith('photoshop_guard_')) return 'guard';
  const base = source.replaceAll('\\', '/').split('/').pop()?.replace(/-tools\.ts$/, '') ?? 'core';
  return base;
}

function primitiveGroup(source, name) {
  if (name.startsWith('photoshop_recipe_')) return 'recipe/orchestration';
  if (name.startsWith('photoshop_guard_')) return 'guard/orchestration';
  if (name === 'photoshop_execute_visual_microplan') return 'visual orchestration';
  if (name === 'photoshop_analyze_value_structure') return 'preview + Node luminance';
  if (name === 'photoshop_measure_points') return 'document.info + Node geometry';
  if (PURE_NODE.has(name)) return 'Node/session';
  if (name === 'photoshop_execute_script') return 'raw ExtendScript';
  if (name === 'photoshop_get_state') return 'state.read';
  if (name === 'photoshop_get_preview') return 'preview.read';
  if (name === 'photoshop_save_document') return 'document.save-copy';
  if (name === 'photoshop_neural_filter') return 'neural-filter';

  const base = categoryFor(source, name);
  const groups = {
    document: 'documents',
    layer: 'layers',
    'layer-properties': 'layers',
    'layer-ordering': 'layers',
    'layer-transform': 'layer transforms',
    selection: 'selections/masks',
    mask: 'selections/masks',
    painting: name.includes('brush') || name.includes('foreground') ? 'brush/config' : 'painting',
    'color-sampling': 'color sampling',
    adjustment: 'adjustments',
    'color-adjustment': 'adjustments',
    filter: 'filters',
    text: 'text',
    'smart-object': 'smart objects',
    image: 'document geometry',
    'image-placement': 'document open/place',
    history: 'history',
    export: 'export',
    action: 'actions',
    data: 'datasets',
    stack: 'image stack',
    style: 'layer styles',
    'sky-replacement': 'sky replacement',
    measurement: name.includes('guide') ? 'guides' : 'measurements',
    state: 'state',
  };
  return groups[base] ?? base;
}

function migrationClass(source, name) {
  if (name.startsWith('photoshop_recipe_') || AUTO_BENEFIT.has(name)) return 'B';
  if (name.startsWith('photoshop_guard_') || PURE_NODE.has(name)) return 'A';
  if (LEGACY.has(name)) return 'D';
  return 'C';
}

function currentTransport(source, name) {
  const cls = migrationClass(source, name);
  if (cls === 'A') return 'Node / Guard';
  if (cls === 'B') return 'Node orchestration → registered primitives';
  if (ALREADY_UXP.has(name) && UXP_ONLY.has(name)) return 'UXP only — fail closed';
  if (ALREADY_UXP.has(name)) return 'UXP-first → ExtendScript/COM pre-dispatch fallback';
  if (cls === 'D') return 'unavailable — legacy transport retired';
  return 'unavailable — UXP migration pending';
}

function priority(source, name) {
  const cls = migrationClass(source, name);
  if (cls === 'A') return 'keep';
  if (cls === 'B') return 'inherit';
  if (cls === 'D') return 'retired/unavailable';
  if (ALREADY_UXP.has(name)) return 'done/retain';
  if (HOT_P0.has(name)) return 'P0';
  if (COMMON_P1.test(name)) return 'P1';
  if (
    source.includes('document-tools') ||
    source.includes('selection-tools') ||
    source.includes('mask-tools') ||
    source.includes('layer-transform-tools')
  ) return 'P1';
  if (
    source.includes('adjustment-tools') ||
    source.includes('color-adjustment-tools') ||
    source.includes('filter-tools') ||
    source.includes('text-tools') ||
    source.includes('export-tools')
  ) return 'P2';
  return 'P3';
}

function fallback(source, name) {
  const cls = migrationClass(source, name);
  if (cls === 'A' || cls === 'B') return 'n/a';
  if (cls === 'D' || UXP_ONLY.has(name)) return 'no — fail closed';
  return 'yes — pre-dispatch only; never replay after dispatch';
}

function parityStrategy(source, name) {
  const cls = migrationClass(source, name);
  if (cls === 'A') return 'Node unit/contract tests';
  if (cls === 'B') return 'underlying primitive parity + orchestration regression';
  if (cls === 'D') return 'historical regression only; production unavailable';
  if (READ_ONLY.has(name)) return 'same-state COM↔UXP normalized semantic equality';
  const group = primitiveGroup(source, name);
  if (group === 'painting' || name === 'photoshop_fill_layer') {
    return 'disposable A/B docs; semantic + pixel/preview + order parity';
  }
  if (group === 'layer transforms' || group === 'selections/masks' || group === 'document geometry') {
    return 'disposable A/B docs; state + geometry + preview parity';
  }
  return 'disposable A/B docs; before/after state + visual/semantic parity';
}

function noteFor(source, name) {
  if (name === 'photoshop_get_state') return 'Phase 1 first production read; public schema unchanged.';
  if (
    name === 'photoshop_get_document_info' ||
    name === 'photoshop_list_documents' ||
    name === 'photoshop_get_selection_bounds' ||
    name === 'photoshop_get_layers'
  ) return 'Phase 2 read cluster; UXP batchPlay accepted with public schema unchanged.';
  if (name === 'photoshop_list_brush_presets') {
    return 'Phase 3 brush preset read; UXP presetManager parity accepted with no-focus-steal.';
  }
  if (name === 'photoshop_get_brush_settings') {
    return 'Phase 3 brush settings read; UXP currentToolOptions parity accepted with no-focus-steal.';
  }
  if (name === 'photoshop_get_preview') {
    return 'Phase 4 preview read; UXP Imaging API pixel parity accepted with no-focus-steal.';
  }
  if (name === 'photoshop_sample_color' || name === 'photoshop_sample_colors') {
    return 'Phase 5 color sampling; UXP Imaging API semantic parity accepted with no-focus-steal.';
  }
  if (name === 'photoshop_get_history') {
    return 'Phase 6 history read; UXP historyState enumeration parity accepted with no-focus-steal.';
  }
  if (name === 'photoshop_measure_points') {
    return 'Phase 6 Node geometry over migrated document.info; no dedicated ExtendScript measurement primitive remains.';
  }
  if (
    name === 'photoshop_select_brush_preset' ||
    name === 'photoshop_set_brush' ||
    name === 'photoshop_set_foreground_color'
  ) {
    return 'Phase 8 brush/config mutation; UXP is preferred and COM is allowed only as a pre-dispatch fallback; no replay after dispatch.';
  }
  if (name === 'photoshop_fill_layer') {
    return 'Phase 8 fill mutation; exact pixel, targeting, selection and Select Canvas → Fill → Deselect history parity accepted.';
  }
  if (name === 'photoshop_paint_regions') {
    return 'Phase 8 compound-region mutation; ADD/SUBTRACT geometry, metadata, cleanup, one-step history and no-focus parity accepted.';
  }
  if (name === 'photoshop_paint_strokes') {
    return 'Phase 8 stroke mutation; caller style/color semantics, targeting, one-step history and no-focus parity accepted.';
  }
  if (name === 'photoshop_paint_dabs') {
    return 'Phase 8 dab mutation; ordered adjacent style runs, grouping metadata, one-step history and no-focus parity accepted.';
  }
  if (name === 'photoshop_save_document') return 'Already intentionally UXP-only; preserve fail-closed persistence invariants.';
  if (name === 'photoshop_neural_filter') return 'Already UXP bridge; separate feature, not migration driver.';
  if (UXP_ONLY.has(name) && ALREADY_UXP.has(name)) return 'Intentionally UXP-only capability; preserve fail-closed semantics.';
  if (name === 'photoshop_execute_script') return 'Raw JSX is retired/unavailable in production; retained source/fixtures are historical only.';
  if (name === 'photoshop_set_active_document') return 'Explicit UI/document-switch tool; never use implicit switching to satisfy document_id.';
  if (name.startsWith('photoshop_guard_')) return 'Guard remains transport-agnostic above backend routing.';
  if (name.startsWith('photoshop_recipe_')) return 'Do not rewrite solely for transport; inherits migrated primitives.';
  if (name === 'photoshop_execute_visual_microplan') return 'Node-side orchestration; benefits from migrated underlying primitives/bundles.';
  if (name === 'photoshop_analyze_value_structure') return 'Node analysis; automatically benefits when preview migrates.';
  if (name === 'photoshop_get_preview') return 'High-value hot path; investigate UXP Imaging API.';
  if (name.startsWith('photoshop_paint_')) return 'High-value/high-risk; preserve caller order, batching, targeting and Guard preview barrier.';
  return '';
}

async function sourceFiles() {
  const files = [join(ROOT, 'src', 'core', 'server.ts')];
  for (const entry of await readdir(TOOLS, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('-tools.ts')) files.push(join(TOOLS, entry.name));
  }
  const recipesDir = join(TOOLS, 'recipes');
  for (const entry of await readdir(recipesDir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.ts') && entry.name !== 'index.ts' && !entry.name.startsWith('_')) {
      files.push(join(recipesDir, entry.name));
    }
  }
  return files;
}

async function collectTools() {
  const found = new Map();
  for (const file of await sourceFiles()) {
    const source = await readFile(file, 'utf8');
    const rel = relative(ROOT, file).replaceAll('\\', '/');

    for (const match of source.matchAll(/\bname\s*:\s*['"](photoshop_[a-zA-Z0-9_]+)['"]/g)) {
      if (!found.has(match[1])) found.set(match[1], rel);
    }
    for (const match of source.matchAll(/\bcycleTool\(\s*['"](photoshop_[a-zA-Z0-9_]+)['"]/g)) {
      if (!found.has(match[1])) found.set(match[1], rel);
    }
    for (const match of source.matchAll(/\bTOOL_NAME\s*=\s*['"](photoshop_recipe_[a-zA-Z0-9_]+)['"]/g)) {
      if (!found.has(match[1])) found.set(match[1], rel);
    }
  }
  return [...found.entries()]
    .map(([name, source]) => ({ name, source }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function esc(value) {
  return String(value ?? '').replaceAll('|', '\\|').replaceAll('\n', ' ');
}

const tools = await collectTools();
if (tools.length !== 145) {
  throw new Error(`Expected 145 registered public tools, collected ${tools.length}. Run npm run verify:tool-counts and update this generator.`);
}

const counts = { A: 0, B: 0, C: 0, D: 0 };
for (const tool of tools) counts[migrationClass(tool.source, tool.name)]++;

const lines = [
  '# UXP migration inventory',
  '',
  '> Generated by `scripts/dev/generate-uxp-migration-inventory.mjs` from the current public tool sources.',
  '> Source-of-truth count at generation time: **145 public tools = 129 atomic + 16 recipes**.',
  '> Production Photoshop routing is UXP-first with a bounded ExtendScript/COM fallback selected only before dispatch. Once a UXP command can have been dispatched, it is never replayed through COM. Raw `photoshop_execute_script` remains retired.',
  '> Current source bridge revision: `compact-v2-20260923-full`.',
  '',
  '## Classification',
  '',
  '- **A** — no backend migration needed: Node / Guard / planning / pure geometry.',
  '- **B** — no direct rewrite expected: orchestration/recipe that automatically benefits from migrated primitives.',
  '- **C** — a semantic Photoshop primitive needs or already has a UXP implementation.',
  '- **D** — explicit legacy capability whose public name may remain registered but whose legacy transport is unavailable.',
  '- **E** — intentionally disabled/out of scope (listed separately; not part of the 145 registered tools).',
  '',
  `Current registered classification totals: A=${counts.A}, B=${counts.B}, C=${counts.C}, D=${counts.D}.`,
  '',
  'Routing rule: production Photoshop dispatch is UXP-first. Support/availability is resolved **before dispatch**; ExtendScript/COM may be selected only before any UXP dispatch. There is no automatic cross-backend replay after dispatch or uncertainty.',
  '',
  '## Registered public tools',
  '',
  '| tool_name | source/category | mutating? | Node-only? | recipe/orchestration? | current primitive(s) | current transport | class | UXP candidate? | shared primitive group | priority | fallback required? | parity-test strategy | notes |',
  '|---|---|---|---|---|---|---|---:|---|---|---|---|---|---|',
];

for (const { name, source } of tools) {
  const cls = migrationClass(source, name);
  const nodeOnly = cls === 'A' ? 'yes' : 'no';
  const orchestration = cls === 'B' || name.startsWith('photoshop_guard_') ? 'yes' : 'no';
  const uxpCandidate = cls === 'C' ? 'yes' : cls === 'D' ? 'no' : 'n/a';
  const row = [
    '`' + name + '`',
    '`' + source + '` / ' + categoryFor(source, name),
    READ_ONLY.has(name) ? 'no' : 'yes',
    nodeOnly,
    orchestration,
    primitiveGroup(source, name),
    currentTransport(source, name),
    cls,
    uxpCandidate,
    primitiveGroup(source, name),
    priority(source, name),
    fallback(source, name),
    parityStrategy(source, name),
    noteFor(source, name),
  ].map(esc);
  lines.push(`| ${row.join(' | ')} |`);
}

const remainingNonUxp = tools.filter(({ name, source }) => {
  const cls = migrationClass(source, name);
  return cls === 'C' && !ALREADY_UXP.has(name);
});
for (const tier of ['P1', 'P2', 'P3']) {
  const names = remainingNonUxp
    .filter(({ name, source }) => priority(source, name) === tier)
    .map(({ name }) => `\`${name}\``);
  lines.push(
    '',
    `### Remaining non-UXP ${tier} catalog tools`,
    '',
    names.length ? names.map((name) => `- ${name}`).join('\n') : '- None.'
  );
}

lines.push(
  '',
  '### Bounded 13c canonical live scenario dependency check',
  '',
  '- **Remaining non-UXP catalog tools required by the bounded 13c scenario: none.**',
  '- The bounded scenario can stay on the canonical UXP lane using state/layer/brush reads, brush/config setters, `photoshop_create_layer`, `photoshop_fill_layer` and/or `photoshop_paint_regions`, `photoshop_paint_strokes`/`photoshop_paint_dabs` when selected by the plan, `photoshop_undo` for rollback, and `photoshop_get_preview` for comparable observation.',
  '- The selection-mask method palette path (`photoshop_select_rectangle`, `photoshop_select_ellipse`, `photoshop_select_subject`, `photoshop_feather_selection`, `photoshop_create_layer_mask`, `photoshop_apply_gradient_mask`) is UXP-first with the same bounded pre-dispatch legacy fallback.',
  '- P1/P2/P3 catalog migration is complete; no registered class-C tool remains pending UXP migration.'
);

lines.push(
  '',
  '## Intentionally disabled / out of scope (class E)',
  '',
  'These are **not registered** in the current 145-tool runtime and do not count toward migration completion:',
  '',
  '- `photoshop_generative_fill`',
  '- `photoshop_generative_expand`',
  '- `photoshop_generative_remove`',
  '',
  'Do not reactivate or build UXP parity for these tools as part of this migration.',
  '',
  '## Phase-1 disposition',
  '',
  '- `photoshop_get_state`: retained production semantic primitive routed UXP-first with bounded pre-dispatch ExtendScript/COM fallback.',
  '- Public `photoshop_get_state` input/result envelope remains unchanged.',
  '- State collection is read-only `batchPlay` rather than UXP DOM access; live open-document acceptance recorded 0 Photoshop foreground samples/transitions across 40 reads and exact field parity with COM/ExtendScript after background-layer count normalization.',
  '- `photoshop_save_document`: retain its existing UXP-only fail-closed policy.',
  '- `photoshop_neural_filter`: retain the existing UXP bridge lane; it is not a migration driver.',
  '- The migrated read lane keeps the same pre-dispatch fallback rule; no read or mutation is replayed through another backend after a UXP dispatch/claim/uncertain result.',
  '',
  '## Phase-2 disposition',
  '',
  '- `photoshop_get_document_info`, `photoshop_list_documents`, `photoshop_get_selection_bounds`, and `photoshop_get_layers` are UXP-first with the same bounded pre-dispatch ExtendScript/COM fallback.',
  '- All four preserve the existing public MCP envelopes. Document/list/selection results matched direct COM/ExtendScript on the same open document; `photoshop_get_layers` matched the captured legacy layer result field-for-field.',
  '- Dedicated 40-call no-focus-steal acceptance passed for documents (8–13 ms, 9.85 ms average), selection bounds (8–12 ms, 8.93 ms average), and layers (8–13 ms, 9.9 ms average), with zero Photoshop foreground samples/transitions. Document info reuses the already accepted state-read descriptor path.',
  '',
  '## Phase-3 disposition',
  '',
  '- `photoshop_list_brush_presets` is UXP-first via read-only `presetManager` batchPlay. Live parity matched all 123 installed presets and the exact filtered `soft` result; 40 foreground-acceptance calls recorded zero Photoshop samples/transitions at 9–15 ms (10.72 ms average).',
  '- `photoshop_get_brush_settings` is UXP-first via read-only application `currentToolOptions`. Direct COM/ExtendScript and the public UXP route matched all 14 settings fields; 40 foreground-acceptance calls recorded zero Photoshop samples/transitions at 9–13 ms (10.07 ms average). The unsafe direct `brush` target probe is intentionally not used because Photoshop 27.8 can reject it modally.',
  '',
  '## Phase-4 disposition',
  '',
  '- `photoshop_get_preview` is UXP-first via the Imaging API. Whole-document and focus-region captures matched the legacy preview pixel-for-pixel after JPEG decode on the live test document. A 40-call foreground run recorded zero Photoshop samples/transitions at 13–51 ms (36.22 ms average). UXP no longer creates duplicate/crop/save Photoshop documents for preview capture.',
  '',
  '## Phase-5 disposition',
  '',
  '- `photoshop_sample_color` and `photoshop_sample_colors` are UXP-first through the same Imaging API path. Public single-average and point-batch payloads matched the captured legacy baselines exactly. Forty-call foreground runs recorded zero Photoshop samples/transitions at 43.32 ms and 44.58 ms average respectively.',
  '',
  '## Phase-6 disposition',
  '',
  '- `photoshop_get_history` is UXP-first via indexed read-only `historyState` Action Manager descriptors. The public result matched the legacy two-state baseline exactly, including snapshot flags and context. A 40-call foreground run recorded zero Photoshop samples/transitions at 9–26 ms (11.88 ms average).',
  '- `photoshop_measure_points` no longer executes JSX. It obtains document geometry through the already migrated `document.info` backend and performs all caller-supplied point/distance/ratio calculations in Node, including legacy-compatible numeric precision.',
  '',
  '## Phase-8 mutation disposition',
  '',
  '- `photoshop_select_brush_preset`, `photoshop_set_brush`, and `photoshop_set_foreground_color` are UXP-first with bounded pre-dispatch ExtendScript/COM fallback on the canonical Guard painting lane. Exact brush/config parity was accepted on disposable documents.',
  '- `photoshop_fill_layer` is UXP-first. Direct A/B verification matched requested pixels, target/selection restoration, and the exact Photoshop history sequence `Select Canvas → Fill → Deselect`.',
  '- `photoshop_paint_regions` is UXP-first through UXP compound paths plus Action Manager path-to-selection/fill/delete. ADD/SUBTRACT geometry, metadata, cleanup, targeting, one-step history and no-focus behavior matched the legacy baseline.',
  '- `photoshop_paint_strokes` is UXP-first through named UXP paths and `PathItem.strokePath`. A Photoshop 27.8 host quirk can restore stale brush opacity/flow when `app.foregroundColor` is assigned inside the same painting modal, so the UXP implementation re-applies the desired size/opacity/flow after each color write. The corrected combined color/style path matched legacy pixel and history semantics with zero focus steals.',
  '- `photoshop_paint_dabs` is UXP-first and preserves ordered adjacent style runs rather than globally regrouping equal styles. Red → blue → red overlap tests finished red on both backends with `style_run_count=3`, `unique_style_count=2`, one batch/history step and zero focus steals.',
  '- Mutation backend selection remains final before dispatch. A dispatched or uncertain mutation is never replayed automatically through another backend.',
  '',
  '## Phase-9 basic layer mutation implementation status',
  '',
  '- `photoshop_create_layer`, `photoshop_delete_layer`, `photoshop_duplicate_layer`, `photoshop_rename_layer`, `photoshop_set_layer_opacity`, `photoshop_set_layer_blend_mode`, `photoshop_set_layer_visibility`, and `photoshop_set_layer_locked` are UXP-first with bounded pre-dispatch ExtendScript/COM fallback on the canonical Guard painting lane.',
  '- Source/static/routing migration is complete. The final representative post-migration live behavior/no-focus-steal gate remains separate.',
  '- Do not use obsolete pre-v2 revisions as readiness targets. Current source uses `compact-v2-20260923-full`.',
  '',
  '## Phase-10 layer ordering implementation status',
  '',
  '- `photoshop_move_layer_to_position`, `photoshop_move_layer_to_top`, `photoshop_move_layer_to_bottom`, `photoshop_move_layer_up`, and `photoshop_move_layer_down` are implemented through one semantic primitive (`layer.order.write`) and one UXP bridge action (`move_layer`).',
  '- The ordering tools are UXP-first with bounded pre-dispatch ExtendScript/COM fallback. Source/static/routing migration is complete; representative post-migration live behavior remains the final gate.',
  '- TOP/BOTTOM/UP/DOWN remain inside the active layer parent; ABOVE/BELOW resolves stable id first. Preserve explicit Background and boundary `moved:false` semantics during acceptance.',
  ''
);

await writeFile(OUT, lines.join('\n'), 'utf8');
// eslint-disable-next-line no-undef
console.log(`Wrote ${relative(ROOT, OUT)} with ${tools.length} registered tools; A=${counts.A}, B=${counts.B}, C=${counts.C}, D=${counts.D}`);
