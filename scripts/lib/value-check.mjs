export const VALUE_CHECK_STATUSES = ['pass', 'fail', 'override', 'style-not-applicable'];
export const VALUE_CHECK_CRITERIA = [
  'large_value_grouping',
  'focal_hierarchy',
  'silhouette_separation',
  'local_contrast_budget',
  'detail_before_form',
];
export const VALUE_CRITERION_STATUSES = ['pass', 'fail', 'uncertain', 'not-applicable'];

export function isDetailStage(stage) {
  if (typeof stage !== 'string') return false;
  return /(?:^|[_\s-])(detail|details|detailing|micro|micro-detail)(?:$|[_\s-])/i.test(stage.trim());
}
