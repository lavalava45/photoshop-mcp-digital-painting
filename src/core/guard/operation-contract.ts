import { guardExecutionPolicyError } from './execution-policy.js';

export interface GuardOperationContractViolation {
  code: string;
  message: string;
}

const GENERATIVE_TOOL_PATTERNS = [
  /^photoshop_generative(?:_|$)/i,
  /^photoshop_generate_image$/i,
  /^photoshop_text_to_image$/i,
  /^photoshop_firefly(?:_|$)/i,
  /^photoshop_generate_(?:similar|variations)$/i,
];

export function isGenerativeToolName(toolName: string): boolean {
  const normalized = toolName.trim();
  return GENERATIVE_TOOL_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function collectOperationContractViolations(
  operation: Record<string, unknown>
): GuardOperationContractViolation[] {
  const tool = typeof operation.tool === 'string' ? operation.tool.trim() : '';
  if (tool && isGenerativeToolName(tool)) {
    return [{
      code: 'generative_tool_disabled_by_contract',
      message: `Generative tool ${tool} is disabled by the Guard contract.`,
    }];
  }
  const policyError = guardExecutionPolicyError(tool);
  return policyError ? [policyError] : [];
}
