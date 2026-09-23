import type { ToolRegistry } from './tool-registry.js';
import { paintingMethodCapabilities, type PaintingMethodCapability } from './painting-method-palette.js';

export const EDGE_CLASSES = ['hard', 'soft', 'lost', 'firm', 'broken'] as const;
export type EdgeClass = (typeof EDGE_CLASSES)[number];

export interface EdgeIntent {
  boundaryId: string;
  regionA: string;
  regionB: string;
  edgeClass: EdgeClass;
  expectedBehavior: string;
  preferredMethodId?: string;
}

export interface EdgeObservation {
  boundaryId: string;
  observedBehavior: string;
  targetMet: 'yes' | 'no' | 'uncertain';
}

const EDGE_METHOD_PREFERENCE: Record<EdgeClass, string[]> = {
  hard: ['pencil-line', 'hard-brush-line', 'region-block-in', 'selection-mask', 'unsharp-sharpen'],
  firm: ['hard-brush-line', 'pencil-line', 'region-block-in', 'selection-mask'],
  soft: ['smudge-shape', 'soft-brush-build', 'gradient-mask', 'radial-gradient', 'smart-blur', 'gaussian-blur'],
  lost: ['smudge-shape', 'soft-brush-build', 'gaussian-blur', 'gradient-mask', 'radial-gradient', 'eraser-carve'],
  broken: ['installed-brush-preset', 'hard-brush-line', 'noise-texture', 'pencil-line'],
};

export const EDGE_EXPECTED_BEHAVIOR: Record<EdgeClass, string> = {
  hard: 'Boundary reads crisp and clearly separated, without unintended feathering.',
  firm: 'Boundary remains clearly readable but less cut-out than a hard edge.',
  soft: 'Boundary transitions gradually while the neighboring forms remain distinguishable.',
  lost: 'Boundary partially dissolves into the neighboring region so separation is intentionally reduced.',
  broken: 'Boundary is discontinuous/varied rather than uniformly traced, preserving a rough or irregular material read.',
};

function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} must be a non-empty string`);
  return value.trim();
}

export function parseEdgeIntents(value: unknown): EdgeIntent[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('edges must be an array');
  const seen = new Set<string>();
  return value.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`edges[${index}] must be an object`);
    const row = raw as Record<string, unknown>;
    const boundaryId = requiredString(row.boundary_id, `edges[${index}].boundary_id`);
    if (seen.has(boundaryId)) throw new Error(`duplicate edge boundary_id ${boundaryId}`);
    seen.add(boundaryId);
    const regionA = requiredString(row.region_a, `edges[${index}].region_a`);
    const regionB = requiredString(row.region_b, `edges[${index}].region_b`);
    if (regionA === regionB) throw new Error(`edges[${index}] must reference two different regions`);
    const rawClass = requiredString(row.class, `edges[${index}].class`).toLowerCase();
    if (!EDGE_CLASSES.includes(rawClass as EdgeClass)) {
      throw new Error(`edges[${index}].class must be one of ${EDGE_CLASSES.join(', ')}`);
    }
    const edgeClass = rawClass as EdgeClass;
    return {
      boundaryId,
      regionA,
      regionB,
      edgeClass,
      expectedBehavior: row.expected_behavior === undefined
        ? EDGE_EXPECTED_BEHAVIOR[edgeClass]
        : requiredString(row.expected_behavior, `edges[${index}].expected_behavior`),
      ...(row.preferred_method_id === undefined
        ? {}
        : { preferredMethodId: requiredString(row.preferred_method_id, `edges[${index}].preferred_method_id`) }),
    };
  });
}

export interface EdgeMethodSelection {
  edgeClass: EdgeClass;
  selected: PaintingMethodCapability;
  fallbacks: PaintingMethodCapability[];
  rejected: Array<{ id: string; reason: string }>;
  expectedBehavior: string;
}

export function selectEdgeMethod(
  registry: ToolRegistry,
  edgeClass: EdgeClass,
  options: { preferredMethodId?: string; avoidMethodIds?: string[] } = {}
): EdgeMethodSelection {
  const capabilities = paintingMethodCapabilities(registry);
  const byId = new Map(capabilities.map(capability => [capability.id, capability]));
  const allowed = EDGE_METHOD_PREFERENCE[edgeClass];
  const avoided = new Set(options.avoidMethodIds ?? []);
  const orderedIds = options.preferredMethodId
    ? [options.preferredMethodId, ...allowed.filter(id => id !== options.preferredMethodId)]
    : allowed;
  const rejected: Array<{ id: string; reason: string }> = [];
  let selected: PaintingMethodCapability | undefined;
  for (const id of orderedIds) {
    const capability = byId.get(id);
    if (!capability) {
      rejected.push({ id, reason: 'method is not present in the runtime capability map' });
      continue;
    }
    if (!allowed.includes(id)) {
      rejected.push({ id, reason: `method is not compatible with edge_class=${edgeClass}` });
      continue;
    }
    if (avoided.has(id)) {
      rejected.push({ id, reason: 'explicitly avoided by caller' });
      continue;
    }
    if (capability.availability === 'unavailable') {
      rejected.push({ id, reason: capability.availabilityReason });
      continue;
    }
    selected = capability;
    break;
  }
  if (!selected) throw new Error(`No executable method available for edge_class=${edgeClass}`);
  const fallbacks = allowed
    .filter(id => id !== selected!.id && !avoided.has(id))
    .map(id => byId.get(id))
    .filter((value): value is PaintingMethodCapability => !!value && value.availability !== 'unavailable');
  return {
    edgeClass,
    selected,
    fallbacks,
    rejected,
    expectedBehavior: EDGE_EXPECTED_BEHAVIOR[edgeClass],
  };
}

export function validateEdgeObservations(intents: EdgeIntent[], value: unknown): EdgeObservation[] {
  if (!intents.length) return [];
  if (!Array.isArray(value)) throw new Error('edge_observations are required for a micro-plan with edge intents');
  const expected = new Set(intents.map(intent => intent.boundaryId));
  const seen = new Set<string>();
  const observations = value.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`edge_observations[${index}] must be an object`);
    const row = raw as Record<string, unknown>;
    const boundaryId = requiredString(row.boundary_id, `edge_observations[${index}].boundary_id`);
    if (!expected.has(boundaryId)) throw new Error(`edge_observations[${index}] references unknown boundary_id ${boundaryId}`);
    if (seen.has(boundaryId)) throw new Error(`duplicate edge observation for ${boundaryId}`);
    seen.add(boundaryId);
    const targetMet = requiredString(row.target_met, `edge_observations[${index}].target_met`).toLowerCase();
    if (!['yes', 'no', 'uncertain'].includes(targetMet)) {
      throw new Error(`edge_observations[${index}].target_met must be yes|no|uncertain`);
    }
    return {
      boundaryId,
      observedBehavior: requiredString(row.observed_behavior, `edge_observations[${index}].observed_behavior`),
      targetMet: targetMet as EdgeObservation['targetMet'],
    };
  });
  const missing = [...expected].filter(boundaryId => !seen.has(boundaryId));
  if (missing.length) throw new Error(`edge_observations missing boundary_id(s): ${missing.join(', ')}`);
  return observations;
}
