import { ExtendScriptSnippets } from '../api/extendscript.js';
import { PhotoshopAPIFactory } from '../api/photoshop-api.js';
import { parseExtendScriptPayload } from '../utils/extendscript-result.js';
import { PhotoshopConnection } from './connection.js';
import {
  invokeUxpCapturePreview,
  invokeUxpGetSelectionBounds,
  invokeUxpGetBrushSettings,
  invokeUxpGetHistory,
  invokeUxpGetState,
  invokeUxpListDocuments,
  invokeUxpListLayers,
  invokeUxpListBrushPresets,
  invokeUxpSampleColor,
  invokeUxpSampleColors,
  isUxpBridgeReachable,
} from './uxp-bridge-client.js';

export type PhotoshopPrimitive =
  | 'state.read'
  | 'document.info'
  | 'documents.list'
  | 'selection.bounds'
  | 'layers.list'
  | 'brush.presets.list'
  | 'brush.settings.read'
  | 'preview.read'
  | 'color.sample'
  | 'colors.sample'
  | 'history.read'
  | 'brush.presets.select'
  | 'brush.settings.write'
  | 'foreground.write'
  | 'layer.create'
  | 'layer.delete'
  | 'layer.opacity.write'
  | 'layer.blend_mode.write'
  | 'layer.visibility.write'
  | 'layer.locked.write'
  | 'layer.rename'
  | 'layer.duplicate'
  | 'layer.order.write'
  | 'layer.fill'
  | 'layer.select_by_name'
  | 'layer.mask.create'
  | 'layer.mask.gradient'
  | 'history.undo'
  | 'selection.rectangle'
  | 'selection.ellipse'
  | 'selection.feather'
  | 'selection.subject'
  | 'document.activate'
  | 'document.close'
  | 'document.create'
  | 'document.open'
  | 'layer.mask.apply'
  | 'selection.content_aware_fill'
  | 'selection.contract'
  | 'layer.clipping.create'
  | 'layer.mask.delete'
  | 'selection.deselect'
  | 'selection.expand'
  | 'selection.invert'
  | 'layer.clipping.release'
  | 'selection.save'
  | 'selection.all'
  | 'layer.fit'
  | 'layer.move_pixels'
  | 'layer.rotate'
  | 'layer.scale'
  | 'layer.flatten'
  | 'layer.merge_down'
  | 'layer.merge_visible'
  | 'adjustment.brightness_contrast'
  | 'adjustment.curves'
  | 'adjustment.exposure'
  | 'adjustment.hue_saturation'
  | 'adjustment.vibrance'
  | 'adjustment.gradient_map'
  | 'adjustment.lut'
  | 'adjustment.photo_filter'
  | 'adjustment.auto_contrast'
  | 'adjustment.auto_levels'
  | 'adjustment.desaturate'
  | 'adjustment.invert'
  | 'filter.gaussian_blur'
  | 'filter.high_pass'
  | 'filter.motion_blur'
  | 'filter.noise'
  | 'filter.sharpen'
  | 'filter.smart_blur'
  | 'text.fonts.list'
  | 'text.alignment.write'
  | 'text.color.write'
  | 'text.font.write'
  | 'text.content.write'
  | 'document.export'
  | 'action.play'
  | 'datasets.list'
  | 'datasets.import'
  | 'datasets.generate'
  | 'document.resize'
  | 'document.crop'
  | 'document.place'
  | 'guides.add'
  | 'guides.list'
  | 'guides.clear'
  | 'history.redo'
  | 'image.stack'
  | 'layer.style.apply'
  | 'layer.text.create'
  | 'layer.rasterize'
  | 'sky.replace'
  | 'smart_object.convert'
  | 'smart_object.copy'
  | 'smart_object.edit'
  | 'smart_object.replace'
  | 'painting.regions'
  | 'painting.strokes'
  | 'painting.dabs';
export type PhotoshopBackendKind = 'uxp' | 'extendscript';

export interface PhotoshopStateSnapshot {
  hasDocument: boolean;
  document?: Record<string, unknown>;
  activeLayer?: Record<string, unknown> | null;
}

export type PhotoshopRecordResult = Record<string, unknown>;

export interface PhotoshopPreviewRegion {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface PhotoshopPreviewRequest {
  documentId?: number;
  maxDimension: number;
  quality: number;
  focusRegion?: PhotoshopPreviewRegion;
  focusMaxDimension?: number;
}

export interface PhotoshopPreviewImage {
  width: number;
  height: number;
  mimeType: string;
  path?: string;
  base64?: string;
  region?: PhotoshopPreviewRegion;
  /** Source document geometry. Optional for legacy/back-compat preview producers. */
  canvasWidth?: number;
  canvasHeight?: number;
}

export interface PhotoshopPreviewCapture {
  transport: PhotoshopBackendKind;
  whole: PhotoshopPreviewImage;
  focus?: PhotoshopPreviewImage;
}

export interface PhotoshopColorSamplePoint {
  id?: string;
  x: number;
  y: number;
}

export interface PhotoshopBackend {
  readonly kind: PhotoshopBackendKind;
  isAvailable(): Promise<boolean>;
  supports(primitive: PhotoshopPrimitive): boolean;
  readState(): Promise<PhotoshopStateSnapshot>;
  readDocumentInfo(): Promise<PhotoshopStateSnapshot>;
  listDocuments(): Promise<PhotoshopRecordResult>;
  readSelectionBounds(): Promise<PhotoshopRecordResult>;
  listLayers(): Promise<PhotoshopRecordResult>;
  listBrushPresets(query: string, limit: number): Promise<PhotoshopRecordResult>;
  readBrushSettings(): Promise<PhotoshopRecordResult>;
  capturePreview(request: PhotoshopPreviewRequest): Promise<PhotoshopPreviewCapture>;
  sampleColor(
    x: number,
    y: number,
    radius: number,
    documentId?: number
  ): Promise<PhotoshopRecordResult>;
  sampleColors(
    points: PhotoshopColorSamplePoint[],
    documentId?: number
  ): Promise<PhotoshopRecordResult>;
  readHistory(): Promise<PhotoshopRecordResult>;
}

function requireRecord(
  value: unknown,
  errorCode: string
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(errorCode);
  }
  return value as Record<string, unknown>;
}

function requireState(
  value: unknown,
  errorCode: string
): PhotoshopStateSnapshot {
  const record = requireRecord(value, errorCode);
  if (typeof record.hasDocument !== 'boolean') {
    throw new Error(errorCode);
  }
  return record as unknown as PhotoshopStateSnapshot;
}

function requirePreviewImage(
  value: unknown,
  errorCode: string
): PhotoshopPreviewImage {
  const record = requireRecord(value, errorCode);
  if (
    typeof record.width !== 'number' ||
    typeof record.height !== 'number' ||
    typeof record.mimeType !== 'string'
  ) {
    throw new Error(errorCode);
  }
  if (record.path !== undefined && typeof record.path !== 'string') throw new Error(errorCode);
  if (record.base64 !== undefined && typeof record.base64 !== 'string') throw new Error(errorCode);
  if (record.canvasWidth !== undefined && (typeof record.canvasWidth !== 'number' || !Number.isFinite(record.canvasWidth))) {
    throw new Error(errorCode);
  }
  if (record.canvasHeight !== undefined && (typeof record.canvasHeight !== 'number' || !Number.isFinite(record.canvasHeight))) {
    throw new Error(errorCode);
  }
  return record as unknown as PhotoshopPreviewImage;
}

export class UxpPhotoshopBackend implements PhotoshopBackend {
  readonly kind = 'uxp' as const;

  async isAvailable(): Promise<boolean> {
    return isUxpBridgeReachable();
  }

  supports(primitive: PhotoshopPrimitive): boolean {
    return (
      primitive === 'state.read' ||
      primitive === 'document.info' ||
      primitive === 'documents.list' ||
      primitive === 'selection.bounds' ||
      primitive === 'layers.list' ||
      primitive === 'brush.presets.list' ||
      primitive === 'brush.settings.read' ||
      primitive === 'preview.read' ||
      primitive === 'color.sample' ||
      primitive === 'colors.sample' ||
      primitive === 'history.read' ||
      primitive === 'brush.presets.select' ||
      primitive === 'brush.settings.write' ||
      primitive === 'foreground.write' ||
      primitive === 'layer.create' ||
      primitive === 'layer.delete' ||
      primitive === 'layer.opacity.write' ||
      primitive === 'layer.blend_mode.write' ||
      primitive === 'layer.visibility.write' ||
      primitive === 'layer.locked.write' ||
      primitive === 'layer.rename' ||
      primitive === 'layer.duplicate' ||
      primitive === 'layer.order.write' ||
      primitive === 'layer.fill' ||
      primitive === 'layer.select_by_name' ||
      primitive === 'layer.mask.create' ||
      primitive === 'layer.mask.gradient' ||
      primitive === 'history.undo' ||
      primitive === 'selection.rectangle' ||
      primitive === 'selection.ellipse' ||
      primitive === 'selection.feather' ||
      primitive === 'selection.subject' ||
      primitive === 'document.activate' ||
      primitive === 'document.close' ||
      primitive === 'document.create' ||
      primitive === 'document.open' ||
      primitive === 'layer.mask.apply' ||
      primitive === 'selection.content_aware_fill' ||
      primitive === 'selection.contract' ||
      primitive === 'layer.clipping.create' ||
      primitive === 'layer.mask.delete' ||
      primitive === 'selection.deselect' ||
      primitive === 'selection.expand' ||
      primitive === 'selection.invert' ||
      primitive === 'layer.clipping.release' ||
      primitive === 'selection.save' ||
      primitive === 'selection.all' ||
      primitive === 'layer.fit' ||
      primitive === 'layer.move_pixels' ||
      primitive === 'layer.rotate' ||
      primitive === 'layer.scale' ||
      primitive === 'layer.flatten' ||
      primitive === 'layer.merge_down' ||
      primitive === 'layer.merge_visible' ||
      primitive === 'adjustment.brightness_contrast' ||
      primitive === 'adjustment.curves' ||
      primitive === 'adjustment.exposure' ||
      primitive === 'adjustment.hue_saturation' ||
      primitive === 'adjustment.vibrance' ||
      primitive === 'adjustment.gradient_map' ||
      primitive === 'adjustment.lut' ||
      primitive === 'adjustment.photo_filter' ||
      primitive === 'adjustment.auto_contrast' ||
      primitive === 'adjustment.auto_levels' ||
      primitive === 'adjustment.desaturate' ||
      primitive === 'adjustment.invert' ||
      primitive === 'filter.gaussian_blur' ||
      primitive === 'filter.high_pass' ||
      primitive === 'filter.motion_blur' ||
      primitive === 'filter.noise' ||
      primitive === 'filter.sharpen' ||
      primitive === 'filter.smart_blur' ||
      primitive === 'text.fonts.list' ||
      primitive === 'text.alignment.write' ||
      primitive === 'text.color.write' ||
      primitive === 'text.font.write' ||
      primitive === 'text.content.write' ||
      primitive === 'document.export' ||
      primitive === 'action.play' ||
      primitive === 'datasets.list' ||
      primitive === 'datasets.import' ||
      primitive === 'datasets.generate' ||
      primitive === 'document.resize' ||
      primitive === 'document.crop' ||
      primitive === 'document.place' ||
      primitive === 'guides.add' ||
      primitive === 'guides.list' ||
      primitive === 'guides.clear' ||
      primitive === 'history.redo' ||
      primitive === 'image.stack' ||
      primitive === 'layer.style.apply' ||
      primitive === 'layer.text.create' ||
      primitive === 'layer.rasterize' ||
      primitive === 'sky.replace' ||
      primitive === 'smart_object.convert' ||
      primitive === 'smart_object.copy' ||
      primitive === 'smart_object.edit' ||
      primitive === 'smart_object.replace' ||
      primitive === 'painting.regions' ||
      primitive === 'painting.strokes' ||
      primitive === 'painting.dabs'
    );
  }

  async readState(): Promise<PhotoshopStateSnapshot> {
    const result = await invokeUxpGetState();
    if (!result.ok) {
      throw new Error(result.error ?? 'uxp_get_state_failed');
    }
    return requireState(result.data, 'uxp_get_state_invalid_result');
  }

  async readDocumentInfo(): Promise<PhotoshopStateSnapshot> {
    const state = await this.readState();
    if (!state.hasDocument) {
      throw new Error('No active document');
    }
    return state;
  }

  async listDocuments(): Promise<PhotoshopRecordResult> {
    const result = await invokeUxpListDocuments();
    if (!result.ok) {
      throw new Error(result.error ?? 'uxp_list_documents_failed');
    }
    return requireRecord(result.data, 'uxp_list_documents_invalid_result');
  }

  async readSelectionBounds(): Promise<PhotoshopRecordResult> {
    const result = await invokeUxpGetSelectionBounds();
    if (!result.ok) {
      throw new Error(result.error ?? 'uxp_get_selection_bounds_failed');
    }
    return requireRecord(result.data, 'uxp_get_selection_bounds_invalid_result');
  }

  async listLayers(): Promise<PhotoshopRecordResult> {
    const result = await invokeUxpListLayers();
    if (!result.ok) {
      throw new Error(result.error ?? 'uxp_list_layers_failed');
    }
    return requireRecord(result.data, 'uxp_list_layers_invalid_result');
  }

  async listBrushPresets(query: string, limit: number): Promise<PhotoshopRecordResult> {
    const result = await invokeUxpListBrushPresets(query, limit);
    if (!result.ok) {
      throw new Error(result.error ?? 'uxp_list_brush_presets_failed');
    }
    return requireRecord(result.data, 'uxp_list_brush_presets_invalid_result');
  }

  async readBrushSettings(): Promise<PhotoshopRecordResult> {
    const result = await invokeUxpGetBrushSettings();
    if (!result.ok) {
      throw new Error(result.error ?? 'uxp_get_brush_settings_failed');
    }
    return requireRecord(result.data, 'uxp_get_brush_settings_invalid_result');
  }

  async capturePreview(request: PhotoshopPreviewRequest): Promise<PhotoshopPreviewCapture> {
    const result = await invokeUxpCapturePreview({
      ...(request.documentId !== undefined ? { document_id: request.documentId } : {}),
      max_dimension_px: request.maxDimension,
      ...(request.focusRegion ? { focus_region: request.focusRegion } : {}),
      ...(request.focusMaxDimension !== undefined
        ? { focus_max_dimension_px: request.focusMaxDimension }
        : {}),
    });
    if (!result.ok) {
      throw new Error(result.error ?? 'uxp_capture_preview_failed');
    }
    const data = requireRecord(result.data, 'uxp_capture_preview_invalid_result');
    const whole = requirePreviewImage(data.whole, 'uxp_capture_preview_invalid_whole');
    const focus = data.focus === undefined
      ? undefined
      : requirePreviewImage(data.focus, 'uxp_capture_preview_invalid_focus');
    return { transport: 'uxp', whole, ...(focus ? { focus } : {}) };
  }

  async sampleColor(
    x: number,
    y: number,
    radius: number,
    documentId?: number
  ): Promise<PhotoshopRecordResult> {
    const result = await invokeUxpSampleColor({
      ...(documentId !== undefined ? { document_id: documentId } : {}),
      x,
      y,
      radius,
    });
    if (!result.ok) throw new Error(result.error ?? 'uxp_sample_color_failed');
    return requireRecord(result.data, 'uxp_sample_color_invalid_result');
  }

  async sampleColors(
    points: PhotoshopColorSamplePoint[],
    documentId?: number
  ): Promise<PhotoshopRecordResult> {
    const result = await invokeUxpSampleColors({
      ...(documentId !== undefined ? { document_id: documentId } : {}),
      points,
    });
    if (!result.ok) throw new Error(result.error ?? 'uxp_sample_colors_failed');
    return requireRecord(result.data, 'uxp_sample_colors_invalid_result');
  }

  async readHistory(): Promise<PhotoshopRecordResult> {
    const result = await invokeUxpGetHistory();
    if (!result.ok) throw new Error(result.error ?? 'uxp_get_history_failed');
    return requireRecord(result.data, 'uxp_get_history_invalid_result');
  }
}

export class ExtendScriptPhotoshopBackend implements PhotoshopBackend {
  readonly kind = 'extendscript' as const;

  constructor(private readonly connection: PhotoshopConnection) {}

  async isAvailable(): Promise<boolean> {
    // Keep this check side-effect free. The legacy executor remains the final
    // authority on whether the running Photoshop COM/AppleScript endpoint is
    // reachable, preserving the existing error envelope behavior.
    return true;
  }

  supports(primitive: PhotoshopPrimitive): boolean {
    return (
      primitive === 'state.read' ||
      primitive === 'document.info' ||
      primitive === 'documents.list' ||
      primitive === 'selection.bounds' ||
      primitive === 'layers.list' ||
      primitive === 'brush.presets.list' ||
      primitive === 'brush.settings.read' ||
      primitive === 'preview.read' ||
      primitive === 'color.sample' ||
      primitive === 'colors.sample' ||
      primitive === 'history.read' ||
      primitive === 'brush.presets.select' ||
      primitive === 'brush.settings.write' ||
      primitive === 'foreground.write' ||
      primitive === 'layer.create' ||
      primitive === 'layer.delete' ||
      primitive === 'layer.opacity.write' ||
      primitive === 'layer.blend_mode.write' ||
      primitive === 'layer.visibility.write' ||
      primitive === 'layer.locked.write' ||
      primitive === 'layer.rename' ||
      primitive === 'layer.duplicate' ||
      primitive === 'layer.order.write' ||
      primitive === 'layer.fill' ||
      primitive === 'layer.select_by_name' ||
      primitive === 'layer.mask.create' ||
      primitive === 'layer.mask.gradient' ||
      primitive === 'history.undo' ||
      primitive === 'selection.rectangle' ||
      primitive === 'selection.ellipse' ||
      primitive === 'selection.feather' ||
      primitive === 'selection.subject' ||
      primitive === 'document.activate' ||
      primitive === 'document.close' ||
      primitive === 'document.create' ||
      primitive === 'document.open' ||
      primitive === 'layer.mask.apply' ||
      primitive === 'selection.content_aware_fill' ||
      primitive === 'selection.contract' ||
      primitive === 'layer.clipping.create' ||
      primitive === 'layer.mask.delete' ||
      primitive === 'selection.deselect' ||
      primitive === 'selection.expand' ||
      primitive === 'selection.invert' ||
      primitive === 'layer.clipping.release' ||
      primitive === 'selection.save' ||
      primitive === 'selection.all' ||
      primitive === 'layer.fit' ||
      primitive === 'layer.move_pixels' ||
      primitive === 'layer.rotate' ||
      primitive === 'layer.scale' ||
      primitive === 'layer.flatten' ||
      primitive === 'layer.merge_down' ||
      primitive === 'layer.merge_visible' ||
      primitive === 'adjustment.brightness_contrast' ||
      primitive === 'adjustment.curves' ||
      primitive === 'adjustment.exposure' ||
      primitive === 'adjustment.hue_saturation' ||
      primitive === 'adjustment.vibrance' ||
      primitive === 'adjustment.gradient_map' ||
      primitive === 'adjustment.lut' ||
      primitive === 'adjustment.photo_filter' ||
      primitive === 'adjustment.auto_contrast' ||
      primitive === 'adjustment.auto_levels' ||
      primitive === 'adjustment.desaturate' ||
      primitive === 'adjustment.invert' ||
      primitive === 'filter.gaussian_blur' ||
      primitive === 'filter.high_pass' ||
      primitive === 'filter.motion_blur' ||
      primitive === 'filter.noise' ||
      primitive === 'filter.sharpen' ||
      primitive === 'filter.smart_blur' ||
      primitive === 'text.fonts.list' ||
      primitive === 'text.alignment.write' ||
      primitive === 'text.color.write' ||
      primitive === 'text.font.write' ||
      primitive === 'text.content.write' ||
      primitive === 'document.export' ||
      primitive === 'action.play' ||
      primitive === 'datasets.list' ||
      primitive === 'datasets.import' ||
      primitive === 'datasets.generate' ||
      primitive === 'document.resize' ||
      primitive === 'document.crop' ||
      primitive === 'document.place' ||
      primitive === 'guides.add' ||
      primitive === 'guides.list' ||
      primitive === 'guides.clear' ||
      primitive === 'history.redo' ||
      primitive === 'image.stack' ||
      primitive === 'layer.style.apply' ||
      primitive === 'layer.text.create' ||
      primitive === 'layer.rasterize' ||
      primitive === 'sky.replace' ||
      primitive === 'smart_object.convert' ||
      primitive === 'smart_object.copy' ||
      primitive === 'smart_object.edit' ||
      primitive === 'smart_object.replace' ||
      primitive === 'painting.regions' ||
      primitive === 'painting.strokes' ||
      primitive === 'painting.dabs'
    );
  }

  private async executeRecord(script: string, errorCode: string): Promise<Record<string, unknown>> {
    if (!this.connection.getPhotoshopInfo()) {
      await this.connection.getVersion();
    }
    const api = await new PhotoshopAPIFactory(this.connection).createAPI();
    const raw = await api.executeScript(script);
    return requireRecord(parseExtendScriptPayload(raw), errorCode);
  }

  async readState(): Promise<PhotoshopStateSnapshot> {
    return requireState(
      await this.executeRecord(ExtendScriptSnippets.getState(), 'extendscript_get_state_invalid_result'),
      'extendscript_get_state_invalid_result'
    );
  }

  async readDocumentInfo(): Promise<PhotoshopStateSnapshot> {
    return requireState(
      await this.executeRecord(
        ExtendScriptSnippets.getDocumentInfo(),
        'extendscript_get_document_info_invalid_result'
      ),
      'extendscript_get_document_info_invalid_result'
    );
  }

  async listDocuments(): Promise<PhotoshopRecordResult> {
    return this.executeRecord(
      ExtendScriptSnippets.listDocuments(),
      'extendscript_list_documents_invalid_result'
    );
  }

  async readSelectionBounds(): Promise<PhotoshopRecordResult> {
    return this.executeRecord(
      ExtendScriptSnippets.getSelectionBounds(),
      'extendscript_get_selection_bounds_invalid_result'
    );
  }

  async listLayers(): Promise<PhotoshopRecordResult> {
    return this.executeRecord(
      ExtendScriptSnippets.getLayerNames(),
      'extendscript_get_layers_invalid_result'
    );
  }

  async listBrushPresets(query: string, limit: number): Promise<PhotoshopRecordResult> {
    return this.executeRecord(
      ExtendScriptSnippets.listBrushPresets(query, limit),
      'extendscript_list_brush_presets_invalid_result'
    );
  }

  async readBrushSettings(): Promise<PhotoshopRecordResult> {
    return this.executeRecord(
      ExtendScriptSnippets.getBrushSettings(),
      'extendscript_get_brush_settings_invalid_result'
    );
  }

  async capturePreview(request: PhotoshopPreviewRequest): Promise<PhotoshopPreviewCapture> {
    if (request.focusRegion) {
      const result = await this.executeRecord(
        ExtendScriptSnippets.exportPreviewBundle(
          request.maxDimension,
          request.quality,
          request.focusRegion.left,
          request.focusRegion.top,
          request.focusRegion.right,
          request.focusRegion.bottom,
          request.focusMaxDimension ?? 1200
        ),
        'extendscript_capture_preview_invalid_result'
      );
      return {
        transport: 'extendscript',
        whole: requirePreviewImage(
          result.whole,
          'extendscript_capture_preview_invalid_whole'
        ),
        focus: requirePreviewImage(
          result.focus,
          'extendscript_capture_preview_invalid_focus'
        ),
      };
    }
    const result = await this.executeRecord(
      ExtendScriptSnippets.exportPreview(request.maxDimension, request.quality),
      'extendscript_capture_preview_invalid_result'
    );
    return {
      transport: 'extendscript',
      whole: requirePreviewImage(result, 'extendscript_capture_preview_invalid_whole'),
    };
  }

  async sampleColor(
    x: number,
    y: number,
    radius: number
  ): Promise<PhotoshopRecordResult> {
    return this.executeRecord(
      ExtendScriptSnippets.sampleColor(x, y, radius),
      'extendscript_sample_color_invalid_result'
    );
  }

  async sampleColors(points: PhotoshopColorSamplePoint[]): Promise<PhotoshopRecordResult> {
    return this.executeRecord(
      ExtendScriptSnippets.sampleColors(points),
      'extendscript_sample_colors_invalid_result'
    );
  }

  async readHistory(): Promise<PhotoshopRecordResult> {
    return this.executeRecord(
      ExtendScriptSnippets.getHistoryStates(),
      'extendscript_get_history_invalid_result'
    );
  }
}

export class PhotoshopBackendRouter {
  private readonly backends: PhotoshopBackend[];

  constructor(connection: PhotoshopConnection, backends?: PhotoshopBackend[]) {
    // UXP-first with a bounded, pre-dispatch ExtendScript/COM fallback.
    // The chosen backend executes exactly once; callers must not catch an
    // execution failure and replay the mutation through the other transport.
    this.backends = backends ?? [
      new UxpPhotoshopBackend(),
      new ExtendScriptPhotoshopBackend(connection),
    ];
  }

  async backendFor(primitive: PhotoshopPrimitive): Promise<PhotoshopBackend> {
    const uxp = this.backends.find((backend) => backend.kind === 'uxp' && backend.supports(primitive));
    if (uxp && await uxp.isAvailable()) return uxp;

    const legacy = this.backends.find(
      (backend) => backend.kind === 'extendscript' && backend.supports(primitive)
    );
    if (legacy && await legacy.isAvailable()) return legacy;

    if (uxp) {
      throw new Error(
        `photoshop_backend_unavailable: ${primitive} has a UXP implementation, but neither UXP nor the pre-dispatch ExtendScript/COM fallback is available`
      );
    }
    throw new Error(
      `capability_unavailable: ${primitive} is unsupported by all configured Photoshop backends`
    );
  }

  async readState(): Promise<PhotoshopStateSnapshot> {
    const backend = await this.backendFor('state.read');
    // Routing is complete before dispatch. Do not catch and replay through a
    // different backend here; that rule becomes critical as mutating semantic
    // primitives are added.
    return backend.readState();
  }

  async readDocumentInfo(): Promise<PhotoshopStateSnapshot> {
    const backend = await this.backendFor('document.info');
    return backend.readDocumentInfo();
  }

  async listDocuments(): Promise<PhotoshopRecordResult> {
    const backend = await this.backendFor('documents.list');
    return backend.listDocuments();
  }

  async readSelectionBounds(): Promise<PhotoshopRecordResult> {
    const backend = await this.backendFor('selection.bounds');
    return backend.readSelectionBounds();
  }

  async listLayers(): Promise<PhotoshopRecordResult> {
    const backend = await this.backendFor('layers.list');
    return backend.listLayers();
  }

  async listBrushPresets(query: string, limit: number): Promise<PhotoshopRecordResult> {
    const backend = await this.backendFor('brush.presets.list');
    return backend.listBrushPresets(query, limit);
  }

  async readBrushSettings(): Promise<PhotoshopRecordResult> {
    const backend = await this.backendFor('brush.settings.read');
    return backend.readBrushSettings();
  }

  async capturePreview(request: PhotoshopPreviewRequest): Promise<PhotoshopPreviewCapture> {
    const backend = await this.backendFor('preview.read');
    return backend.capturePreview(request);
  }

  async sampleColor(
    x: number,
    y: number,
    radius: number,
    documentId?: number
  ): Promise<PhotoshopRecordResult> {
    const backend = await this.backendFor('color.sample');
    return backend.sampleColor(x, y, radius, documentId);
  }

  async sampleColors(
    points: PhotoshopColorSamplePoint[],
    documentId?: number
  ): Promise<PhotoshopRecordResult> {
    const backend = await this.backendFor('colors.sample');
    return backend.sampleColors(points, documentId);
  }

  async readHistory(): Promise<PhotoshopRecordResult> {
    const backend = await this.backendFor('history.read');
    return backend.readHistory();
  }
}
