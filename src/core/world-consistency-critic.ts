export const WORLD_RELATIONS = [
  'support',
  'contact',
  'attachment',
  'containment',
  'connectivity',
  'articulation',
  'count_topology',
  'gravity',
  'occlusion',
  'depth_order',
  'scale',
  'intersection',
] as const;

export type WorldRelation = (typeof WORLD_RELATIONS)[number];
export type WorldConsistencyCertainty = 'high' | 'medium' | 'low';

export interface WorldRelationObservation {
  id: string;
  relation: WorldRelation;
  subject: string;
  counterpart?: string;
  observed: string;
  uncertainty?: string;
}

export interface WorldConsistencyIntent {
  prompt: string;
  styleIntent?: string;
  explicitDepartures?: Partial<Record<WorldRelation, string>>;
}

export interface WorldConsistencyConflict {
  observationId: string;
  relation: WorldRelation;
  observedEvidence: string;
  ordinaryWorldExpectation: string;
  possibleAlternativeExplanation: string;
  certainty: WorldConsistencyCertainty;
  uncertainty: string;
  advisoryOnly: true;
}

export interface WorldConsistencyEvaluation {
  observations: WorldRelationObservation[];
  possibleConflicts: WorldConsistencyConflict[];
  evidence?: WorldConsistencyEvidence;
  criticResultId?: string;
  advisoryOnly: true;
}

export const WORLD_CONSISTENCY_CRITIC_PROTOCOL = 'photoshop.world_consistency_critic.v1' as const;

export interface WorldConsistencyEvidence {
  documentId: number;
  operationId: string;
  sha256: string;
  materializedPath: string;
  frameKind?: 'whole-frame' | 'focus-region';
  crop?: { left: number; top: number; right: number; bottom: number } | null;
}

export type WorldConsistencyJudgment = 'conflict' | 'consistent' | 'uncertain';

export interface WorldConsistencyCriticObservation extends WorldRelationObservation {
  judgment: WorldConsistencyJudgment;
}

export interface WorldConsistencyCriticRequest {
  protocol: typeof WORLD_CONSISTENCY_CRITIC_PROTOCOL;
  evidence: WorldConsistencyEvidence;
  intent: WorldConsistencyIntent;
  instructions: {
    observationStep: string;
    judgmentStep: string;
    noHiddenGeometry: true;
    advisoryOnly: true;
  };
}

export interface WorldConsistencyCriticResponse {
  protocol: typeof WORLD_CONSISTENCY_CRITIC_PROTOCOL;
  criticResultId: string;
  evidenceSha256: string;
  observations: WorldConsistencyCriticObservation[];
}

const ORDINARY_EXPECTATIONS: Record<WorldRelation, string> = {
  support: 'Objects affected by ordinary gravity normally show a plausible support path to a supporting surface or structure.',
  contact: 'Elements described as touching normally show visually plausible contact rather than an unexplained gap.',
  attachment: 'Elements described as attached normally show a plausible attachment relation at the joining region.',
  containment: 'Contained elements normally remain spatially consistent with the containing boundary unless an opening or overlap explains otherwise.',
  connectivity: 'Parts that form one structure normally connect continuously through plausible joins.',
  articulation: 'Articulated parts normally meet through a plausible joint or hinge relation for the depicted structure.',
  count_topology: 'The visible number and connectivity of structural parts normally remain topologically coherent unless the depiction intentionally departs from ordinary structure.',
  gravity: 'Unsupported objects in an ordinary-world scene normally follow the depicted gravity direction unless another force or support is established.',
  occlusion: 'Occlusion normally follows a consistent front/back relation at each overlap.',
  depth_order: 'Depth ordering normally remains consistent with overlap, contact, scale, and perspective evidence in the same region.',
  scale: 'Relative scale normally remains coherent with the depicted depth, shared environment, and stated subject relationships.',
  intersection: 'Opaque solid objects normally do not occupy the same volume unless penetration, transparency, deformation, or another explanation is established.',
};

function requiredText(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${name} must be a non-empty string`);
  return value.trim();
}

function requiredSha256(value: unknown, name: string): string {
  const sha = requiredText(value, name).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(sha)) throw new Error(`${name} must be a 64-character SHA-256 hex string`);
  return sha;
}

function normalizeEvidence(value: unknown): WorldConsistencyEvidence {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('world consistency evidence must be an object');
  }
  const row = value as Record<string, unknown>;
  const documentId = Number(row.documentId);
  if (!Number.isSafeInteger(documentId) || documentId <= 0) {
    throw new Error('evidence.documentId must be a positive integer');
  }
  const crop = row.crop == null ? row.crop as null | undefined : (() => {
    if (!row.crop || typeof row.crop !== 'object' || Array.isArray(row.crop)) {
      throw new Error('evidence.crop must be an object or null');
    }
    const raw = row.crop as Record<string, unknown>;
    const parsed = {
      left: Number(raw.left),
      top: Number(raw.top),
      right: Number(raw.right),
      bottom: Number(raw.bottom),
    };
    if (!Object.values(parsed).every(Number.isFinite) || parsed.right <= parsed.left || parsed.bottom <= parsed.top) {
      throw new Error('evidence.crop must contain finite non-empty bounds');
    }
    return parsed;
  })();
  const frameKind = row.frameKind === undefined ? undefined : requiredText(row.frameKind, 'evidence.frameKind');
  if (frameKind !== undefined && frameKind !== 'whole-frame' && frameKind !== 'focus-region') {
    throw new Error('evidence.frameKind must be whole-frame or focus-region');
  }
  return {
    documentId,
    operationId: requiredText(row.operationId, 'evidence.operationId'),
    sha256: requiredSha256(row.sha256, 'evidence.sha256'),
    materializedPath: requiredText(row.materializedPath, 'evidence.materializedPath'),
    ...(frameKind ? { frameKind: frameKind as WorldConsistencyEvidence['frameKind'] } : {}),
    ...(crop !== undefined ? { crop } : {}),
  };
}

function certaintyFor(observation: WorldRelationObservation, alternative: string): WorldConsistencyCertainty {
  if (observation.uncertainty) return 'low';
  if (alternative !== 'No alternative explanation is established by the supplied observation or intent.') return 'medium';
  return 'high';
}

function explicitDeparture(
  relation: WorldRelation,
  intent: WorldConsistencyIntent,
): string | undefined {
  const direct = intent.explicitDepartures?.[relation];
  if (direct && direct.trim()) return direct.trim();

  const combined = `${intent.prompt} ${intent.styleIntent ?? ''}`.toLowerCase();
  const genericDeparture = /(surreal|anti[- ]?gravity|zero[- ]?gravity|impossible architecture|dream logic|cubis|floating intentionally|levitat|defy gravity)/i;
  if (genericDeparture.test(combined) && ['support', 'contact', 'gravity', 'depth_order', 'intersection', 'connectivity', 'count_topology'].includes(relation)) {
    return 'The prompt/style explicitly permits departures from ordinary physical or structural expectations.';
  }
  return undefined;
}

function alternativeExplanation(observation: WorldRelationObservation, intent: WorldConsistencyIntent): string {
  const departure = explicitDeparture(observation.relation, intent);
  if (departure) return departure;
  if (observation.uncertainty) return observation.uncertainty;
  return 'No alternative explanation is established by the supplied observation or intent.';
}

export function observeWorldRelations(value: unknown): WorldRelationObservation[] {
  if (!Array.isArray(value)) throw new Error('world consistency observations must be an array');
  const ids = new Set<string>();
  return value.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`observations[${index}] must be an object`);
    const row = raw as Record<string, unknown>;
    const id = requiredText(row.id, `observations[${index}].id`);
    if (ids.has(id)) throw new Error(`duplicate world-consistency observation id ${id}`);
    ids.add(id);
    const relation = requiredText(row.relation, `observations[${index}].relation`) as WorldRelation;
    if (!WORLD_RELATIONS.includes(relation)) {
      throw new Error(`observations[${index}].relation must be one of ${WORLD_RELATIONS.join(', ')}`);
    }
    return {
      id,
      relation,
      subject: requiredText(row.subject, `observations[${index}].subject`),
      ...(row.counterpart === undefined ? {} : { counterpart: requiredText(row.counterpart, `observations[${index}].counterpart`) }),
      observed: requiredText(row.observed, `observations[${index}].observed`),
      ...(row.uncertainty === undefined ? {} : { uncertainty: requiredText(row.uncertainty, `observations[${index}].uncertainty`) }),
    };
  });
}

/**
 * Build the isolated whole-scene critic input from a registered Photoshop
 * preview. The request intentionally contains no expected conflict ids,
 * producer verdict, tool-success narrative or correction decision.
 */
export function buildWorldConsistencyCriticRequest(
  evidenceValue: unknown,
  intent: WorldConsistencyIntent,
): WorldConsistencyCriticRequest {
  requiredText(intent.prompt, 'intent.prompt');
  const evidence = normalizeEvidence(evidenceValue);
  return {
    protocol: WORLD_CONSISTENCY_CRITIC_PROTOCOL,
    evidence,
    intent: {
      prompt: intent.prompt.trim(),
      ...(intent.styleIntent?.trim() ? { styleIntent: intent.styleIntent.trim() } : {}),
      ...(intent.explicitDepartures ? { explicitDepartures: { ...intent.explicitDepartures } } : {}),
    },
    instructions: {
      observationStep: 'Describe only visible spatial/structural relations in the registered frame before judging correctness.',
      judgmentStep: 'For each observation classify conflict|consistent|uncertain against ordinary-world expectations given the prompt/style intent.',
      noHiddenGeometry: true,
      advisoryOnly: true,
    },
  };
}

function parseCriticObservations(value: unknown): WorldConsistencyCriticObservation[] {
  if (!Array.isArray(value)) throw new Error('critic response observations must be an array');
  const base = observeWorldRelations(value);
  return base.map((observation, index) => {
    const raw = value[index] as Record<string, unknown>;
    const judgment = requiredText(raw.judgment, `observations[${index}].judgment`) as WorldConsistencyJudgment;
    if (!['conflict', 'consistent', 'uncertain'].includes(judgment)) {
      throw new Error(`observations[${index}].judgment must be conflict|consistent|uncertain`);
    }
    return { ...observation, judgment };
  });
}

/**
 * Convert an isolated critic response into the advisory relation-conflict
 * projection. Frame identity is exact: a response for any other registered
 * preview is rejected instead of being adapted.
 */
export function evaluateRegisteredWorldConsistency(
  request: WorldConsistencyCriticRequest,
  responseValue: unknown,
): WorldConsistencyEvaluation {
  if (!responseValue || typeof responseValue !== 'object' || Array.isArray(responseValue)) {
    throw new Error('world consistency critic response must be an object');
  }
  const response = responseValue as Record<string, unknown>;
  if (response.protocol !== WORLD_CONSISTENCY_CRITIC_PROTOCOL) {
    throw new Error(`critic response protocol must be ${WORLD_CONSISTENCY_CRITIC_PROTOCOL}`);
  }
  const evidenceSha256 = requiredSha256(response.evidenceSha256, 'response.evidenceSha256');
  if (evidenceSha256 !== request.evidence.sha256) {
    throw new Error('critic response evidence SHA does not match the registered preview');
  }
  const observations = parseCriticObservations(response.observations);
  const criticResultId = requiredText(response.criticResultId, 'response.criticResultId');
  const possibleConflicts = observations.flatMap(observation => {
    if (observation.judgment === 'consistent') return [];
    const departure = explicitDeparture(observation.relation, request.intent);
    if (departure) return [];
    const alternative = alternativeExplanation(observation, request.intent);
    const uncertainty = observation.uncertainty
      ?? (observation.judgment === 'uncertain'
        ? 'The isolated critic could not establish the relation confidently from the registered frame.'
        : 'No material uncertainty was supplied with the observation.');
    return [{
      observationId: observation.id,
      relation: observation.relation,
      observedEvidence: observation.observed,
      ordinaryWorldExpectation: ORDINARY_EXPECTATIONS[observation.relation],
      possibleAlternativeExplanation: alternative,
      certainty: observation.judgment === 'uncertain' ? 'low' as const : certaintyFor(observation, alternative),
      uncertainty,
      advisoryOnly: true as const,
    }];
  });
  return {
    observations: observations.map(({ judgment: _judgment, ...observation }) => observation),
    possibleConflicts,
    evidence: { ...request.evidence },
    criticResultId,
    advisoryOnly: true,
  };
}

/**
 * Step two of the critic. The caller supplies observations produced without correctness
 * judgment; this function projects only possible ordinary-world conflicts. It is advisory
 * and intentionally has no blocking/Guard authority.
 */
export function evaluateWorldConsistency(
  observations: WorldRelationObservation[],
  intent: WorldConsistencyIntent,
  conflictObservationIds: string[],
): WorldConsistencyEvaluation {
  requiredText(intent.prompt, 'intent.prompt');
  const byId = new Map(observations.map(observation => [observation.id, observation]));
  const conflicts = conflictObservationIds.map((id, index) => {
    const observation = byId.get(id);
    if (!observation) throw new Error(`conflictObservationIds[${index}] references unknown observation id ${id}`);
    const alternative = alternativeExplanation(observation, intent);
    const departure = explicitDeparture(observation.relation, intent);
    if (departure) return null;
    return {
      observationId: observation.id,
      relation: observation.relation,
      observedEvidence: observation.observed,
      ordinaryWorldExpectation: ORDINARY_EXPECTATIONS[observation.relation],
      possibleAlternativeExplanation: alternative,
      certainty: certaintyFor(observation, alternative),
      uncertainty: observation.uncertainty ?? 'No material uncertainty was supplied with the observation.',
      advisoryOnly: true as const,
    };
  }).filter((value): value is WorldConsistencyConflict => value !== null);
  return {
    observations: observations.map(observation => ({ ...observation })),
    possibleConflicts: conflicts,
    advisoryOnly: true,
  };
}

export function ordinaryWorldExpectation(relation: WorldRelation): string {
  return ORDINARY_EXPECTATIONS[relation];
}
