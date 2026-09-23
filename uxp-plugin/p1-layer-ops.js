const photoshop = require('photoshop');

const { action, app, constants, core } = photoshop;

function requestedDocumentId(params = {}) {
  return Number.isInteger(params.document_id) && params.document_id > 0
    ? params.document_id
    : null;
}

function requirePinnedActiveDocument(params = {}) {
  if (!app.documents || app.documents.length === 0) {
    throw new Error('No active document');
  }

  const doc = app.activeDocument;
  const requestedId = requestedDocumentId(params);
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

function requireActiveLayer(doc, operationName) {
  const layer = Array.from(doc.activeLayers ?? [])[0] ?? null;
  if (!layer) throw new Error(`${operationName}: No active layer`);
  return layer;
}

function findLayerEntry(container, layerId, parentContainer = container) {
  const layers = Array.from(container?.layers ?? []);
  for (const layer of layers) {
    if (layer?.id === layerId) return { layer, parentContainer };
    const nested = findLayerEntry(layer, layerId, layer);
    if (nested) return nested;
  }
  return null;
}

function selectLayerDescriptor(layerId) {
  return {
    _obj: 'select',
    _target: [{ _ref: 'layer', _id: layerId }],
    makeVisible: false,
    _options: { dialogOptions: 'dontDisplay' },
  };
}

async function selectOnlyLayer(layerId) {
  await action.batchPlay([selectLayerDescriptor(layerId)], {
    synchronousExecution: true,
    modalBehavior: 'execute',
  });
}

function contextSnapshot(doc) {
  const context = { hasDocument: Boolean(doc) };
  if (!doc) return context;

  const document = {};
  try { document.id = doc.id; } catch {}
  try { document.name = doc.name; } catch {}
  try { document.width = doc.width; } catch {}
  try { document.height = doc.height; } catch {}
  try { document.resolution = doc.resolution; } catch {}
  try { document.colorMode = String(doc.mode); } catch {}
  try { document.layerCount = Array.from(doc.layers ?? []).length; } catch {}
  context.document = document;

  const layer = Array.from(doc.activeLayers ?? [])[0] ?? null;
  if (!layer) {
    context.activeLayer = null;
    return context;
  }

  const activeLayer = {};
  try { activeLayer.name = layer.name; } catch {}
  try { activeLayer.kind = String(layer.kind); } catch {}
  try { activeLayer.opacity = layer.opacity; } catch {}
  try { activeLayer.blendMode = String(layer.blendMode); } catch {}
  try { activeLayer.visible = layer.visible; } catch {}
  try { activeLayer.locked = layer.locked; } catch {}
  try { activeLayer.isBackground = layer.isBackgroundLayer === true; } catch {}
  try {
    const bounds = layer.bounds;
    activeLayer.bounds = {
      left: bounds.left,
      top: bounds.top,
      right: bounds.right,
      bottom: bounds.bottom,
    };
  } catch {
    // Some layer kinds do not expose bounds.
  }
  context.activeLayer = activeLayer;
  return context;
}

function requireFiniteNumber(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number`);
  }
  return value;
}

async function fitLayerToDocument(params = {}) {
  return core.executeAsModal(
    async () => {
      const doc = requirePinnedActiveDocument(params);
      const layer = requireActiveLayer(doc, 'fit_layer_to_document');
      if (layer.isBackgroundLayer) throw new Error('Cannot transform background layer');

      const bounds = layer.bounds;
      const layerWidth = bounds.width;
      const layerHeight = bounds.height;
      if (!(layerWidth > 0) || !(layerHeight > 0)) {
        throw new Error('Cannot fit a layer with empty bounds');
      }

      const canvasWidth = doc.width;
      const canvasHeight = doc.height;
      const widthRatio = canvasWidth / layerWidth;
      const heightRatio = canvasHeight / layerHeight;
      const fillDocument = params.fillDocument === true;
      const scaleFactor = fillDocument
        ? Math.max(widthRatio, heightRatio)
        : Math.min(widthRatio, heightRatio);
      const scalePercent = scaleFactor * 100;
      const originalCenterX = bounds.left + layerWidth / 2;
      const originalCenterY = bounds.top + layerHeight / 2;

      await layer.scale(
        scalePercent,
        scalePercent,
        constants.AnchorPosition.MIDDLECENTER
      );
      await layer.translate(
        canvasWidth / 2 - originalCenterX,
        canvasHeight / 2 - originalCenterY
      );

      return {
        fitted: true,
        mode: fillDocument ? 'fill' : 'fit',
        originalSize: { width: layerWidth, height: layerHeight },
        newSize: {
          width: layerWidth * scaleFactor,
          height: layerHeight * scaleFactor,
        },
        scaleFactor,
        scalePercent,
        context: contextSnapshot(doc),
      };
    },
    { commandName: 'MCP Fit Layer To Document' }
  );
}

async function scaleLayer(params = {}) {
  const scalePercent = requireFiniteNumber(params.scalePercent, 'scalePercent');
  if (scalePercent <= 0) throw new Error('scalePercent must be greater than zero');
  const centerAnchor = params.centerAnchor !== false;

  return core.executeAsModal(
    async () => {
      const doc = requirePinnedActiveDocument(params);
      const layer = requireActiveLayer(doc, 'scale_layer');
      if (layer.isBackgroundLayer) throw new Error('Cannot transform background layer');
      await layer.scale(
        scalePercent,
        scalePercent,
        centerAnchor ? constants.AnchorPosition.MIDDLECENTER : constants.AnchorPosition.TOPLEFT
      );
      return { scaled: true, percent: scalePercent };
    },
    { commandName: 'MCP Scale Layer' }
  );
}

async function moveLayerPixels(params = {}) {
  const deltaX = requireFiniteNumber(params.deltaX, 'deltaX');
  const deltaY = requireFiniteNumber(params.deltaY, 'deltaY');

  return core.executeAsModal(
    async () => {
      const doc = requirePinnedActiveDocument(params);
      const layer = requireActiveLayer(doc, 'move_layer_pixels');
      if (layer.isBackgroundLayer) throw new Error('Cannot move background layer');
      await layer.translate(deltaX, deltaY);
      return { moved: true, deltaX, deltaY };
    },
    { commandName: 'MCP Move Layer Pixels' }
  );
}

async function rotateLayer(params = {}) {
  const degrees = requireFiniteNumber(params.degrees, 'degrees');

  return core.executeAsModal(
    async () => {
      const doc = requirePinnedActiveDocument(params);
      const layer = requireActiveLayer(doc, 'rotate_layer');
      if (layer.isBackgroundLayer) throw new Error('Cannot rotate background layer');
      await layer.rotate(degrees, constants.AnchorPosition.MIDDLECENTER);
      return { rotated: true, degrees };
    },
    { commandName: 'MCP Rotate Layer' }
  );
}

async function flattenImage(params = {}) {
  return core.executeAsModal(
    async () => {
      const doc = requirePinnedActiveDocument(params);
      await doc.flatten();
      return { flattened: true };
    },
    { commandName: 'MCP Flatten Image' }
  );
}

async function mergeVisibleLayers(params = {}) {
  return core.executeAsModal(
    async () => {
      const doc = requirePinnedActiveDocument(params);
      await doc.mergeVisibleLayers();
      return { merged: true };
    },
    { commandName: 'MCP Merge Visible Layers' }
  );
}

async function mergeLayerDown(params = {}) {
  const sourceId = Number.isInteger(params.layer_id) && params.layer_id > 0
    ? params.layer_id
    : null;
  const targetId = Number.isInteger(params.target_layer_id) && params.target_layer_id > 0
    ? params.target_layer_id
    : null;
  if (sourceId == null) throw new Error('layer_id must be a positive integer');
  if (targetId == null) throw new Error('target_layer_id must be a positive integer');
  if (sourceId === targetId) throw new Error('layer_id and target_layer_id must differ');

  return core.executeAsModal(
    async () => {
      const doc = requirePinnedActiveDocument(params);
      const sourceEntry = findLayerEntry(doc, sourceId, doc);
      const targetEntry = findLayerEntry(doc, targetId, doc);
      if (!sourceEntry) throw new Error(`Source layer id not found: ${sourceId}`);
      if (!targetEntry) throw new Error(`Merge target layer id not found: ${targetId}`);
      if (sourceEntry.parentContainer !== targetEntry.parentContainer) {
        throw new Error('Merge requires source and target to share the same parent');
      }

      const stack = Array.from(sourceEntry.parentContainer.layers ?? []);
      const sourceIndex = stack.findIndex((entry) => entry?.id === sourceId);
      const targetIndex = stack.findIndex((entry) => entry?.id === targetId);
      if (sourceIndex < 0 || targetIndex !== sourceIndex + 1) {
        throw new Error('Merge target must be the immediately-below sibling layer');
      }
      if (sourceEntry.layer.kind === constants.LayerKind.GROUP ||
          targetEntry.layer.kind === constants.LayerKind.GROUP) {
        throw new Error('Merge requires raster/art layers');
      }

      const originalActiveLayer = Array.from(doc.activeLayers ?? [])[0] ?? null;
      const originalActiveLayerId = originalActiveLayer?.id ?? null;
      const sourceName = sourceEntry.layer.name;
      const targetName = targetEntry.layer.name;

      await selectOnlyLayer(sourceId);
      const merged = await sourceEntry.layer.merge();
      const mergedId = merged?.id ?? null;
      const mergedName = merged?.name ?? sourceName;

      if (originalActiveLayerId != null &&
          originalActiveLayerId !== sourceId &&
          originalActiveLayerId !== targetId &&
          findLayerEntry(doc, originalActiveLayerId, doc)) {
        try {
          await selectOnlyLayer(originalActiveLayerId);
        } catch {
          // Best-effort restoration after the merge, matching the legacy path.
        }
      }

      return {
        merged: true,
        sourceLayerId: sourceId,
        sourceLayerName: sourceName,
        targetLayerId: targetId,
        targetLayerName: targetName,
        mergedLayerId: mergedId,
        mergedLayerName: mergedName,
        originalActiveLayerId,
        context: contextSnapshot(doc),
      };
    },
    { commandName: 'MCP Merge Layer Down' }
  );
}

async function tryHandleP1LayerOperation(cmdAction, params = {}) {
  switch (cmdAction) {
    case 'fit_layer_to_document':
      return { handled: true, data: await fitLayerToDocument(params) };
    case 'scale_layer':
      return { handled: true, data: await scaleLayer(params) };
    case 'move_layer_pixels':
      return { handled: true, data: await moveLayerPixels(params) };
    case 'rotate_layer':
      return { handled: true, data: await rotateLayer(params) };
    case 'flatten_image':
      return { handled: true, data: await flattenImage(params) };
    case 'merge_visible_layers':
      return { handled: true, data: await mergeVisibleLayers(params) };
    case 'merge_layer_down':
      return { handled: true, data: await mergeLayerDown(params) };
    default:
      return { handled: false };
  }
}

module.exports = { tryHandleP1LayerOperation };
