// @ts-nocheck
import {
  VISUAL_MICROPLAN_MAX_LAYER_CREATIONS,
  VISUAL_MICROPLAN_MAX_MUTATIONS,
} from '../visual-microplan.js';

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
      compact_model_path_manual_token_copy_required: false,
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
    compact_pass_limits: {
      max_visual_mutations: VISUAL_MICROPLAN_MAX_MUTATIONS,
      max_layer_creations: VISUAL_MICROPLAN_MAX_LAYER_CREATIONS,
      mixed_method_classes_allowed: false,
      single_method_class: true,
      visual_mutations_must_be_contiguous: true,
      preparation_must_precede_visual_transaction: true,
      limits_source: 'VisualMicroPlan executor contract',
    },
    brush_preflight_dependency: {
      semantic: true,
      photoshop_paint_dabs: 'required',
      photoshop_paint_strokes: 'required_when_stroke_mechanism_is_BRUSH',
      non_brush_stroke_mechanisms: ['PENCIL', 'SMUDGE', 'ERASER'],
      not_required_merely_for_preparation: true,
      region_painting_requires_brush_preflight: false,
    },
    cycle_compiler: {
      unified_pre_dispatch_validation: true,
      aggregates_deterministic_errors: true,
      rejected_operations_create_guard_debt: false,
      compact_model_contract: {
        tool: 'photoshop_guard_cycle_auto',
        next_pass_supported: true,
        one_root_goal: true,
        request_key_is_durable_operation_identity: true,
        problem_id_is_stable_artistic_problem_identity: true,
        step_prose_is_explanatory: true,
        compact_visual_closure: ['previous_operation_id', 'previous_observation'],
        preferred_previous_observation: ['observed', 'target'],
        optional_previous_observation: [
          'regression', 'action', 'planner_task_assessment',
          'affected_relations', 'affected_qualities', 'preservation_facts', 'independent_region',
        ],
        outcome_scopes: ['execution_outcome', 'artistic_outcome', 'global_brief_outcome'],
        global_claim_evidence: ['active_contract_revision', 'exact_frame_sha256', 'authorized_critic_result'],
        machine_comparison_degrades_independently: true,
        monotonic_profile_upgrade: 'simple_graphic -> nontrivial_painting',
        technical_report_from_execution: true,
        durable_receipt_acknowledged_internally: true,
        post_closure_revalidation: 'state-dependent-only',
        prepared_visual_pass_reused_on_guard_route: true,
        structural_strategy_change_gate: true,
        legacy_replan_text_is_not_an_override: true,
        durable_brush_role_autoselection: true,
        legacy_full_contract_supported: false,
      },
    },
    compact_finalization: {
      supported: true,
      tool: 'photoshop_guard_cycle_auto',
      close_only_by_omitting_next_pass: true,
    },
    latency_telemetry: {
      protocol: 'photoshop.guard.cycle_latency.v1',
      summary_protocol: 'photoshop.guard.cycle_latency_summary.v1',
      unknown_time_remains_null: true,
      canonical_external_gap_field: 'inter_call_unattributed_gap_ms',
      request_json_bytes_recorded: true,
      model_call_count_observable: false,
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
    checkpoint_policy: {
      mode: 'mutation-risk-debt',
      fixed_pass_count_deadline: false,
      wall_clock_age_deadline: false,
    },
  };
}
