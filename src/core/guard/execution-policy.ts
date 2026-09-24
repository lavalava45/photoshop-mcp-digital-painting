export type GuardExecutionClass =
  | 'semantic-mutation'
  | 'read-only'
  | 'preparation-only'
  | 'retired'
  | 'forbidden';

const READ_ONLY_TOOLS = new Set([
  'photoshop_analyze_value_structure',
  'photoshop_compare_landmarks',
  'photoshop_get_brush_settings',
  'photoshop_get_capabilities',
  'photoshop_get_document_info',
  'photoshop_get_history',
  'photoshop_get_layers',
  'photoshop_get_painting_method_capabilities',
  'photoshop_get_preview',
  'photoshop_get_selection_bounds',
  'photoshop_get_state',
  'photoshop_get_version',
  'photoshop_list_brush_presets',
  'photoshop_list_datasets',
  'photoshop_list_documents',
  'photoshop_list_fonts',
  'photoshop_list_guides',
  'photoshop_measure_points',
  'photoshop_ping',
  'photoshop_sample_color',
  'photoshop_sample_colors',
  'photoshop_select_painting_method',
  'photoshop_transform_landmarks',
]);

const PREPARATION_ONLY_TOOLS = new Set([
  'photoshop_add_guides',
  'photoshop_clear_guides',
  'photoshop_contract_selection',
  'photoshop_create_document',
  'photoshop_create_layer',
  'photoshop_deselect',
  'photoshop_expand_selection',
  'photoshop_feather_selection',
  'photoshop_invert_selection',
  'photoshop_open_image',
  'photoshop_select_all',
  'photoshop_select_brush_preset',
  'photoshop_select_ellipse',
  'photoshop_select_layer_by_name',
  'photoshop_select_rectangle',
  'photoshop_select_subject',
  'photoshop_set_active_document',
  'photoshop_set_brush',
  'photoshop_set_foreground_color',
]);

const SEMANTIC_MUTATION_TOOLS = new Set([
  'photoshop_adjust_brightness_contrast',
  'photoshop_adjust_curves',
  'photoshop_adjust_exposure',
  'photoshop_adjust_hue_saturation',
  'photoshop_adjust_vibrance',
  'photoshop_apply_gaussian_blur',
  'photoshop_apply_gradient_map',
  'photoshop_apply_gradient_mask',
  'photoshop_apply_high_pass',
  'photoshop_apply_layer_mask',
  'photoshop_apply_layer_style',
  'photoshop_apply_lut',
  'photoshop_apply_motion_blur',
  'photoshop_apply_noise',
  'photoshop_apply_photo_filter',
  'photoshop_apply_sharpen',
  'photoshop_apply_smart_blur',
  'photoshop_auto_contrast',
  'photoshop_auto_levels',
  'photoshop_close_document',
  'photoshop_content_aware_fill',
  'photoshop_convert_to_smart_object',
  'photoshop_create_clipping_mask',
  'photoshop_create_layer_mask',
  'photoshop_create_smart_object_via_copy',
  'photoshop_create_text_layer',
  'photoshop_crop_document',
  'photoshop_delete_layer',
  'photoshop_delete_layer_mask',
  'photoshop_desaturate',
  'photoshop_duplicate_layer',
  'photoshop_edit_smart_object_contents',
  'photoshop_execute_visual_microplan',
  'photoshop_export_as',
  'photoshop_fill_layer',
  'photoshop_fit_layer_to_document',
  'photoshop_flatten_image',
  'photoshop_generate_from_datasets',
  'photoshop_image_stack',
  'photoshop_import_datasets',
  'photoshop_invert',
  'photoshop_merge_layer_down',
  'photoshop_merge_visible_layers',
  'photoshop_move_layer',
  'photoshop_move_layer_down',
  'photoshop_move_layer_to_bottom',
  'photoshop_move_layer_to_position',
  'photoshop_move_layer_to_top',
  'photoshop_move_layer_up',
  'photoshop_neural_filter',
  'photoshop_paint_dabs',
  'photoshop_paint_regions',
  'photoshop_paint_strokes',
  'photoshop_place_image',
  'photoshop_play_action',
  'photoshop_rasterize_layer',
  'photoshop_redo',
  'photoshop_release_clipping_mask',
  'photoshop_rename_layer',
  'photoshop_replace_smart_object_contents',
  'photoshop_resize_image',
  'photoshop_rotate_layer',
  'photoshop_save_document',
  'photoshop_save_selection',
  'photoshop_scale_layer',
  'photoshop_set_layer_blend_mode',
  'photoshop_set_layer_locked',
  'photoshop_set_layer_opacity',
  'photoshop_set_layer_visibility',
  'photoshop_set_text_alignment',
  'photoshop_set_text_color',
  'photoshop_set_text_font',
  'photoshop_sky_replacement',
  'photoshop_undo',
  'photoshop_update_text_content',
]);

const RETIRED_TOOLS = new Set([
  'photoshop_execute_script',
]);

export function guardExecutionClass(toolName: string): GuardExecutionClass {
  const tool = toolName.trim();
  if (RETIRED_TOOLS.has(tool)) return 'retired';
  if (READ_ONLY_TOOLS.has(tool)) return 'read-only';
  if (PREPARATION_ONLY_TOOLS.has(tool)) return 'preparation-only';
  if (SEMANTIC_MUTATION_TOOLS.has(tool)) return 'semantic-mutation';
  return 'forbidden';
}

export function guardToolIsExecutable(toolName: string): boolean {
  const category = guardExecutionClass(toolName);
  return category === 'read-only'
    || category === 'preparation-only'
    || category === 'semantic-mutation';
}

export function guardExecutionPolicyError(toolName: string): {
  code: string;
  message: string;
} | undefined {
  const tool = toolName.trim();
  const category = guardExecutionClass(tool);
  if (category === 'retired') {
    return {
      code: 'guard_tool_retired',
      message:
        `Guard execution policy rejects retired tool ${tool}. Raw ExtendScript is not reachable from the canonical compact-v2 lane.`,
    };
  }
  if (category === 'forbidden') {
    return {
      code: 'guard_tool_not_executable',
      message:
        `Guard execution policy does not authorize ${tool || '<missing tool>'}. Tool registration does not grant compact-v2 execution permission.`,
    };
  }
  return undefined;
}

export const GUARD_EXECUTION_POLICY_COUNTS = Object.freeze({
  read_only: READ_ONLY_TOOLS.size,
  preparation_only: PREPARATION_ONLY_TOOLS.size,
  semantic_mutation: SEMANTIC_MUTATION_TOOLS.size,
  retired: RETIRED_TOOLS.size,
});
