import { describe, expect, it } from 'vitest';
import {
  WORLD_RELATIONS,
  WORLD_CONSISTENCY_CRITIC_PROTOCOL,
  buildWorldConsistencyCriticRequest,
  evaluateRegisteredWorldConsistency,
  evaluateWorldConsistency,
  observeWorldRelations,
  type WorldConsistencyIntent,
} from '../src/core/world-consistency-critic.js';

interface Fixture {
  name: string;
  domain: 'people' | 'props' | 'architecture' | 'arbitrary';
  intent: WorldConsistencyIntent;
  observations: Array<Record<string, unknown>>;
  flaggedIds: string[];
  expectedConflicts: number;
}

const fixtures: Fixture[] = [
  {
    name: 'person connectivity failure',
    domain: 'people',
    intent: { prompt: 'Naturalistic standing figure.' },
    observations: [
      { id: 'limb-gap', relation: 'connectivity', subject: 'forearm', counterpart: 'hand', observed: 'The hand silhouette is separated from the forearm by a visible background gap.' },
    ],
    flaggedIds: ['limb-gap'],
    expectedConflicts: 1,
  },
  {
    name: 'prop floating above support',
    domain: 'props',
    intent: { prompt: 'A ceramic cup resting on a wooden table.' },
    observations: [
      { id: 'cup-support', relation: 'support', subject: 'cup', counterpart: 'table', observed: 'A narrow strip of background is visible between the cup base and tabletop.' },
      { id: 'cup-contact', relation: 'contact', subject: 'cup', counterpart: 'table', observed: 'No contact point is visible where the cup is described as resting.' },
    ],
    flaggedIds: ['cup-support', 'cup-contact'],
    expectedConflicts: 2,
  },
  {
    name: 'architecture unsupported overhang',
    domain: 'architecture',
    intent: { prompt: 'A realistic stone house built at the edge of a cliff.' },
    observations: [
      { id: 'house-gravity', relation: 'gravity', subject: 'house', counterpart: 'cliff', observed: 'Most of the building mass projects beyond the cliff edge and no support structure is visible.' },
    ],
    flaggedIds: ['house-gravity'],
    expectedConflicts: 1,
  },
  {
    name: 'arbitrary solid intersection',
    domain: 'arbitrary',
    intent: { prompt: 'Two rigid opaque geometric sculptures standing next to each other.' },
    observations: [
      { id: 'solid-crossing', relation: 'intersection', subject: 'blue sculpture', counterpart: 'red sculpture', observed: 'The two opaque silhouettes cross through the same central volume without a cutout or transparency cue.' },
    ],
    flaggedIds: ['solid-crossing'],
    expectedConflicts: 1,
  },
  {
    name: 'normal supported counterexample',
    domain: 'props',
    intent: { prompt: 'A bowl resting on a shelf.' },
    observations: [
      { id: 'bowl-ok', relation: 'support', subject: 'bowl', counterpart: 'shelf', observed: 'The bowl base meets the shelf along a continuous visible contact edge.' },
    ],
    flaggedIds: [],
    expectedConflicts: 0,
  },
  {
    name: 'normal occlusion counterexample',
    domain: 'architecture',
    intent: { prompt: 'A realistic street with one parked car partially behind a pillar.' },
    observations: [
      { id: 'occlusion-ok', relation: 'occlusion', subject: 'pillar', counterpart: 'car', observed: 'The pillar continuously occludes the same portion of the car across the overlap.' },
    ],
    flaggedIds: [],
    expectedConflicts: 0,
  },
  {
    name: 'explicit anti-gravity counterexample',
    domain: 'arbitrary',
    intent: { prompt: 'An explicit anti-gravity installation with stones levitating above the floor.', styleIntent: 'surreal anti-gravity' },
    observations: [
      { id: 'levitating-stone', relation: 'support', subject: 'stone', counterpart: 'floor', observed: 'The stone is visibly separated from the floor with no support.' },
    ],
    flaggedIds: ['levitating-stone'],
    expectedConflicts: 0,
  },
  {
    name: 'explicit impossible architecture counterexample',
    domain: 'architecture',
    intent: { prompt: 'Surreal impossible architecture: a tower deliberately floating upside down.', styleIntent: 'dream logic' },
    observations: [
      { id: 'floating-tower', relation: 'gravity', subject: 'tower', observed: 'The inverted tower has no visible support and floats above the landscape.' },
    ],
    flaggedIds: ['floating-tower'],
    expectedConflicts: 0,
  },
  {
    name: 'ambiguous hidden support',
    domain: 'arbitrary',
    intent: { prompt: 'A realistic suspended display object in a gallery.' },
    observations: [
      { id: 'hidden-support', relation: 'support', subject: 'display object', observed: 'The object appears above the plinth, but the upper attachment area is outside the crop.', uncertainty: 'A suspension cable or bracket may exist outside the visible crop.' },
    ],
    flaggedIds: ['hidden-support'],
    expectedConflicts: 1,
  },
];

function registeredRequest(intent: WorldConsistencyIntent, suffix = 'frame') {
  return buildWorldConsistencyCriticRequest({
    documentId: 42,
    operationId: `world-${suffix}`,
    sha256: 'a'.repeat(64),
    materializedPath: `/tmp/${suffix}.jpg`,
    frameKind: 'whole-frame',
    crop: null,
  }, intent);
}

function criticResponse(fixture: Fixture) {
  return {
    protocol: WORLD_CONSISTENCY_CRITIC_PROTOCOL,
    criticResultId: `critic-${fixture.name.replace(/\W+/g, '-').toLowerCase()}`,
    evidenceSha256: 'a'.repeat(64),
    observations: fixture.observations.map(observation => ({
      ...observation,
      judgment: fixture.flaggedIds.includes(String(observation.id))
        ? (observation.uncertainty ? 'uncertain' : 'conflict')
        : 'consistent',
    })),
  };
}

describe('world consistency critic contract', () => {
  it('uses one category-agnostic vocabulary for people, props, architecture and arbitrary objects', () => {
    expect(WORLD_RELATIONS).toEqual([
      'support', 'contact', 'attachment', 'containment', 'connectivity', 'articulation',
      'count_topology', 'gravity', 'occlusion', 'depth_order', 'scale', 'intersection',
    ]);
    const domains = new Set(fixtures.map(fixture => fixture.domain));
    expect(domains).toEqual(new Set(['people', 'props', 'architecture', 'arbitrary']));
  });

  it.each(fixtures)('$name', fixture => {
    const request = registeredRequest(fixture.intent, fixture.name);
    const result = evaluateRegisteredWorldConsistency(request, criticResponse(fixture));
    expect(result.advisoryOnly).toBe(true);
    expect(result.possibleConflicts).toHaveLength(fixture.expectedConflicts);
    expect(result.evidence).toEqual(request.evidence);
    expect(result.criticResultId).toMatch(/^critic-/);
    for (const conflict of result.possibleConflicts) {
      expect(conflict.advisoryOnly).toBe(true);
      expect(conflict.observedEvidence.length).toBeGreaterThan(0);
      expect(conflict.ordinaryWorldExpectation.length).toBeGreaterThan(0);
      expect(conflict.possibleAlternativeExplanation.length).toBeGreaterThan(0);
      expect(['high', 'medium', 'low']).toContain(conflict.certainty);
      expect(conflict.uncertainty.length).toBeGreaterThan(0);
    }
  });

  it('reports ambiguity as low certainty rather than inventing unseen support geometry', () => {
    const fixture = fixtures.find(row => row.name === 'ambiguous hidden support')!;
    const result = evaluateRegisteredWorldConsistency(registeredRequest(fixture.intent), criticResponse(fixture));
    expect(result.possibleConflicts[0]).toMatchObject({
      certainty: 'low',
      possibleAlternativeExplanation: 'A suspension cable or bracket may exist outside the visible crop.',
    });
    expect(result.possibleConflicts[0].observedEvidence).not.toMatch(/cable is|bracket is/i);
  });

  it('keeps the two evaluator steps structurally separate', () => {
    const request = registeredRequest({ prompt: 'Object A rests on object B.' });
    expect(request).not.toHaveProperty('conflictObservationIds');
    expect(JSON.stringify(request)).not.toMatch(/expectedConflict|flaggedIds|producer.*verdict/i);
    const evaluated = evaluateRegisteredWorldConsistency(request, {
      protocol: WORLD_CONSISTENCY_CRITIC_PROTOCOL,
      criticResultId: 'critic-contact-gap',
      evidenceSha256: request.evidence.sha256,
      observations: [
        { id: 'x', relation: 'contact', subject: 'object A', counterpart: 'object B', observed: 'A visible gap separates the two shapes.', judgment: 'conflict' },
      ],
    });
    expect(evaluated.observations[0]).not.toHaveProperty('ordinaryWorldExpectation');
    expect(evaluated.observations[0]).not.toHaveProperty('certainty');
    expect(evaluated.possibleConflicts[0].ordinaryWorldExpectation).toMatch(/touching|contact/i);
  });

  it('fails closed on invented relation names and conflict ids', () => {
    expect(() => observeWorldRelations([
      { id: 'bad', relation: 'hand_anatomy', subject: 'hand', observed: 'Something looks wrong.' },
    ])).toThrow(/must be one of/);
    const observed = observeWorldRelations([
      { id: 'known', relation: 'support', subject: 'object', observed: 'No support is visible.' },
    ]);
    expect(() => evaluateWorldConsistency(observed, { prompt: 'A realistic object.' }, ['missing'])).toThrow(/unknown observation id/);
    const request = registeredRequest({ prompt: 'A realistic object.' });
    expect(() => evaluateRegisteredWorldConsistency(request, {
      protocol: WORLD_CONSISTENCY_CRITIC_PROTOCOL,
      criticResultId: 'bad-relation',
      evidenceSha256: request.evidence.sha256,
      observations: [
        { id: 'bad', relation: 'hand_anatomy', subject: 'hand', observed: 'Something looks wrong.', judgment: 'conflict' },
      ],
    })).toThrow(/must be one of/);
  });

  it('binds the isolated critic result to the exact registered preview SHA', () => {
    const request = registeredRequest({ prompt: 'A cup rests on a table.' });
    expect(() => evaluateRegisteredWorldConsistency(request, {
      protocol: WORLD_CONSISTENCY_CRITIC_PROTOCOL,
      criticResultId: 'stale-frame-result',
      evidenceSha256: 'b'.repeat(64),
      observations: [],
    })).toThrow(/evidence SHA does not match/);
  });

  it('treats an explicit surreal departure as non-conflicting even if the isolated critic labels it conflict', () => {
    const fixture = fixtures.find(row => row.name === 'explicit anti-gravity counterexample')!;
    const result = evaluateRegisteredWorldConsistency(registeredRequest(fixture.intent), criticResponse(fixture));
    expect(result.possibleConflicts).toEqual([]);
  });
});

describe('world consistency evaluation fixture metric', () => {
  it('adds true detections over the current no-dedicated-critic baseline without correcting explicit surreal intent', () => {
    const labelled = fixtures.map(fixture => {
      const result = evaluateRegisteredWorldConsistency(registeredRequest(fixture.intent, fixture.name), criticResponse(fixture));
      return { fixture, detected: result.possibleConflicts.length > 0 };
    });
    const positive = labelled.filter(row => row.fixture.expectedConflicts > 0);
    const negative = labelled.filter(row => row.fixture.expectedConflicts === 0);

    const baselineDetected = 0;
    const criticTrueDetections = positive.filter(row => row.detected).length;
    const falsePositives = negative.filter(row => row.detected).length;
    const explicitSurrealFalsePositives = negative
      .filter(row => /surreal|anti-gravity|impossible architecture|dream logic/i.test(`${row.fixture.intent.prompt} ${row.fixture.intent.styleIntent ?? ''}`))
      .filter(row => row.detected).length;

    expect(criticTrueDetections).toBe(positive.length);
    expect(criticTrueDetections).toBeGreaterThan(baselineDetected);
    expect(falsePositives).toBe(0);
    expect(explicitSurrealFalsePositives).toBe(0);
  });
});
