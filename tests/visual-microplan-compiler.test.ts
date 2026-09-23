import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compileVisualMicroPlan } from '../src/core/visual-microplan-compiler.js';
import { parseVisualMicroPlan } from '../src/core/visual-microplan.js';
import { selectPaintingMethod } from '../src/core/painting-method-palette.js';
import { ToolRegistry } from '../src/core/tool-registry.js';
import { createPaintingTools } from '../src/tools/painting-tools.js';
import {
  createVisualMicroPlanTools,
  preflightVisualMicroPlan,
  preflightVisualMicroPlanForExecution,
} from '../src/tools/visual-microplan-tools.js';
import type { PhotoshopConnection } from '../src/platform/connection.js';
import { executeLogicalOperation, preflightRejectionEnvelope } from '../src/core/guard/cycle.js';

function fixture(name = 'region') {
  const doc = readFileSync(new URL('../docs/visual-microplan-contract-fixtures.md', import.meta.url), 'utf8');
  const marker = `<!-- fixture:${name} -->`;
  const section = doc.split(marker)[1];
  if (!section) throw new Error(`missing contract fixture ${name}`);
  const json = section.split('```json')[1]?.split('```')[0];
  if (!json) throw new Error(`missing JSON body for contract fixture ${name}`);
  return JSON.parse(json);
}

function template() {
  return fixture('region');
}

function registry() {
  const registry = new ToolRegistry();
  const calls: string[] = [];
  const regions = createPaintingTools({} as PhotoshopConnection).find(d => d.tool.name === 'photoshop_paint_regions')!;
  registry.register(regions.tool.name, { ...regions, handler: async () => {
    calls.push('paint'); return { content: [{ type: 'text', text: '{"ok":true}' }] };
  } });
  for (const name of ['photoshop_create_layer', 'photoshop_get_preview']) {
    registry.register(name, { tool: { name, inputSchema: { type: 'object', properties: {} } }, handler: async () => {
      calls.push(name); return { content: [{ type: 'text', text: '{"ok":true,"details":{"layerId":77},"sha256":"frame"}' }] };
    } });
  }
  registry.register('photoshop_list_documents', {
    tool: { name: 'photoshop_list_documents', inputSchema: { type: 'object', properties: {} } },
    handler: async () => ({
      content: [{ type: 'text', text: JSON.stringify({
        ok: true,
        details: { documents: [{ id: 42, width: 100, height: 100 }] },
      }) }],
    }),
  });
  return { registry, calls };
}

function resultBody(result: { content: Array<{ type: string; text?: string }> }) {
  const text = result.content.find(item => item.type === 'text')?.text;
  return JSON.parse(text ?? '{}');
}

describe('microplan request compilation and pre-dispatch diagnostics', () => {
  it('keeps protocol fixtures distinct from artistic method selection', () => {
    const doc = readFileSync(new URL('../docs/visual-microplan-contract-fixtures.md', import.meta.url), 'utf8');
    expect(doc).toMatch(/not an artistic recipe/i);
    expect(doc).toMatch(/must not be used as an\s+allowlist/i);

    expect(parseVisualMicroPlan(compileVisualMicroPlan(fixture('region'))).methodClass).toBe('region');
    expect(parseVisualMicroPlan(compileVisualMicroPlan(fixture('paint'))).methodClass).toBe('paint');

    const methods = new ToolRegistry();
    for (const name of ['photoshop_apply_gradient_mask', 'photoshop_adjust_curves']) {
      methods.register(name, {
        tool: { name, inputSchema: { type: 'object', properties: {} } },
        handler: async () => ({ content: [{ type: 'text', text: '{"ok":true}' }] }),
      });
    }
    for (const name of ['mask-composite', 'adjustment']) {
      const contract = fixture(name);
      const selected = selectPaintingMethod(methods, contract.visual_intent, contract.impact_class);
      expect(selected.selected.methodClass).toBe(contract.expected_method_class);
      expect(selected.selected.primaryTool).toBe(contract.expected_primary_tool);
    }
  });

  it('compiles protocol defaults without changing input or artistic metadata', () => {
    const input = template();
    input.stage = 'BLOCKIN';
    input.steps.pop();
    input.steps[1].method_id = 'region-fill-closed-contours';
    delete input.steps[1].args.regions[0].layer_id;
    const compiled = compileVisualMicroPlan(input);
    const parsed = parseVisualMicroPlan(compiled);
    expect(parsed.stage).toBe('GLOBAL_BLOCK_IN');
    expect(parsed.steps[1]!.methodId).toBe('region-block-in');
    expect(parsed.steps.at(-1)!.tool).toBe('photoshop_get_preview');
    expect(parsed.intent).toBe(input.intent);
    expect(input.steps).toHaveLength(2);
    expect(input.steps[1].args.regions[0].layer_id).toBeUndefined();
    expect(compileVisualMicroPlan(compiled)).toEqual(compiled);
  });

  it('normalizes the explicit MASS_BLOCK_IN alias without fuzzy stage matching', () => {
    const compiled = compileVisualMicroPlan({ stage: 'MASS_BLOCK_IN' });
    expect(compiled.stage).toBe('GLOBAL_BLOCK_IN');
  });

  it('never overwrites explicit wrong targets and treats legacy step intent as description', () => {
    const input = template();
    input.steps[1].args.regions[0].layer_id = 999;
    expect(() => parseVisualMicroPlan(compileVisualMicroPlan(input))).toThrow(/target/);
    input.steps[1].args.regions[0].layer_id = '$steps.layer.details.layerId';
    input.steps[1].intent = 'A conflicting artistic intent';
    const compiled = compileVisualMicroPlan(input) as any;
    expect(compiled.steps[1].intent).toBeUndefined();
    expect(compiled.steps[1].description).toBe('A conflicting artistic intent');
    expect(parseVisualMicroPlan(compiled).steps[1]!.description).toBe('A conflicting artistic intent');
  });

  it('returns independent nested and method errors together without any preparation', async () => {
    const input = template();
    input.steps[1].args.regions[0].contours = [];
    input.steps[1].args.regions[0].color.red = 999;
    input.steps[1].method_id = 'invented-method';
    const { registry: tools, calls } = registry();
    const result = await createVisualMicroPlanTools(tools)[0]!.handler(input);
    const body = JSON.parse((result.content[0] as { text: string }).text);
    expect(body.execution).toBe('not-executed');
    expect(body.message).toMatch(/contours/);
    expect(body.message).toMatch(/red/);
    expect(body.message).toMatch(/invented-method/);
    expect(body.message).toMatch(/region-block-in/);
    expect(calls).toEqual([]);
  });

  it('runs a compiled first pass and a second pass with one verdict per pass', async () => {
    const input = template();
    input.stage = 'BLOCKIN';
    input.steps.pop();
    input.steps[1].method_id = 'region-fill-closed-contours';
    const { registry: tools, calls } = registry();
    const handler = createVisualMicroPlanTools(tools)[0]!.handler;
    expect((await handler(input)).isError).not.toBe(true);
    expect((await handler({ ...input, plan_id: 'second', previous_preview: {
      sha256: 'frame', observed_change: 'Atmosphere now visible', target_resolved: 'yes',
      regressions: [], uncertainty: 'none', verdict: 'improvement', disposition: 'accept',
    } })).isError).not.toBe(true);
    expect(calls).toEqual(['photoshop_create_layer', 'paint', 'photoshop_get_preview',
      'photoshop_create_layer', 'paint', 'photoshop_get_preview']);
  });

  it('Guard rejects invalid payloads before the baseline preview or dispatch marker', async () => {
    const args = template();
    args.steps[1].args.regions[0].contours = [];
    const { registry: tools } = registry();
    const calls: string[] = [];
    let begins = 0;
    const result = await executeLogicalOperation({
      input: { id: 'invalid', tool: 'photoshop_execute_visual_microplan', args },
      store: { begin: () => { begins++; return { record: { id: 'invalid' }, replay: false }; },
        complete: (_record: unknown, result: unknown) => result,
        markDispatched: () => calls.push('dispatch') },
      invoke: async () => { calls.push('invoke'); },
      materializeArguments: (_tool: string, args: unknown) => args,
      preflight: (op: { args: Record<string, unknown> }) => preflightVisualMicroPlan(op.args, tools),
    });
    expect(result.preflightRejection.isError).toBe(true);
    expect(begins).toBe(0);
    expect(calls).toEqual([]);
  });

  it('rejects an unsupported stage before execution', () => {
    const input = template();
    input.stage = 'BLOCKIIN';
    const { registry: tools } = registry();
    const rejection = preflightVisualMicroPlan(input, tools)!;
    expect(resultBody(rejection).errors.join('\n')).toMatch(/stage must be one of/);
    expect(resultBody(rejection).execution).toBe('not-executed');
  });

  it('rejects an unknown method id before execution', () => {
    const input = template();
    input.steps[1].method_id = 'region-fill-made-up';
    const { registry: tools } = registry();
    const rejection = preflightVisualMicroPlan(input, tools)!;
    expect(resultBody(rejection).errors.join('\n')).toMatch(/unknown method_id=region-fill-made-up/);
  });

  it('does not reject free step prose that differs from the root intent', () => {
    const input = template();
    input.steps[1].intent = 'conflicting intent';
    const { registry: tools } = registry();
    expect(preflightVisualMicroPlan(input, tools)).toBeUndefined();
    const compiled = compileVisualMicroPlan(input) as any;
    expect(compiled.steps[1].description).toBe('conflicting intent');
  });

  it('rejects coordinates outside the current target document bounds', async () => {
    const input = template();
    input.steps[1].args.regions[0].contours[0].points[1].x = 101;
    const { registry: tools } = registry();
    const rejection = await preflightVisualMicroPlanForExecution(input, tools);
    expect(rejection).toBeDefined();
    expect(resultBody(rejection!).errors.join('\n')).toMatch(/outside document 42 bounds/);
  });

  it('returns independent stage, method, schema, and bounds errors in one rejection while ignoring step prose', async () => {
    const input = template();
    input.stage = 'BLOCKIIN';
    input.steps[1].method_id = 'region-fill-made-up';
    input.steps[1].intent = 'conflicting intent';
    input.steps[1].args.regions[0].color.red = 999;
    input.steps[1].args.regions[0].contours[0].points[0].x = 500;
    const { registry: tools } = registry();
    const rejection = await preflightVisualMicroPlanForExecution(input, tools);
    const errors = resultBody(rejection!).errors.join('\n');
    expect(errors).toMatch(/stage must be one of/);
    expect(errors).toMatch(/unknown method_id=region-fill-made-up/);
    expect(errors).not.toMatch(/intent must match micro-plan intent/);
    expect(errors).toMatch(/red/);
    expect(errors).toMatch(/outside document 42 bounds/);
  });

  it('returns terminal not-executed debt-free state and stable fingerprint on exact repeats', async () => {
    const input = template();
    input.steps[1].method_id = 'region-fill-made-up';
    const { registry: tools, calls } = registry();
    let begins = 0;
    const run = () => executeLogicalOperation({
      input: { id: 'repeat-invalid', tool: 'photoshop_execute_visual_microplan', args: input },
      store: {
        begin: () => { begins++; return { record: { id: 'repeat-invalid' }, replay: false }; },
        markDispatched: () => calls.push('dispatch'),
      },
      invoke: async () => { calls.push('invoke'); },
      materializeArguments: (_tool: string, value: unknown) => value,
      preflight: (op: { args: Record<string, unknown> }) => preflightVisualMicroPlanForExecution(op.args, tools),
    });
    const first = await run();
    const second = await run();
    const firstBody = resultBody(first.preflightRejection);
    const secondBody = resultBody(second.preflightRejection);
    expect(firstBody.rejection_fingerprint).toBe(secondBody.rejection_fingerprint);
    expect(firstBody.guard_debt).toEqual({
      visual_barrier: false,
      preview: false,
      visual_report: false,
      operation_ack: false,
      visual_verdict: false,
      rollback: false,
      reconciliation: false,
    });
    const envelope = preflightRejectionEnvelope(
      { id: 'repeat-invalid', tool: 'photoshop_execute_visual_microplan' },
      first.preflightRejection
    );
    expect(envelope.next_state).toBe('terminal_not_executed');
    expect(envelope.operation_receipt).toBeNull();
    expect(envelope.required_user_report).toBeNull();
    expect(envelope.required_operation_ack).toBeNull();
    expect(begins).toBe(0);
    expect(calls).toEqual([]);
  });

  it('replays the car-failure sequence as one pre-Photoshop rejection without oscillation', async () => {
    const input = template();
    input.stage = 'BLOCKIN';
    input.steps[1].method_id = 'region-fill-closed-contours';
    input.steps[1].intent = 'paint a different thing';
    input.steps[1].args.regions[0].contours[0].points[0] = { x: -25, y: 250 };
    const { registry: tools, calls } = registry();
    const compiled = compileVisualMicroPlan(input);
    expect(compiled.stage).toBe('GLOBAL_BLOCK_IN');
    expect((compiled.steps as any[])[1].method_id).toBe('region-block-in');
    const rejection = await preflightVisualMicroPlanForExecution(input, tools);
    const body = resultBody(rejection!);
    expect(body.execution).toBe('not-executed');
    expect(body.errors.join('\n')).not.toMatch(/intent must match micro-plan intent/);
    expect(body.errors.join('\n')).toMatch(/outside document 42 bounds/);
    expect(body.errors.join('\n')).not.toMatch(/unknown method_id=region-fill-closed-contours/);
    expect(body.guard_debt.reconciliation).toBe(false);
    expect(calls).toEqual([]);
  });

  it('keeps the valid Guard fast path to one guarded bundle and its one authoritative preview', async () => {
    const input = template();
    const { registry: tools, calls } = registry();
    const microplan = createVisualMicroPlanTools(tools)[0]!;
    tools.register(microplan.tool.name, microplan);
    let dispatches = 0;
    const run = await executeLogicalOperation({
      input: { id: 'valid-fast-path', tool: 'photoshop_execute_visual_microplan', args: input },
      store: {
        begin: (operation: any) => ({
          replay: false,
          record: {
            ...operation,
            phase: 'started',
            visual: true,
            baseline_preview: { sha256: 'accepted-baseline', document_id: 42 },
          },
        }),
        markDispatched: (record: any) => { dispatches++; return record; },
        complete: (record: any, result: any) => ({
          ...record,
          phase: 'completed',
          failed: false,
          result,
          preview: { sha256: 'frame' },
        }),
      },
      invoke: (name: string, args: Record<string, unknown>) => tools.execute(name, args),
      materializeArguments: (_tool: string, value: unknown) => value,
      preflight: (op: { args: Record<string, unknown> }) => preflightVisualMicroPlanForExecution(op.args, tools),
    });
    expect(run.preflightRejection).toBeUndefined();
    expect(dispatches).toBe(1);
    expect(run.record.phase).toBe('completed');
    expect(calls).toEqual(['photoshop_create_layer', 'paint', 'photoshop_get_preview']);
  });
});
