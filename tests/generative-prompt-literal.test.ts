import { describe, expect, it } from 'vitest';
import { ExtendScriptSnippets } from '../src/api/extendscript.js';

describe('removed cloud-generation ExtendScript surface', () => {
  it('does not expose legacy generation snippets', () => {
    const snippets = ExtendScriptSnippets as unknown as Record<string, unknown>;
    expect(snippets.generativeHelpers).toBeUndefined();
    expect(snippets.generativeFill).toBeUndefined();
    expect(snippets.generativeRemove).toBeUndefined();
    expect(snippets.generativeExpand).toBeUndefined();
    expect(snippets.generativeUpscale).toBeUndefined();
    expect(snippets.generateImage).toBeUndefined();
    expect(snippets.skyReplacement).toBeUndefined();
  });
});
