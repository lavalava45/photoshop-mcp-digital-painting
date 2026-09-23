# Digital Painting Implementation Index

This document maps the painting system to its implementation. It is **not an allowlist of tools**
and is not loaded as the agent's runtime painting prompt.

The absence of a Photoshop capability from this page does not forbid its use. The executable
surface is determined by the current runtime `ToolRegistry`, public tool schema and generated
capability information—not by a manually maintained Markdown list.

## Sources of truth

| Question | Authority |
| --- | --- |
| How the painting agent should work | [`digital-painting-agent-skill.md`](digital-painting-agent-skill.md) and [`painting-policy/`](painting-policy/) |
| What to implement next | [`PAINTING-ROADMAP.md`](PAINTING-ROADMAP.md) |
| Which tools exist in the current build | Runtime tool catalog and [`available-tools.md`](available-tools.md) |
| Which semantic painting methods are currently executable | Runtime method-capability snapshot produced from registered tools |
| Which backend each tool currently uses | [`uxp-migration-inventory.md`](uxp-migration-inventory.md) |
| Exact accepted fields and result shapes | Current public JSON schema and TypeScript compiler/runtime validators |
| Protocol conformance examples | [`visual-microplan-contract-fixtures.md`](visual-microplan-contract-fixtures.md); fixtures are tests, never artistic recipes |

Do not infer a closed painting palette from examples in documentation. General Photoshop
capabilities—documents, layers, selections, masks, transforms, adjustments, filters, blending,
history, persistence and export—remain available when registered and admitted by the current Guard.
The method compiler should select among actual capabilities according to the artistic pass, rather
than defaulting every problem to strokes, dabs or filled regions.
Contract fixtures must not influence that ranking. Mask/composite and adjustment requests remain
their own executable method families and must not be translated into region fills merely to fit a
VisualMicroPlan example.

## Runtime architecture

```text
compact artistic pass
  → Guard cycle compiler
  → semantic method/capability selection
  → internal ToolRegistry dispatch
  → PhotoshopBackendRouter
  → UXP or an explicitly reported unavailable capability
  → Photoshop
  → canonical preview evidence
  → model-owned artistic observation
```

Primary implementation areas:

- `src/core/guard/` — durable operation state, compilation, jobs, barriers and recovery;
- `src/core/visual-microplan.ts` — bounded semantic transaction execution;
- `src/tools/guard-tools.ts` — public guarded facade;
- `src/tools/method-palette-tools.ts` — semantic method and capability selection;
- `src/tools/painting-tools.ts` — brush/configuration and raster mark primitives;
- `src/tools/visual-microplan-tools.ts` — VisualMicroPlan schema/handler;
- `src/tools/measurement-tools.ts` — geometry and landmark helpers;
- `src/tools/value-check-tools.ts` — preview-derived value evidence;
- `src/core/refinement-check.ts` — durable subject-agnostic de-block-in/stage-exit evidence
  used by the existing Art Director/Guard DETAIL gate;
- other `src/tools/*` modules — the general Photoshop editing surface;
- `src/platform/photoshop-backend.ts` — semantic backend routing;
- `src/platform/uxp-bridge-client.ts` and `uxp-plugin/main.js` — Node/UXP protocol;
- `src/prompts/` — host-visible routing and compact runtime guidance.

This separation is organizational, not a permission boundary. A painting pass may compose any
registered, Guard-admitted Photoshop primitives that fit one coherent artistic operation.

## Maintained execution invariants

- Mutations use the embedded Guard; raw public mutation bypass fails closed.
- Document and layer identity stay pinned. Document-bound work never switches tabs implicitly.
- Backend selection is final before dispatch. A dispatched or uncertain mutation is never replayed
  automatically through another backend.
- Lost responses recover the original durable command/result; recovery does not create a substitute
  mutation.
- Technical execution and artistic resolution are separate facts. Tool success or pixel delta does
  not prove that the pass improved the image.
- DETAIL progression is also separate from texture/mark count: the durable `refinement_check`
  must close lower-frequency form/block-in debt or record an exact style-contract exception.
- Visual evidence belongs to the exact document and operation. BEFORE/AFTER comparison geometry must
  be canonical; unavailable machine comparison must be reported rather than invented.
- The agent supplies artistic goals and observations. Compiler/Guard own technical schema,
  preparation, receipts, closure and recovery bookkeeping.
- Photoshop must remain background-safe. No implementation may launch, foreground or switch the
  active application/document without the explicitly authorized route.

The current migration work for compact-only control, capability snapshots, configuration setters,
art-profile transitions, preview comparability and closure is specified in roadmap tasks 13a–13c.
Do not restate those evolving contracts here.

## Runtime capability discovery

The target design exposes one revision-bound capability snapshot at art-run start. It should include:

- supported semantic methods and their executable primitive families;
- installed/preflighted brush roles where applicable;
- pinned document and stable layer targets;
- unavailable capabilities and explicit bounded alternatives;
- compact contract, runtime and UXP bridge revisions.

The snapshot is cached for the matching revision and invalidated only by a real readiness, revision or
capability change. A healthy Painter must not read this file, source code or raw schemas between
passes to discover how to proceed.

Until that target is complete, the runtime method-capability tools and public catalog describe current
availability. Their output remains evidence, not an artistic decision and not permission to select the
smallest technically admissible primitive.

## Photoshop 27.8 / UXP implementation constraints

These are current executor facts, not artistic policy:

- In the accepted host, UXP Imaging API reads execute inside `core.executeAsModal` even though they
  are read-only.
- Assigning `app.foregroundColor` inside a painting modal can restore stale brush opacity/flow. The
  UXP painting implementation re-applies requested size/opacity/flow after the color write.
- Created stroke/dab paths are retrieved by unique name before `strokePath`; do not assume the path
  creation call returns a directly usable object in this host.
- The live-tested UXP runtime rejects narrowed loopback-domain manifest declarations. The companion
  manifest currently uses `domains: "all"`, while the Node bridge remains bound only to
  `127.0.0.1`. Do not broaden the listener.
- Public scripting layers tested so far do not expose arbitrary per-point native stylus samples.
  Simulated pressure and segmented dynamics are approximations, not real tablet replay.

When these host constraints change, update the implementation tests and this short section. Do not
retain dated experiment narratives here.

## Validation entry points

Use the narrow checks relevant to the changed package, then the acceptance gates required by the
roadmap item. Common repository checks include:

```text
npm run verify:tool-counts
npm run verify:photoshop-prompts
npm run verify:painting-policy
npm run build:server
npm run test:unit
npm run test:embedded-guard-mcp
```

Live Photoshop acceptance is required for behavior that depends on Photoshop pixels, history,
selection/target restoration, UXP modal behavior or foreground safety. Repository-green results do
not substitute for the explicitly named live acceptance in the roadmap.
