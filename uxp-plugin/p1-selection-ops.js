/**
 * P1 selection / mask operations for the Photoshop UXP bridge.
 *
 * These handlers are invoked from main.js before the legacy monolithic dispatch.
 * They never activate another document to satisfy document_id: a pinned document
 * must already be active. All mutations run inside executeAsModal.
 */
const photoshop = require('photoshop');
const { action, app, core } = photoshop;

function numericValue(value) {
  if (typeof value === 'number') return value;
  if (value && typeof value._value === 'number') return value._value;
  if (value && typeof value.value === 'number') return value.value;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function normalizeBounds(bounds) {
  if (!bounds) return null;
  const normalized = {
    left: numericValue(bounds.left),
    top: numericValue(bounds.top),
    right: numericValue(bounds.right),
    bottom: numericValue(bounds.bottom),
  };
  return Object.values(normalized).every((value) => value != null) ? normalized : null;
}

function currentDocument(params = {}) {
  if (!app.documents || app.documents.length === 0) {
    throw new Error('No active document');
  }
  const doc = app.activeDocument;
  const requestedId = Number.isInteger(params.document_id) && params.document_id > 0
    ? params.document_id
    : null;
  if (requestedId != null && doc.id !== requestedId) {
    const openIds = Array.from(app.documents).map((entry) => entry.id);
    if (!openIds.includes(requestedId)) {
      throw new Error(`document_not_found: no open document with id ${requestedId}`);
    }
    throw new Error(
      `document_not_active: pinned document ${requestedId} is open but not active; active document was not changed`
    );
  }
  return doc;
}

function activeLayer(doc) {
  return Array.from(doc.activeLayers ?? [])[0] ?? null;
}

function contextFor(doc) {
  const layer = activeLayer(doc);
  const bounds = normalizeBounds(doc.selection?.bounds ?? null);
  return {
    document: {
      id: doc.id,
      name: String(doc.title ?? doc.name ?? ''),
      hasSelection: bounds != null,
    },
    activeLayer: layer
      ? {
          id: layer.id,
          name: String(layer.name ?? ''),
        }
      : null,
  };
}

function selectionRequired(doc) {
  return normalizeBounds(doc.selection?.bounds ?? null) == null
    ? {
        ok: false,
        code: 'selection_required',
        message: 'Active pixel selection required',
        suggested_next_tool: 'photoshop_select_rectangle',
      }
    : null;
}

function selectionResult(doc, pixels, operation) {
  const bounds = normalizeBounds(doc.selection?.bounds ?? null);
  return {
    ok: true,
    has_selection: bounds != null,
    ...(pixels !== undefined ? { pixels } : {}),
    ...(operation ? { operation } : {}),
    ...(bounds ? { bounds } : {}),
    context: contextFor(doc),
  };
}

function findLayerByName(container, layerName) {
  const layers = Array.from(container?.layers ?? []);
  for (const layer of layers) {
    if (layer?.name === layerName) return layer;
    const nested = findLayerByName(layer, layerName);
    if (nested) return nested;
  }
  return null;
}

function layerBelow(doc, layer) {
  const stack = Array.from(layer?.parent?.layers ?? doc.layers ?? []);
  const index = stack.findIndex((entry) => entry === layer || entry?.id === layer?.id);
  if (index < 0 || index >= stack.length - 1) return null;
  return stack[index + 1] ?? null;
}

async function activateLayer(layer) {
  await action.batchPlay(
    [{
      _obj: 'select',
      _target: [{ _ref: 'layer', _id: layer.id }],
      makeVisible: false,
      _options: { dialogOptions: 'silent' },
    }],
    { synchronousExecution: true }
  );
}

function resolveTargetLayer(doc, params = {}) {
  const requestedName = typeof params.layer_name === 'string' ? params.layer_name.trim() : '';
  if (requestedName) {
    const layer = findLayerByName(doc, requestedName);
    if (!layer) {
      return {
        error: {
          ok: false,
          code: 'layer_not_found',
          message: `Layer not found: ${requestedName}`,
          suggested_next_tool: 'photoshop_get_layers',
        },
      };
    }
    return { layer };
  }
  const layer = activeLayer(doc);
  if (!layer) {
    return {
      error: {
        ok: false,
        code: 'no_active_layer',
        message: 'No active layer',
        suggested_next_tool: 'photoshop_get_layers',
      },
    };
  }
  return { layer };
}

async function activeLayerHasUserMask() {
  try {
    const [descriptor] = await action.batchPlay(
      [{
        _obj: 'get',
        _target: [
          { _property: 'userMaskEnabled' },
          { _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' },
        ],
        _options: { dialogOptions: 'dontDisplay' },
      }],
      { synchronousExecution: true }
    );
    return descriptor?.userMaskEnabled !== undefined;
  } catch {
    return false;
  }
}

async function expandSelection(params = {}) {
  const pixels = Math.max(1, Math.round(Number(params.pixels)));
  if (!Number.isFinite(pixels)) throw new Error('pixels must be a finite number >= 1');
  return core.executeAsModal(
    async () => {
      const doc = currentDocument(params);
      const missing = selectionRequired(doc);
      if (missing) return missing;
      await doc.selection.expand(pixels);
      return selectionResult(doc, pixels, 'expand');
    },
    { commandName: 'MCP Expand Selection' }
  );
}

async function contractSelection(params = {}) {
  const pixels = Math.max(1, Math.round(Number(params.pixels)));
  if (!Number.isFinite(pixels)) throw new Error('pixels must be a finite number >= 1');
  return core.executeAsModal(
    async () => {
      const doc = currentDocument(params);
      const missing = selectionRequired(doc);
      if (missing) return missing;
      await doc.selection.contract(pixels);
      return selectionResult(doc, pixels, 'contract');
    },
    { commandName: 'MCP Contract Selection' }
  );
}

async function saveSelection(params = {}) {
  return core.executeAsModal(
    async () => {
      const doc = currentDocument(params);
      const missing = selectionRequired(doc);
      if (missing) return missing;
      const requestedName = typeof params.channel_name === 'string' && params.channel_name.length > 0
        ? params.channel_name
        : null;
      const channelName = requestedName ?? `MCP Selection ${Date.now()}`;
      await doc.selection.save(channelName);
      return {
        ok: true,
        channel_name: channelName,
        context: contextFor(doc),
      };
    },
    { commandName: 'MCP Save Selection' }
  );
}

async function selectAll(params = {}) {
  return core.executeAsModal(
    async () => {
      const doc = currentDocument(params);
      await doc.selection.selectAll();
      return selectionResult(doc, undefined, 'select_all');
    },
    { commandName: 'MCP Select All' }
  );
}

async function deselect(params = {}) {
  return core.executeAsModal(
    async () => {
      const doc = currentDocument(params);
      await doc.selection.deselect();
      return { deselected: true, context: contextFor(doc) };
    },
    { commandName: 'MCP Deselect' }
  );
}

async function invertSelection(params = {}) {
  return core.executeAsModal(
    async () => {
      const doc = currentDocument(params);
      await doc.selection.inverse();
      return { inverted: true, ...selectionResult(doc, undefined, 'invert') };
    },
    { commandName: 'MCP Invert Selection' }
  );
}

async function contentAwareFill(params = {}) {
  return core.executeAsModal(
    async () => {
      const doc = currentDocument(params);
      const missing = selectionRequired(doc);
      if (missing) {
        return {
          ...missing,
          message: 'Active pixel selection required before content-aware fill',
        };
      }
      await action.batchPlay(
        [{
          _obj: 'fill',
          using: { _enum: 'fillContents', _value: 'contentAware' },
          _options: { dialogOptions: 'silent' },
        }],
        { synchronousExecution: true }
      );
      await doc.selection.deselect();
      return { filled: true, context: contextFor(doc) };
    },
    { commandName: 'MCP Content-Aware Fill' }
  );
}

async function deleteLayerMask(params = {}) {
  return core.executeAsModal(
    async () => {
      const doc = currentDocument(params);
      if (!(await activeLayerHasUserMask())) {
        return { maskDeleted: false, message: 'Layer has no mask', context: contextFor(doc) };
      }
      await action.batchPlay(
        [{
          _obj: 'delete',
          _target: [{ _ref: 'channel', _enum: 'channel', _value: 'mask' }],
          _options: { dialogOptions: 'silent' },
        }],
        { synchronousExecution: true }
      );
      return { maskDeleted: true, context: contextFor(doc) };
    },
    { commandName: 'MCP Delete Layer Mask' }
  );
}

async function applyLayerMask(params = {}) {
  return core.executeAsModal(
    async () => {
      const doc = currentDocument(params);
      await action.batchPlay(
        [{
          _obj: 'delete',
          _target: [{ _ref: 'channel', _enum: 'channel', _value: 'mask' }],
          apply: true,
          _options: { dialogOptions: 'silent' },
        }],
        { synchronousExecution: true }
      );
      return { maskApplied: true, context: contextFor(doc) };
    },
    { commandName: 'MCP Apply Layer Mask' }
  );
}

async function createClippingMask(params = {}) {
  return core.executeAsModal(
    async () => {
      const doc = currentDocument(params);
      const resolved = resolveTargetLayer(doc, params);
      if (resolved.error) return resolved.error;
      const layer = resolved.layer;
      if (!layerBelow(doc, layer)) {
        return {
          ok: false,
          code: 'no_base_layer_below',
          message: 'No base layer below the active layer — nothing to clip into. The target layer must sit directly above the layer it should clip to.',
          suggested_next_tool: 'photoshop_get_layers',
        };
      }
      if (layer.isClippingMask === true) {
        return {
          ok: true,
          layer_name: layer.name,
          is_clipping: true,
          already_clipping: true,
          context: contextFor(doc),
        };
      }
      await activateLayer(layer);
      layer.isClippingMask = true;
      return {
        ok: true,
        layer_name: layer.name,
        is_clipping: true,
        context: contextFor(doc),
      };
    },
    { commandName: 'MCP Create Clipping Mask' }
  );
}

async function releaseClippingMask(params = {}) {
  return core.executeAsModal(
    async () => {
      const doc = currentDocument(params);
      const resolved = resolveTargetLayer(doc, params);
      if (resolved.error) return resolved.error;
      const layer = resolved.layer;
      if (layer.isClippingMask !== true) {
        return {
          ok: false,
          code: 'not_clipping',
          message: `Layer "${layer.name}" is not a clipping mask`,
          suggested_next_tool: 'photoshop_get_layers',
        };
      }
      await activateLayer(layer);
      layer.isClippingMask = false;
      return {
        ok: true,
        layer_name: layer.name,
        is_clipping: false,
        context: contextFor(doc),
      };
    },
    { commandName: 'MCP Release Clipping Mask' }
  );
}

async function tryHandleP1SelectionOperation(cmdAction, params = {}) {
  switch (cmdAction) {
    case 'apply_layer_mask':
      return { handled: true, data: await applyLayerMask(params) };
    case 'content_aware_fill':
      return { handled: true, data: await contentAwareFill(params) };
    case 'contract_selection':
      return { handled: true, data: await contractSelection(params) };
    case 'create_clipping_mask':
      return { handled: true, data: await createClippingMask(params) };
    case 'delete_layer_mask':
      return { handled: true, data: await deleteLayerMask(params) };
    case 'deselect':
      return { handled: true, data: await deselect(params) };
    case 'expand_selection':
      return { handled: true, data: await expandSelection(params) };
    case 'invert_selection':
      return { handled: true, data: await invertSelection(params) };
    case 'release_clipping_mask':
      return { handled: true, data: await releaseClippingMask(params) };
    case 'save_selection':
      return { handled: true, data: await saveSelection(params) };
    case 'select_all':
      return { handled: true, data: await selectAll(params) };
    default:
      return { handled: false };
  }
}

module.exports = { tryHandleP1SelectionOperation };
