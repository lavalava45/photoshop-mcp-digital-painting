export const EDGE_CLASSES = ['hard', 'soft', 'lost', 'firm', 'broken'];

function requiredString(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} must be a non-empty string`);
  return value.trim();
}

export function parseEdgeIntents(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('edges must be an array');
  const seen = new Set();
  return value.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`edges[${index}] must be an object`);
    const boundaryId = requiredString(raw.boundary_id, `edges[${index}].boundary_id`);
    if (seen.has(boundaryId)) throw new Error(`duplicate edge boundary_id ${boundaryId}`);
    seen.add(boundaryId);
    const regionA = requiredString(raw.region_a, `edges[${index}].region_a`);
    const regionB = requiredString(raw.region_b, `edges[${index}].region_b`);
    if (regionA === regionB) throw new Error(`edges[${index}] must reference two different regions`);
    const edgeClass = requiredString(raw.class, `edges[${index}].class`).toLowerCase();
    if (!EDGE_CLASSES.includes(edgeClass)) throw new Error(`edges[${index}].class must be one of ${EDGE_CLASSES.join(', ')}`);
    return { boundaryId, regionA, regionB, edgeClass };
  });
}

export function validateEdgeObservations(intents, value) {
  if (!intents.length) return [];
  if (!Array.isArray(value)) throw new Error('edge_observations are required for a micro-plan with edge intents');
  const expected = new Set(intents.map(intent => intent.boundaryId));
  const seen = new Set();
  const observations = value.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`edge_observations[${index}] must be an object`);
    const boundaryId = requiredString(raw.boundary_id, `edge_observations[${index}].boundary_id`);
    if (!expected.has(boundaryId)) throw new Error(`edge_observations[${index}] references unknown boundary_id ${boundaryId}`);
    if (seen.has(boundaryId)) throw new Error(`duplicate edge observation for ${boundaryId}`);
    seen.add(boundaryId);
    const targetMet = requiredString(raw.target_met, `edge_observations[${index}].target_met`).toLowerCase();
    if (!['yes', 'no', 'uncertain'].includes(targetMet)) throw new Error(`edge_observations[${index}].target_met must be yes|no|uncertain`);
    return {
      boundaryId,
      observedBehavior: requiredString(raw.observed_behavior, `edge_observations[${index}].observed_behavior`),
      targetMet,
    };
  });
  const missing = [...expected].filter(boundaryId => !seen.has(boundaryId));
  if (missing.length) throw new Error(`edge_observations missing boundary_id(s): ${missing.join(', ')}`);
  return observations;
}
