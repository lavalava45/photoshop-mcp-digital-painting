/**
 * Generate llms.txt, llms-full.txt for the marketing site (llmstxt.org v2).
 * Run: npx tsx scripts/generate-site-discoverability.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE_PUBLIC = join(ROOT, 'site', 'public');
const REPO_URL = 'https://github.com/lavalava45/photoshop-mcp-digital-painting';
const BRANCH = 'digital-painting';

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
/** Counts come from generate-site-data.ts so every surface reports the same numbers. */
const meta = JSON.parse(readFileSync(join(ROOT, 'site', 'data', 'meta.json'), 'utf8')) as {
  toolsTotal: number;
  toolsAtomic: number;
  toolsRecipes: number;
};

function readOptional(path: string, maxChars?: number): string {
  try {
    const text = readFileSync(path, 'utf8').trim();
    if (maxChars && text.length > maxChars) {
      return `${text.slice(0, maxChars).trimEnd()}…\n`;
    }
    return text;
  } catch {
    return '';
  }
}

function llmsTxt(): string {
  const v = pkg.version;
  return `# Photoshop MCP — Digital Painting Fork

> Independent community fork of Photoshop MCP — based on upstream ${v} — ${meta.toolsTotal} tools including digital painting, color sampling, landmarks/guides, previews, generative AI and ${meta.toolsRecipes} recipe workflows. Not an official upstream release and not affiliated with Adobe.

Important notes:

- Fork repository: ${REPO_URL}
- Original/upstream project: https://github.com/alisaitteke/photoshop-mcp
- The upstream website, npm package, and MCP Registry identity do not distribute this fork.
- Prefer \`photoshop_recipe_*\` for multi-step outcomes (single Photoshop undo step); use atomic \`photoshop_*\` tools for precise edits.
- Agent workflow: \`get_capabilities\` → \`get_state\` → act → \`get_preview\` to verify.
- Prerequisites: Adobe Photoshop running on Windows or macOS, Node.js 18+.
- Install this fork by cloning the GitHub repository, running \`npm install\` and \`npm run build:server\`, then pointing the MCP client at \`dist/index.js\` with Node.

## Docs

- [README](${REPO_URL}/blob/${BRANCH}/README.md)
- [Install](${REPO_URL}/blob/${BRANCH}/INSTALL.md)
- [Architecture](${REPO_URL}/blob/${BRANCH}/docs/architecture.md)
- [Available tools](${REPO_URL}/blob/${BRANCH}/docs/available-tools.md)
- [Digital painting](${REPO_URL}/blob/${BRANCH}/docs/digital-painting.md)
- [Digital painting agent skill](${REPO_URL}/blob/${BRANCH}/docs/digital-painting-agent-skill.md)
- [Development](${REPO_URL}/blob/${BRANCH}/docs/development.md)
- [Troubleshooting](${REPO_URL}/blob/${BRANCH}/docs/troubleshooting.md)

## Distribution

- Fork source/docs/issues: ${REPO_URL}
- Fork npm package: none; build from source
- Fork MCP Registry entry: none; use local stdio
- Original/upstream project: https://github.com/alisaitteke/photoshop-mcp

## Optional

- [Privacy and analytics](${REPO_URL}/blob/${BRANCH}/docs/anonymous-usage-analytics.md)
`;
}

function llmsFullTxt(): string {
  const architecture = readOptional(join(ROOT, 'docs', 'architecture.md'), 12000);
  const llmsRoot = readOptional(join(ROOT, 'llms.txt'), 8000);

  return [
    llmsTxt(),
    '',
    '---',
    '',
    '# Repository llms.txt (canonical npm/GitHub summary)',
    '',
    llmsRoot,
    '',
    '---',
    '',
    '# Architecture (excerpt from docs/architecture.md)',
    '',
    architecture,
  ].join('\n');
}

function rootLlmsTxt(): string {
  const v = pkg.version;
  return `# Photoshop MCP — Digital Painting Fork

> Independent digital-painting fork of Photoshop MCP, based on upstream ${v} — ${meta.toolsTotal} tools including painting, color sampling, landmarks/guides, previews, generative AI and ${meta.toolsRecipes} recipes. Unofficial; not affiliated with Adobe.

**This fork:** ${REPO_URL}
**Original/upstream:** https://github.com/alisaitteke/photoshop-mcp

## Quick start

\`\`\`bash
git clone ${REPO_URL}.git
cd photoshop-mcp-digital-painting
npm install
npm run build:server
node dist/index.js
\`\`\`

**Prerequisites:** Adobe Photoshop (Windows or macOS), Node.js 18+. Photoshop must be running. Optional UXP bridge plugin in \`uxp-plugin/\` for Neural Filters.

## Agent workflow

\`\`\`
get_capabilities → get_state → (recipe or atomic tool) → get_preview to verify
\`\`\`

Prefer \`photoshop_recipe_*\` for multi-step outcomes (single undo step). Use atomic \`photoshop_*\` tools for fine-grained edits. On failure, read structured error envelopes (\`code\`, \`suggested_next_tool\`) and call \`get_state\` before retrying.

## MCP client configuration

\`\`\`json
{
  "mcpServers": {
    "photoshop": {
      "command": "node",
      "args": ["/absolute/path/to/photoshop-mcp-digital-painting/dist/index.js"],
      "env": { "LOG_LEVEL": "1" }
    }
  }
}
\`\`\`

## Tool surface

- **${meta.toolsTotal} tools** — ${meta.toolsAtomic} atomic + ${meta.toolsRecipes} recipe (\`photoshop_recipe_*\`)
- **24 MCP prompts** — including \`ps.digital_painting_control\`
- **Generative AI** — fill, remove, expand, upscale, sky replacement, generate image (Adobe account)
- **State** — \`photoshop_get_state\`, \`photoshop_get_preview\`, \`photoshop_get_capabilities\`
- **Standalone UI** — Action Plan (beta): plan all steps in one LLM call, then execute

## Distribution

- Fork source/docs/issues: ${REPO_URL}
- Fork npm package: none
- Fork MCP Registry entry: none
- Original/upstream: https://github.com/alisaitteke/photoshop-mcp

## Documentation

- [README](${REPO_URL}/blob/${BRANCH}/README.md)
- [Install](${REPO_URL}/blob/${BRANCH}/INSTALL.md)
- [Architecture](${REPO_URL}/blob/${BRANCH}/docs/architecture.md)
- [Available tools](${REPO_URL}/blob/${BRANCH}/docs/available-tools.md)
- [Agent map](${REPO_URL}/blob/${BRANCH}/AGENTS.md)
`;
}

writeFileSync(join(SITE_PUBLIC, 'llms.txt'), llmsTxt(), 'utf8');
writeFileSync(join(SITE_PUBLIC, 'llms-full.txt'), llmsFullTxt(), 'utf8');
writeFileSync(join(ROOT, 'llms.txt'), rootLlmsTxt(), 'utf8');

console.log('discoverability files written: site/public/llms.txt, llms-full.txt, llms.txt');
