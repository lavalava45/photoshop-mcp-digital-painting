import type { ToolRegistry } from './tool-registry.js';
import {
  paintingMethodCapabilities,
  selectPaintingMethod,
  type PaintingImpactClass,
  type PaintingMethodCapability,
  type PaintingVisualIntent,
} from './painting-method-palette.js';
import {
  projectStyleMethodTraitEvidence,
  type OpenStyleContract,
} from './style-contract-runtime.js';

export interface ArtisticOperationRequest {
  visualIntent: PaintingVisualIntent;
  impactClass: PaintingImpactClass;
  stage?: string;
  preferredMethodId?: string;
  avoidMethodIds?: string[];
  documentId: number;
  layerId?: number;
  runtimeRevision: string;
  styleContract?: OpenStyleContract;
  styleChangeDomains?: string[];
}

export interface ArtisticOperationPlan {
  visualIntent: PaintingVisualIntent;
  impactClass: PaintingImpactClass;
  method: PaintingMethodCapability;
  fallbackFromMethodId?: string;
  allowedExecutionTools: string[];
  requiredPreparationTools: string[];
  documentId: number;
  layerId?: number;
  runtimeRevision: string;
}

export interface PreparationEvidence {
  tool: string;
  ok: boolean;
  documentId: number;
  layerId?: number;
  runtimeRevision: string;
  effectiveStateFingerprint?: string;
}

function methodMatches(
  method: PaintingMethodCapability,
  visualIntent: PaintingVisualIntent,
  impactClass: PaintingImpactClass,
): boolean {
  return method.visualIntents.includes(visualIntent) && method.impactClasses.includes(impactClass);
}

function executableTools(method: PaintingMethodCapability): string[] {
  if (method.executionTools?.length) return [...method.executionTools];
  return method.primaryTool ? [method.primaryTool] : [];
}

export function compileArtisticOperation(
  registry: ToolRegistry,
  request: ArtisticOperationRequest,
): ArtisticOperationPlan {
  const avoid = request.avoidMethodIds ?? [];
  const capabilities = paintingMethodCapabilities(registry);
  let method: PaintingMethodCapability | undefined;
  let fallbackFromMethodId: string | undefined;

  if (request.preferredMethodId) {
    const preferred = capabilities.find(item => item.id === request.preferredMethodId);
    if (preferred
      && methodMatches(preferred, request.visualIntent, request.impactClass)
      && preferred.availability !== 'unavailable'
      && !avoid.includes(preferred.id)) {
      method = preferred;
    } else {
      fallbackFromMethodId = request.preferredMethodId;
    }
  }

  if (!method) {
    const styleTraitEvidence = request.styleContract
      ? projectStyleMethodTraitEvidence(request.styleContract, {
        stage: request.stage ?? '',
        changeDomains: request.styleChangeDomains,
      })
      : undefined;
    method = selectPaintingMethod(
      registry,
      request.visualIntent,
      request.impactClass,
      avoid,
      { stage: request.stage, styleTraitEvidence },
    ).selected;
  }

  const allowedExecutionTools = executableTools(method);
  if (!allowedExecutionTools.length) {
    throw new Error('selected artistic method has no executable Photoshop primitive');
  }

  return {
    visualIntent: request.visualIntent,
    impactClass: request.impactClass,
    method,
    ...(fallbackFromMethodId ? { fallbackFromMethodId } : {}),
    allowedExecutionTools,
    requiredPreparationTools: [...(method.preparationTools ?? [])],
    documentId: request.documentId,
    ...(request.layerId !== undefined ? { layerId: request.layerId } : {}),
    runtimeRevision: request.runtimeRevision,
  };
}

export function validateArtisticOperationPreparation(
  plan: ArtisticOperationPlan,
  evidence: PreparationEvidence[],
): void {
  for (const requiredTool of plan.requiredPreparationTools) {
    const row = evidence.find(item => item.tool === requiredTool);
    if (!row || !row.ok) {
      throw new Error('artistic_method_preparation_missing: ' + requiredTool);
    }
    if (row.documentId !== plan.documentId) {
      throw new Error('artistic_method_preparation_stale_document: ' + requiredTool);
    }
    if (plan.layerId !== undefined && row.layerId !== undefined && row.layerId !== plan.layerId) {
      throw new Error('artistic_method_preparation_stale_layer: ' + requiredTool);
    }
    if (row.runtimeRevision !== plan.runtimeRevision) {
      throw new Error('artistic_method_preparation_stale_revision: ' + requiredTool);
    }
    if ((requiredTool === 'photoshop_set_brush' || requiredTool === 'photoshop_select_brush_preset')
      && !row.effectiveStateFingerprint) {
      throw new Error('artistic_method_preparation_missing_effective_state: ' + requiredTool);
    }
  }
}

export function validateArtisticOperationExecution(input: {
  plan: ArtisticOperationPlan;
  preparationEvidence: PreparationEvidence[];
  executedTool: string;
}): void {
  validateArtisticOperationPreparation(input.plan, input.preparationEvidence);
  if (!input.plan.allowedExecutionTools.includes(input.executedTool)) {
    throw new Error(
      'artistic_method_execution_mismatch: method=' + input.plan.method.id +
      ' expected=' + input.plan.allowedExecutionTools.join('|') +
      ' actual=' + input.executedTool,
    );
  }
}
