import { describe, expect, it } from 'vitest';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import {
  DOCUMENT_ID_SCHEMA_EXCLUDES,
  documentGuardScript,
  parseDocumentIdArg,
  withOptionalDocumentId,
} from '../src/core/document-target.js';

function fakeTool(name: string, properties: Record<string, unknown> = {}): Tool {
  return {
    name,
    description: 'test',
    inputSchema: { type: 'object', properties },
  };
}

describe('withOptionalDocumentId', () => {
  it('injects document_id on mutating tools', () => {
    const next = withOptionalDocumentId(fakeTool('photoshop_delete_layer'));
    const schema = next.inputSchema as { properties: Record<string, { type: string }> };
    expect(schema.properties.document_id.type).toBe('number');
  });

  it('does not inject on excluded tools', () => {
    for (const name of DOCUMENT_ID_SCHEMA_EXCLUDES) {
      const next = withOptionalDocumentId(fakeTool(name));
      const schema = next.inputSchema as { properties: Record<string, unknown> };
      expect(schema.properties.document_id).toBeUndefined();
    }
  });

  it('does not overwrite an existing document_id property', () => {
    const next = withOptionalDocumentId(
      fakeTool('photoshop_export_layers', {
        document_id: { type: 'string', description: 'already there' },
      })
    );
    const schema = next.inputSchema as { properties: Record<string, { type: string }> };
    expect(schema.properties.document_id.type).toBe('string');
  });
});

describe('parseDocumentIdArg', () => {
  it('accepts positive integers and rejects fractional or non-positive numbers', () => {
    expect(parseDocumentIdArg({ document_id: 12 })).toBe(12);
    expect(() => parseDocumentIdArg({ document_id: 12.9 })).toThrow('positive integer');
    expect(() => parseDocumentIdArg({ document_id: 0 })).toThrow('positive integer');
    expect(() => parseDocumentIdArg({ document_id: -1 })).toThrow('positive integer');
  });

  it('treats omission as optional and rejects explicitly invalid non-numbers', () => {
    expect(parseDocumentIdArg({})).toBeUndefined();
    expect(() => parseDocumentIdArg({ document_id: '1' })).toThrow('positive integer');
    expect(() => parseDocumentIdArg({ document_id: Number.NaN })).toThrow('positive integer');
  });
});

describe('documentGuardScript', () => {
  it('embeds the numeric id and document_not_found error', () => {
    const script = documentGuardScript(42);
    expect(script).toContain('var __mcp_targetDocId = 42;');
    expect(script).toContain('document_not_found');
  });
});
