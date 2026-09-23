import { describe, expect, it } from 'vitest';
import { isRead, isVisual } from './session-store.js';

describe('Guard tool classification', () => {
  it('treats explicit document activation as preparation, not a visual mutation', () => {
    expect(isRead('photoshop_set_active_document')).toBe(false);
    expect(isVisual('photoshop_set_active_document')).toBe(false);
  });

  it('treats selection geometry changes as preparation rather than rendered-pixel mutations', () => {
    expect(isVisual('photoshop_expand_selection')).toBe(false);
    expect(isVisual('photoshop_contract_selection')).toBe(false);
    expect(isVisual('photoshop_feather_selection')).toBe(false);
  });

  it('keeps visual mutations and reads classified distinctly', () => {
    expect(isVisual('photoshop_fill_layer')).toBe(true);
    expect(isRead('photoshop_get_state')).toBe(true);
    expect(isVisual('photoshop_get_state')).toBe(false);
  });
});
