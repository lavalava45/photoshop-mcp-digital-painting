import { describe, expect, it } from 'vitest';
import { ExtendScriptSnippets } from '../src/api/extendscript.js';

describe('imageStackMode ExtendScript generation', () => {
  it('emits a flat array whose Windows/Unicode paths round-trip exactly once', () => {
    const files = [
      String.raw`C:\Users\Slava\Фото 1.jpg`,
      String.raw`D:\shots\Фото "2".jpg`,
    ];

    const script = ExtendScriptSnippets.imageStackMode(files, 'stackModeMedian');
    const match = script.match(/var files = (\[[^\n]+\]);/);
    expect(match, script).not.toBeNull();

    // The generated value is JavaScript/ExtendScript source, not JSON data.
    // Evaluating that isolated literal must reproduce the exact host paths.
    // eslint-disable-next-line no-new-func
    const parsed = Function(`return ${match![1]};`)();
    expect(parsed).toEqual(files);
    expect(parsed).toHaveLength(2);

    // Regression guard: the old implementation generated [[...]] here.
    expect(match![1]).not.toMatch(/^\[\s*\[/);
  });
});
