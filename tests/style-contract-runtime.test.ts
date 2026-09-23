import { describe, expect, it } from 'vitest';
import {
  evaluateWholeImageStyleDrift,
  projectStyleMethodTraitEvidence,
  projectStyleContractForPass,
  type OpenStyleContract,
} from '../src/core/style-contract-runtime.js';

const contract: OpenStyleContract = {
  edge_policy: 'crisp focal edges with lost secondary contours',
  mark_visibility: 'visible directional brush marks should remain legible',
  detail_density: 'sparse detail outside the focal third',
  color_policy: 'preserve muted warm/cool separation without neutralizing the shadows',
  layer_or_mask_bias: 'prefer reversible masks/layers over destructive flattening',
  finish_criteria: 'finish when hierarchy is clear and no secondary region competes with the focal area',
  custom_unseen_style_field: 'open-ended values remain legal',
};

describe('style contract runtime projection', () => {
  it('edge_policy changes edge-method expectations without restating unrelated fields', () => {
    const result = projectStyleContractForPass(contract, {
      stage: 'EDGE',
      changeDomains: ['local-edge'],
      methodClass: 'paint',
    });
    expect(result.method.edge_expectation).toBe(contract.edge_policy);
    expect(result.relevant_fields).toEqual({
      edge_policy: contract.edge_policy,
      mark_visibility: contract.mark_visibility,
    });
    expect(result.task).toEqual({});
    expect(result.critic).toEqual({});
  });

  it('detail_density changes task scale/stopping while mark_visibility changes mark treatment', () => {
    const dense = projectStyleContractForPass({
      detail_density: 'dense focal micro-detail',
      mark_visibility: 'hide individual marks into smooth rendering',
    }, {
      stage: 'DETAIL',
      changeDomains: ['local-texture'],
      methodClass: 'paint',
    });
    const sparse = projectStyleContractForPass({
      detail_density: 'minimal accents only',
      mark_visibility: 'retain broken visible bristle marks',
    }, {
      stage: 'DETAIL',
      changeDomains: ['local-texture'],
      methodClass: 'paint',
    });
    expect(dense.task.task_scale_hint).not.toBe(sparse.task.task_scale_hint);
    expect(dense.task.stopping_hint).not.toBe(sparse.task.stopping_hint);
    expect(dense.method.mark_treatment).not.toBe(sparse.method.mark_treatment);
  });

  it('color_policy changes critic preservation criteria', () => {
    const warm = projectStyleContractForPass({
      color_policy: 'preserve warm lights against cool shadows',
    }, {
      stage: 'FORM_AND_LIGHT',
      changeDomains: ['lighting-structure'],
    });
    const monochrome = projectStyleContractForPass({
      color_policy: 'keep the image nearly monochromatic',
    }, {
      stage: 'FORM_AND_LIGHT',
      changeDomains: ['lighting-structure'],
    });
    expect(warm.critic.color_preservation_criterion)
      .toBe('preserve warm lights against cool shadows');
    expect(monochrome.critic.color_preservation_criterion)
      .toBe('keep the image nearly monochromatic');
  });

  it('layer_or_mask_bias changes method preference without imposing a closed method enum', () => {
    const result = projectStyleContractForPass({
      layer_or_mask_bias: 'prefer adjustment layers and masks where equivalent',
    }, {
      stage: 'MATERIAL',
      changeDomains: ['local-texture'],
    });
    expect(result.method.preferred_method_traits).toEqual([
      'prefer adjustment layers and masks where equivalent',
    ]);
  });

  it('finish_criteria appears only in whole-image/final review', () => {
    const local = projectStyleContractForPass(contract, {
      stage: 'FORM',
      changeDomains: ['local-shape'],
    });
    expect(local.relevant_fields.finish_criteria).toBeUndefined();
    expect(local.critic.whole_image_finish_criterion).toBeUndefined();

    const final = projectStyleContractForPass(contract, {
      stage: 'FINAL_SELECTION',
      wholeImageReview: true,
    });
    expect(final.relevant_fields).toEqual({
      finish_criteria: contract.finish_criteria,
    });
    expect(final.critic.whole_image_finish_criterion).toBe(contract.finish_criteria);
  });

  it('keeps unknown/open-ended style fields legal but omits irrelevant ones from local projection', () => {
    const result = projectStyleContractForPass({
      custom_unseen_style_field: 'a previously unseen descriptive criterion',
      finish_criteria: 'whole image remains intentionally unresolved in the corners',
    }, {
      stage: 'EDGE',
      changeDomains: ['local-edge'],
    });
    expect(result).toEqual({
      relevant_fields: {},
      task: {},
      method: {},
      critic: {},
    });
  });

  it('projects bounded mechanism traits from relevant open-ended criteria, not named styles', () => {
    expect(projectStyleMethodTraitEvidence({
      mark_visibility: 'retain visible directional bristle marks',
      edge_policy: 'soft lost contours away from the focus',
      custom_unseen_style_field: 'Baroque-but-not-a-taxonomy',
    }, {
      stage: 'EDGE',
      changeDomains: ['local-edge', 'texture'],
      methodClass: 'paint',
    })).toEqual(expect.arrayContaining([
      expect.objectContaining({ trait: 'visible-marks', source_field: 'mark_visibility' }),
      expect.objectContaining({ trait: 'directional-marks', source_field: 'mark_visibility' }),
      expect.objectContaining({ trait: 'soft-edge', source_field: 'edge_policy' }),
    ]));
  });

  it('unknown fields and irrelevant known fields produce no method-selection traits', () => {
    expect(projectStyleMethodTraitEvidence({
      custom_unseen_style_field: 'visible textured whatever',
      finish_criteria: 'visible brush marks are fine at final review',
    }, {
      stage: 'COMPOSITION',
      changeDomains: ['layout'],
    })).toEqual([]);
  });
});

describe('whole-image style drift evaluator', () => {
  it('flags explicit style deviation even when structural observations are otherwise sound', () => {
    const result = evaluateWholeImageStyleDrift(contract, [
      {
        field: 'edge_policy',
        observed: 'All contours are uniformly hard and equally emphasized, while geometry remains coherent.',
        matchesDeclaredPolicy: 'no',
      },
      {
        field: 'color_policy',
        observed: 'Warm/cool separation is preserved.',
        matchesDeclaredPolicy: 'yes',
      },
      {
        field: 'finish_criteria',
        observed: 'Composition and perspective are structurally sound but secondary texture competes with the focal area.',
        matchesDeclaredPolicy: 'no',
      },
    ]);
    expect(result.advisoryOnly).toBe(true);
    expect(result.findings.map(finding => finding.field)).toEqual([
      'edge_policy',
      'finish_criteria',
    ]);
    expect(result.findings.every(finding => finding.advisoryOnly)).toBe(true);
  });

  it('reports uncertainty when an alternative explanation is supplied', () => {
    const result = evaluateWholeImageStyleDrift(contract, [{
      field: 'mark_visibility',
      observed: 'Marks appear smoother than the declared visible-brush treatment.',
      matchesDeclaredPolicy: 'no',
      alternativeExplanation: 'The preview downscale may suppress fine brush separation.',
    }]);
    expect(result.findings[0]).toMatchObject({
      field: 'mark_visibility',
      certainty: 'low',
      alternativeExplanation: 'The preview downscale may suppress fine brush separation.',
    });
  });

  it('does not invent drift for undeclared fields or uncertain/matching observations', () => {
    const result = evaluateWholeImageStyleDrift(contract, [
      {
        field: 'undeclared_policy',
        observed: 'Something differs.',
        matchesDeclaredPolicy: 'no',
      },
      {
        field: 'color_policy',
        observed: 'Color relation cannot be judged from this preview.',
        matchesDeclaredPolicy: 'uncertain',
      },
    ]);
    expect(result.findings).toEqual([]);
  });
});
