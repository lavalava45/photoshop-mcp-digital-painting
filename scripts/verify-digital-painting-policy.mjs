import { readFile } from 'node:fs/promises';

const skillPath = new URL('../docs/digital-painting-agent-skill.md', import.meta.url);
const promptPath = new URL('../src/prompts/templates/digital-painting-control.ts', import.meta.url);
const implementationPath = new URL('../docs/digital-painting.md', import.meta.url);

const [skill, prompt, implementation] = await Promise.all([
  readFile(skillPath, 'utf8'),
  readFile(promptPath, 'utf8'),
  readFile(implementationPath, 'utf8'),
]);

const sharedInvariants = [
  ['hierarchy', /COMPOSITION\s*→\s*SHAPE\s*→\s*VALUE\s*→\s*FORM\s*→\s*EDGE\s*→\s*MATERIAL\s*→\s*DETAIL/i],
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
  ['high-frequency development capture', /100\+|100 or more/i],
  ['fresh-composition isolation', /fresh-composition/i],
  ['uncertain execution recovery', /timeout[\s\S]{0,900}(?:retry|recover|reconcile)/i],
  ['bounded brush inventory', /bounded brush inventory|bounded inventory/i],
  ['required user brushes', /required_brushes/i],
  ['brush settings after preset selection', /select_brush_preset[\s\S]{0,700}get_brush_settings/i],
  ['brush role map', /brush role map/i],
  ['correction acceptance gate', /correction acceptance gate/i],
  ['geometric integrity', /geometric(?:-| )(?:form(?:-| ))?integrity|manufactured\s*\/\s*geometric/i],
  ['paired PSD checkpoint', /paired PSD checkpoint|accepted intermediate checkpoint[\s\S]{0,400}PSD/i],
  ['atomic visual bundle definition', /atomic visual bundle[\s\S]{0,900}(?:one visual problem|one semantic region)/i],
  ['hard preview barrier', /hard preview barrier|no next visual mutation may begin[\s\S]{0,300}(?:captured|inspected)[\s\S]{0,300}(?:classified|regression)/i],
  ['batching cannot cross semantic passes', /batching[\s\S]{0,500}(?:never|must never)[\s\S]{0,500}(?:independent semantic passes|preview\/inspection barrier)/i],
  ['state-based completion', /DEFINITION OF DONE|Definition of Done/i],
];

const failures = [];
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
if (/### Live free-composition lessons/i.test(implementation)) {
  failures.push('digital-painting.md reintroduced a duplicate policy/lessons section');
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
  `OK: digital painting policy kernel is consistent; skill=${skill.length} chars, prompt=${promptChars} chars.`
);
