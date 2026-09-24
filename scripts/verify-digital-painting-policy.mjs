import { readFile } from 'node:fs/promises';

const skillPath = new URL('../docs/digital-painting-agent-skill.md', import.meta.url);
const promptPath = new URL('../src/prompts/templates/digital-painting-control.ts', import.meta.url);
const implementationPath = new URL('../docs/digital-painting.md', import.meta.url);
const windowsExecutorPath = new URL('../src/platform/windows-executor.ts', import.meta.url);
const connectionPath = new URL('../src/platform/connection.ts', import.meta.url);
const backendRouterPath = new URL('../src/platform/photoshop-backend.ts', import.meta.url);
const guardRuntimePath = new URL('../src/core/guard/runtime.ts', import.meta.url);
const instructionsPath = new URL('../src/prompts/instructions.ts', import.meta.url);

const [
  kernel,
  prompt,
  implementation,
  windowsExecutor,
  connection,
  backendRouter,
  guardRuntime,
  instructions,
] = await Promise.all([
  readFile(skillPath, 'utf8'),
  readFile(promptPath, 'utf8'),
  readFile(implementationPath, 'utf8'),
  readFile(windowsExecutorPath, 'utf8'),
  readFile(connectionPath, 'utf8'),
  readFile(backendRouterPath, 'utf8'),
  readFile(guardRuntimePath, 'utf8'),
  readFile(instructionsPath, 'utf8'),
]);

// Detailed policy stays in scoped modules; the entry kernel is audited separately.
const policyModules = ['foundations.md', 'methods.md', 'inspection.md', 'operations.md'];
const moduleTexts = await Promise.all(policyModules.map(name =>
  readFile(new URL('../docs/painting-policy/' + name, import.meta.url), 'utf8')));
const skill = moduleTexts.join('\n');

const sharedInvariants = [
  ['hierarchy', /COMPOSITION\s*→\s*SHAPE\s*→\s*VALUE\s*→\s*FORM\s*→\s*EDGE\s*→\s*MATERIAL\s*→\s*DETAIL/i],
  ['recognition block-in before ordinary refinement', /RECOGNITION BLOCK-IN[\s\S]{0,1200}(?:3[–-]7|3 to 7)[\s\S]{0,1200}(?:recognition features|discriminative)[\s\S]{0,1600}(?:without relying on the prompt|overview reads)/i],
  ['recognition feature size is not priority', /(?:importance is not proportional to size|feature size does not determine priority|small features may be high-priority)/i],
  ['Photoshop routing latch', /Photoshop.*(?:sticky|execution mode)/is],
  ['document pinning', /document_id/i],
  ['persistent painting state', /painting-state\.json/i],
  ['accepted/current frame distinction', /accepted_frame[\s\S]{0,500}current_frame|current_frame[\s\S]{0,500}accepted_frame/i],
  ['action classes', /ADD[\s\S]{0,300}REFINE[\s\S]{0,300}REPLACE[\s\S]{0,300}ERASE[\s\S]{0,300}ROLLBACK[\s\S]{0,300}LEAVE/i],
  ['structure before texture', /structure before texture/i],
  ['primitive footprint', /primitive footprint/i],
  ['AUTO history warning', /AUTO[\s\S]{0,300}(?:history|steps)/i],
  ['SINGLE_HISTORY policy', /SINGLE_HISTORY/i],
  ['no-tracing guard', /no-tracing|trace it by default|mechanically trace/i],
  ['high-frequency development capture', /process capture|monotonic JPEGs|mutation\/tiny bundle/i],
  ['fresh-composition isolation', /fresh-composition/i],
  ['uncertain execution recovery', /timeout[\s\S]{0,900}(?:retry|recover|reconcile)/i],
  ['bounded brush inventory', /bounded brush inventory|bounded inventory/i],
  ['required user brushes', /required_brushes/i],
  ['fresh brush settings after preset selection', /select_brush_preset[\s\S]{0,900}(?:fresh authoritative|effective-settings readback|post-selection settings)/i],
  ['brush role map', /brush role map/i],
  ['method selection uses actual runtime capability map', /visual intent[\s\S]{0,250}impact class[\s\S]{0,250}method[\s\S]{0,250}(?:registered|runtime)[\s\S]{0,250}fallback/i],
  ['method palette rejects invented APIs', /(?:do not|never)[\s\S]{0,500}(?:infer|invent)[\s\S]{0,500}(?:API|runtime|primitive)|unavailable[\s\S]{0,500}(?:Clone Stamp|Mixer Brush|radial)/i],
  ['two-level Art Director Painter control', /Art Director[\s\S]{0,700}Painter[\s\S]{0,900}(?:5[–-]10|5–10|5-10|adaptive)/i],
  ['Painter keeps local verification without per-stroke global replan', /Painter[\s\S]{0,700}(?:local[^\n]{0,100}(?:verdict|preview)|preview\/verdict)[\s\S]{0,900}(?:no global re-plan|does not perform a fresh whole-image re-plan|not repeated after every stroke)/i],
  ['Planner early interrupt and global change gate', /(?:EARLY PLANNER RETURN|Return to Art Director before cadence)[\s\S]{0,1000}(?:serious|global)[\s\S]{0,1000}(?:likeness|main shape)[\s\S]{0,1200}(?:permission|reject|blocks? pre-dispatch|Planner-owned)/i],
  ['boundary-specific edge control', /Edge Control[\s\S]{0,900}(?:boundary|region pair)[\s\S]{0,900}(?:hard|firm)[\s\S]{0,500}soft[\s\S]{0,500}lost[\s\S]{0,500}broken/i],
  ['edge intent changes method selection', /edge intent[\s\S]{0,700}(?:method selection|capability map)[\s\S]{0,900}(?:fallback|unavailable)/i],
  ['edge verification is boundary specific', /edge_observations[\s\S]{0,600}boundary_id[\s\S]{0,600}(?:observed_behavior|target_met)/i],
  ['grayscale value gate blocks premature detail', /(?:Grayscale \/ Value Check|VALUE GATE)[\s\S]{0,1200}(?:DETAIL|detail)[\s\S]{0,900}(?:blocked|fails closed|Guard)/i],
  ['value check supports justified applicability exceptions', /(?:value[_ ]check|VALUE GATE)[\s\S]{0,1200}override[\s\S]{0,900}(?:style-not-applicable|style-N\/A)[\s\S]{0,900}(?:justif|applicability)/i],
  ['unobserved value analysis cannot pass', /unobserved[\s\S]{0,200}(?:never|not)[\s\S]{0,100}PASS/i],
  ['progressive refinement gate blocks pseudo-detail', /^(?=[\s\S]*REFINEMENT GATE)(?=[\s\S]*refinement_check)(?=[\s\S]*(?:representation_change|meaningful representation change))(?=[\s\S]*(?:texture-only|texture\/noise))(?=[\s\S]*(?:residual[_ -]block[_ -]in|residual block-in))(?=[\s\S]*(?:DETAIL|detail))[\s\S]*$/i],
  ['correction acceptance gate', /correction acceptance gate/i],
  ['geometric integrity', /geometric(?:-| )(?:form(?:-| ))?integrity|manufactured\s*\/\s*geometric/i],
  ['paired PSD checkpoint', /paired PSD checkpoint|accepted intermediate checkpoint[\s\S]{0,400}PSD/i],
  ['art run uses one project folder', /(?:ART RUN|art project)[\s\S]{0,900}processes\/<subject>-process\/<(?:run|run-name)>\/[\s\S]{0,900}frames\/[\s\S]{0,500}checkpoints\/[\s\S]{0,500}final\//i],
  ['frame commentary same-stem sidecar', /^(?=[\s\S]*(?:artistic_commentary|artistic commentary))(?=[\s\S]*(?:same-stem|same stem)[\s\S]{0,250}\.txt)[\s\S]*$/i],
  ['layer separation check protects independent correction without layer spam', /Layer Separation Check(?=[\s\S]{0,3200}(?:object|material|light|plane))(?=[\s\S]{0,3200}rollback)(?=[\s\S]{0,3200}(?:create-new|temporary-hypothesis|logical layer|logical\/temporary layer))(?=[\s\S]{0,3200}(?:per[^\n]{0,100}stroke|layer spam|formal segmentation))[\s\S]{0,3200}/i],
  ['accepted stable layers become executable protected_layer_ids', /^(?=[\s\S]*(?:accepted|accept))(?=[\s\S]*protected_layer_ids)(?=[\s\S]*(?:stable|layer id))(?=[\s\S]*(?:fail closed|protected target|must preserve|preserve))(?=[\s\S]*replace_protected_layer_ids)[\s\S]*$/i],
  ['protected_regions remain descriptive not executable protection', /protected_regions[\s\S]{0,700}(?:descriptive|semantic)[\s\S]{0,500}(?:only|not executable|not.*protection)/i],
  ['atomic visual bundle definition', /atomic visual bundle[\s\S]{0,900}(?:one visual problem|one semantic region)/i],
  ['hard preview barrier', /hard preview barrier|no next visual mutation may begin[\s\S]{0,300}(?:captured|inspected)[\s\S]{0,300}(?:classified|regression)/i],
  ['user communication is not protocol bookkeeping', /(?:user-visible )?commentary[\s\S]{0,700}(?:not|is not)[\s\S]{0,500}(?:bookkeeping|controller journal)/i],
  ['administrative substeps do not require synthetic three-field reports', /(?:do not (?:force|manufacture)|not force)[\s\S]{0,500}three-field report[\s\S]{0,700}(?:brush|layer|poll|administrative)/i],
  ['host delivery evidence remains separate from durable receipt', /(?:host|UI)[\s\S]{0,500}(?:delivery|evidence)[\s\S]{0,700}(?:separate|different)[\s\S]{0,700}(?:durable|receipt)/i],
  ['compact visual continuation closes and advances in one call', /previous_operation_id[\s\S]{0,300}previous_observation[\s\S]{0,600}next_pass/i],
  ['durable receipt acknowledgement is derived internally', /(?:exact stored receipt|durable receipt)[\s\S]{0,700}(?:internally|does not echo|do not copy|does not copy)/i],
  ['artistic observation remains model-owned', /(?:artistic observation|previous_observation)[\s\S]{0,900}(?:model|actual|inspect)/i],
  ['long-call progress does not replace visual observation', /(?:host progress|job id)[\s\S]{0,500}(?:does not|not)[\s\S]{0,500}(?:visual observation|preview inspection|artistic observation|completion)/i],
  ['async continuation polls the same durable job', /(?:poll|Poll)[\s\S]{0,250}(?:same|SAME)[\s\S]{0,250}(?:job|job_id)/i],
  ['hard UI focus barrier', /hard UI focus barrier[\s\S]{0,1200}(?:background|foreground)[\s\S]{0,1200}(?:active Photoshop document|active document|document\/tab)/i],
  ['no automatic active-document switching', /(?:do not|never)[\s\S]{0,500}(?:automatically switch|switch the active Photoshop document|photoshop_set_active_document)[\s\S]{0,600}(?:permission|preserve|background)/i],
  ['batching cannot cross semantic passes', /batching[\s\S]{0,500}(?:never|must never)[\s\S]{0,500}(?:independent semantic passes|preview\/inspection barrier)/i],
  ['VisualMicroPlan shared preview gate', /(?:VisualMicroPlan|photoshop_execute_visual_microplan)[\s\S]{0,1800}(?:1[–-]4|1\.\.4|bounded semantic|tightly related visual operations)[\s\S]{0,1800}(?:(?:shared|hard)[\s\S]{0,140}(?:visual|preview)[\s-]*barrier|HARD PREVIEW BARRIER)/i],
  ['structured visual critic', /observed[_ ]change[\s\S]{0,500}target[_ ]resolved[\s\S]{0,500}regressions[\s\S]{0,500}uncertainty/i],
  ['resolved visual problems are the primary progress metric', /primary progress metric[\s\S]{0,500}resolved visual problems/i],
  ['hard visual execution-evidence gate', /hard visual(?:[- ](?:significance|execution-evidence))? gate[\s\S]{0,900}meaningful[\s\S]{0,500}insufficient[\s\S]{0,500}unknown/i],
  ['unknown or no-op cannot be accepted as improvement', /(?:unknown|no-op)[\s\S]{0,350}(?:cannot|blocked|reject)[\s\S]{0,350}(?:improvement|improvement\s*\+\s*accept)|(?:improvement\s*\+\s*accept)[\s\S]{0,500}(?:unknown|no-op)[\s\S]{0,300}(?:blocked|reject|forbidden)/i],
  ['subtle local requires before and after focus evidence', /subtle_local[\s\S]{0,800}(?:before|BEFORE)[\s\S]{0,500}(?:after|AFTER)[\s\S]{0,500}focus/i],
  ['workflow stall blocks protocol churn', /workflow-stall gate[\s\S]{0,1000}(?:8 external actions|2 visually `insufficient` passes)[\s\S]{0,500}replan/i],
  ['hard visual cadence continues to the next pass', /hard visual[- ]cadence[\s\S]{0,1500}next[\s\S]{0,50}canonical cycle[\s\S]{0,500}next meaningful visual pass/i],
  ['get_state is not repeated between healthy visual passes', /photoshop_get_state[\s\S]{0,1200}(?:not required|do NOT repeat)[\s\S]{0,700}(?:normal pinned visual passes|normal visual passes)/i],
  ['diagnostic investigation is bounded', /(?:proven|demonstrated) systemic failure[\s\S]{0,700}one compact diagnostic investigation[\s\S]{0,900}(?:causal replan|next visual pass)/i],
  ['decision-loop stall is advisory continuation pressure', /decision_loop_stall[\s\S]{0,1800}(?:90 seconds|90s)[\s\S]{0,1800}(?:does \*\*not\*\* block|does not block|NOT a mutation blocker|advisory)/i],
  ['silent stall detects abandoned known-next-step state', /silent_stall[\s\S]{0,1800}(?:90 seconds|90s)[\s\S]{0,1800}(?:pending|known next|required action)[\s\S]{0,1800}(?:read-only|does not reset|do not reset)/i],
  ['checkpoint resumes the next visual cycle', /checkpoint[- ]due[\s\S]{0,900}(?:save|verify)[\s\S]{0,900}(?:next planned visual cycle|next meaningful visual pass)/i],
  ['mandatory checkpoint handles unavailable UXP fail closed', /^(?=[\s\S]*uxp_bridge_unavailable)(?=[\s\S]*photoshop_get_capabilities)(?=[\s\S]*(?:no|never|do not)[^\n]{0,200}(?:COM|ExtendScript)|[\s\S]*(?:COM|ExtendScript)[^\n]{0,200}(?:no|never|do not))(?=[\s\S]*(?:no next visual mutation|do not[^\n]{0,120}visual mutation|painting progression[^\n]{0,120}blocked))(?=[\s\S]*(?:retry only[^\n]{0,120}save|retry[^\n]{0,120}save only))[\s\S]*$/i],
  ['sticky commentary modes', /режим техника[\s\S]{0,700}режим художник[\s\S]{0,700}режим вместе|режим техника\|художник\|вместе/i],
  ['artistic commentary is tutorial rationale not hidden reasoning', /(?:artistic|художник)[\s\S]{0,1400}(?:natural Russian|natural, good Russian|Russian only)[\s\S]{0,1800}(?:hidden chain-of-thought|private chain-of-thought)/i],
  ['state-based completion', /DEFINITION OF DONE|Definition of Done/i],
];

const failures = [];
if (kernel.length > 13_000) failures.push('working kernel exceeds 13000 characters');
for (const name of policyModules) {
  if (!kernel.includes('painting-policy/' + name)) failures.push('kernel missing module route: ' + name);
}
for (const token of [
  'photoshop_guard_cycle_auto', 'confirmed_targets.document_id',
  'next_pass', 'request_key', 'previous_observation', 'compact finalization',
  'artistic_commentary', 'protected_layer_ids',
  '3–7', 'COMPOSITION → SHAPE → VALUE → FORM → EDGE → MATERIAL → DETAIL',
  'BEFORE/AFTER', 'trend_signals', 'NEGATIVE', 'no-op', 'PSD',
  'Absent/corrupt/claimed', 'Document count=0', 'hard user caps',
  'strongest earlier accepted state', 'Art Director', 'value gate',
]) {
  if (!kernel.includes(token)) failures.push('kernel missing operational invariant: ' + token);
}
for (const [name, text] of [['kernel', kernel], ['prompt', prompt], ['instructions', instructions]]) {
  for (const token of ['next_pass', 'request_key', 'previous_operation_id', 'previous_observation']) {
    if (!text.includes(token)) failures.push(name + ' missing compact closure field: ' + token);
  }
}
for (const [name, pattern] of sharedInvariants) {
  if (!pattern.test(skill)) failures.push(`skill missing invariant: ${name}`);
  if (!pattern.test(prompt)) failures.push(`prompt missing invariant: ${name}`);
}

const skillSections = [
  '## Core controller',
  '## Conditional modules',
  '## Development, evaluation and operational recovery',
  '## Completion',
];
for (const section of skillSections) {
  if (!skill.includes(section)) failures.push(`skill missing structural section: ${section}`);
}

if (skill.includes('## Current implementation note')) {
  failures.push('skill reintroduced Current implementation note; implementation details belong in digital-painting.md');
}

if (!implementation.includes('digital-painting-agent-skill.md')) {
  failures.push('digital-painting.md must point to the canonical agent skill');
}
for (const token of ['режим техника', 'режим художник', 'режим вместе']) {
  if (!instructions.includes(token)) failures.push(`instructions missing commentary switch: ${token}`);
}
if (/### Live free-composition lessons/i.test(implementation)) {
  failures.push('digital-painting.md reintroduced a duplicate policy/lessons section');
}

if (!/GetObject\(,\s*["']Photoshop\.Application["']\)/i.test(windowsExecutor)) {
  failures.push('Windows executor must attach to running Photoshop with GetObject in background-safe mode');
}
if (!/PHOTOSHOP_MCP_ALLOW_UI_ACTIVATION/i.test(windowsExecutor)) {
  failures.push('Windows executor must gate CreateObject behind explicit UI-activation opt-in');
}
if (!/Refusing CreateObject because it may activate\/foreground Photoshop/i.test(windowsExecutor)) {
  failures.push('Windows executor must refuse CreateObject by default to prevent foreground activation');
}
if (!/protectForeground\s*=\s*process\.env\.PHOTOSHOP_MCP_ALLOW_UI_ACTIVATION\s*!==\s*['"]1['"]/i.test(windowsExecutor)) {
  failures.push('Windows executor must keep the foreground guard enabled unless UI activation is explicitly opted in');
}
if (!/createWindowsForegroundGuardPowerShell\(\)/.test(windowsExecutor) || !/windowsHide:\s*true/.test(windowsExecutor)) {
  failures.push('Windows executor must run the no-focus-steal foreground guard hidden during legacy execution');
}

if (!/Legacy external-script connection retained strictly as the pre-dispatch[\s\S]{0,300}fallback backend/i.test(connection)) {
  failures.push('PhotoshopConnection must document legacy execution as pre-dispatch fallback only');
}
if (!/Callers must never catch a possibly-dispatched UXP command and replay it here/i.test(connection)) {
  failures.push('PhotoshopConnection must explicitly forbid replaying possibly-dispatched UXP commands through legacy transport');
}

if (!/UXP-first with a bounded, pre-dispatch ExtendScript\/COM fallback/i.test(backendRouter)) {
  failures.push('PhotoshopBackendRouter must declare UXP-first bounded pre-dispatch fallback');
}
if (!/new UxpPhotoshopBackend\(\)[\s\S]{0,160}new ExtendScriptPhotoshopBackend\(connection\)/.test(backendRouter)) {
  failures.push('PhotoshopBackendRouter must order UXP before ExtendScript/COM');
}
if (!/const uxpAvailable\s*=\s*uxp\s*\?\s*await uxp\.isAvailable\(\)\s*:\s*null;[\s\S]{0,1400}if \(uxp && uxpAvailable\)[\s\S]{0,1400}return uxp;[\s\S]{0,1400}const legacyAvailable\s*=\s*legacy\s*\?\s*await legacy\.isAvailable\(\)\s*:\s*null;[\s\S]{0,1400}if \(legacy && legacyAvailable\)[\s\S]{0,1400}return legacy;/.test(backendRouter)) {
  failures.push('PhotoshopBackendRouter must select legacy only after UXP is unavailable before dispatch');
}
if (!/chosen backend executes exactly once[\s\S]{0,220}must not catch[\s\S]{0,220}replay/i.test(backendRouter)) {
  failures.push('PhotoshopBackendRouter must preserve the no cross-backend replay contract after dispatch');
}

for (const [name, text] of [['kernel', kernel], ['prompt', prompt], ['painting policy', skill]]) {
  if (/photoshop_execute_script/i.test(text)) {
    failures.push(`${name} must not advertise raw photoshop_execute_script on the canonical painting path`);
  }
}
if (!/raw mutating tools fail closed with[^\n]{0,40}guard_required/i.test(instructions)) {
  failures.push('instructions must keep raw mutating tools behind guard_required');
}
if (!/raw_mutation_bypass_blocked:\s*EMBEDDED_GUARD_REQUIRED/.test(guardRuntime)) {
  failures.push('embedded Guard capabilities must expose raw_mutation_bypass_blocked');
}
if (!/rawMutationBlocked\([\s\S]{0,500}['"]guard_required['"]/.test(guardRuntime)) {
  failures.push('embedded Guard runtime must fail raw mutation bypass with guard_required');
}

// Keep the runtime guide compact enough that it remains an executable kernel,
// not a second copy of the canonical markdown policy.
const promptChars = prompt.length;
if (promptChars > 18_000) {
  failures.push(`digital-painting-control.ts is too large (${promptChars} chars > 18000 compactness guard)`);
}

if (failures.length) {
  console.error('Digital painting policy verification failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  `OK: digital painting policy kernel is consistent; kernel=${kernel.length} chars, detailed-policy=${skill.length} chars, prompt=${promptChars} chars.`
);
