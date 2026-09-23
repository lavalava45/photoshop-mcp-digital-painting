export type PassScope = 'local' | 'global' | 'preparation';

export type PrerequisiteState = 'satisfied' | 'unresolved' | 'not_applicable';

export interface PassFacts {
  scope: PassScope;
  mutates_pixels: boolean;
  preparation_visible_effect_expected?: boolean;
  requires_document_target?: boolean;
  requires_layer_target?: boolean;
  uses_coordinates?: boolean;
  touches_protected_content?: boolean;
  changes_mask_clipping_order_blend?: boolean;
  requires_composite_effect_check?: boolean;
  value_prerequisite?: PrerequisiteState;
  recognition_prerequisite?: PrerequisiteState;
  stage_prerequisite?: PrerequisiteState;
  independent_region?: boolean;
}

export type PassCheck =
  | 'document_target'
  | 'layer_target'
  | 'coordinates'
  | 'protected_content'
  | 'mask_clipping_order_blend'
  | 'actual_composite_effect'
  | 'value_prerequisite'
  | 'recognition_prerequisite'
  | 'stage_prerequisite';

export interface PassCheckResolution {
  applicable_checks: PassCheck[];
  unresolved_prerequisites: PassCheck[];
  blocked_by_prerequisites: PassCheck[];
  independent_work_allowed: boolean;
  goal_achieved: false;
  host_round_trips_added: 0;
}

const PREREQUISITE_CHECKS: Array<{
  key: 'value_prerequisite' | 'recognition_prerequisite' | 'stage_prerequisite';
  state: keyof Pick<PassFacts, 'value_prerequisite' | 'recognition_prerequisite' | 'stage_prerequisite'>;
}> = [
  { key: 'value_prerequisite', state: 'value_prerequisite' },
  { key: 'recognition_prerequisite', state: 'recognition_prerequisite' },
  { key: 'stage_prerequisite', state: 'stage_prerequisite' },
];

export function resolvePassChecks(facts: PassFacts): PassCheckResolution {
  const applicable: PassCheck[] = [];

  if (facts.requires_document_target !== false) applicable.push('document_target');
  if (facts.requires_layer_target === true) applicable.push('layer_target');
  if (facts.uses_coordinates === true) applicable.push('coordinates');
  if (facts.touches_protected_content === true) applicable.push('protected_content');
  if (facts.changes_mask_clipping_order_blend === true) applicable.push('mask_clipping_order_blend');

  const needsCompositeEffect =
    facts.requires_composite_effect_check === true
    || (facts.mutates_pixels && facts.scope !== 'preparation')
    || (facts.scope === 'preparation' && facts.preparation_visible_effect_expected === true);
  if (needsCompositeEffect) applicable.push('actual_composite_effect');

  const unresolved: PassCheck[] = [];
  for (const prerequisite of PREREQUISITE_CHECKS) {
    const state = facts[prerequisite.state] ?? 'not_applicable';
    if (state === 'not_applicable') continue;
    applicable.push(prerequisite.key);
    if (state === 'unresolved') unresolved.push(prerequisite.key);
  }

  const independentWorkAllowed = unresolved.length > 0 && facts.independent_region === true;
  const blocked = independentWorkAllowed ? [] : [...unresolved];

  return {
    applicable_checks: applicable,
    unresolved_prerequisites: unresolved,
    blocked_by_prerequisites: blocked,
    independent_work_allowed: independentWorkAllowed,
    goal_achieved: false,
    host_round_trips_added: 0,
  };
}
