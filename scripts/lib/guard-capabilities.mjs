export const GUARD_CAPABILITIES_PROTOCOL = 'photoshop.guard.capabilities.v1';
export const OPERATION_RECEIPT_PROTOCOL = 'photoshop.guard.operation_receipt.v1';
export const OPERATION_ACK_PROTOCOL = 'photoshop.guard.operation_ack.v1';
export const OPERATION_PROGRESS_PROTOCOL = 'operation.progress.v1';

export function guardCapabilities(env = process.env) {
  return {
    protocol: GUARD_CAPABILITIES_PROTOCOL,
    operation_ack: {
      required: true,
      receipt_protocol: OPERATION_RECEIPT_PROTOCOL,
      ack_protocol: OPERATION_ACK_PROTOCOL,
      owner: 'photoshop_guard',
    },
    progress: {
      protocol: OPERATION_PROGRESS_PROTOCOL,
      transport_neutral: true,
      compatibility_aliases: ['cos.host_progress.v1'],
    },
    host_render_receipt: {
      required_for_safety: false,
      available: env.COS_ASSISTANT_RECEIPT_VERSION === '1',
      role: 'optional_delivery_evidence',
    },
    visual_barrier: {
      durable: true,
      preview_required: true,
      verdict_required_before_next_visual_mutation: true,
    },
    postcondition_verification: {
      mode: 'tool_specific',
      executor_success_is_not_universal_proof: true,
      current_checks: [
        'visual mutations require a materialized after-preview',
        'visual acceptance requires exact preview SHA plus verdict',
        'PSD checkpoints require a non-empty file on disk',
      ],
      generic_state_readback: false,
    },
  };
}
