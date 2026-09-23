/** P3 advanced layer operations for the Photoshop UXP bridge. */
const photoshop = require('photoshop');
const { localFileSystem } = require('uxp').storage;

const { action, app, constants, core } = photoshop;

function fileUrlFromNativePath(nativePath, operationName) {
  if (typeof nativePath !== 'string' || nativePath.trim().length === 0) {
    throw new Error(`${operationName} requires a non-empty absolute path`);
  }
  let normalized = nativePath.trim().replace(/\\/g, '/');
  if (/^[A-Za-z]:\//.test(normalized)) normalized = `/${normalized}`;
  if (!normalized.startsWith('/')) {
    throw new Error(`${operationName} requires an absolute path: ${nativePath}`);
  }
  return `file:${encodeURI(normalized)}`;
}

function requirePinnedActiveDocument(params = {}) {
  if (!app.documents || app.documents.length === 0) throw new Error('No active document');
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
  return {
    document: { id: doc.id, name: String(doc.title ?? doc.name ?? '') },
    activeLayer: layer ? { id: layer.id, name: String(layer.name ?? '') } : null,
  };
}

function findLayerByName(container, layerName) {
  for (const layer of Array.from(container?.layers ?? [])) {
    if (layer?.name === layerName) return layer;
    const nested = findLayerByName(layer, layerName);
    if (nested) return nested;
  }
  return null;
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

async function resolveTargetLayer(doc, params = {}) {
  const requestedName = typeof params.layer_name === 'string' ? params.layer_name.trim() : '';
  const layer = requestedName ? findLayerByName(doc, requestedName) : activeLayer(doc);
  if (!layer) {
    throw new Error(requestedName ? `Layer not found: ${requestedName}` : 'No active layer');
  }
  if (activeLayer(doc)?.id !== layer.id) await activateLayer(layer);
  return layer;
}

function isSmartObject(layer) {
  return layer?.kind === constants.LayerKind.SMARTOBJECT || /smart.?object/i.test(String(layer?.kind ?? ''));
}

function kindName(layer) {
  const kind = layer?.kind;
  if (kind === constants.LayerKind.NORMAL) return 'LayerKind.NORMAL';
  if (kind === constants.LayerKind.TEXT) return 'LayerKind.TEXT';
  if (kind === constants.LayerKind.SMARTOBJECT) return 'LayerKind.SMARTOBJECT';
  if (kind === constants.LayerKind.GROUP) return 'LayerSet';
  return String(kind ?? 'Unknown');
}

function layerPath(layer) {
  const names = [String(layer?.name ?? '')];
  let parent = layer?.parent ?? null;
  while (parent && parent.typename === 'Layer') {
    names.unshift(String(parent.name ?? ''));
    parent = parent.parent ?? null;
  }
  return names.filter(Boolean).join('/');
}

function resolveFontPostScriptName(fontName) {
  for (const font of Array.from(app.fonts ?? [])) {
    try {
      if (font.postScriptName === fontName || font.name === fontName) return font.postScriptName;
    } catch {}
  }
  return null;
}

function throwBatchPlayError(result, operationName) {
  const first = Array.isArray(result) ? result[0] : null;
  if (first && String(first._obj ?? '').toLowerCase() === 'error') {
    throw new Error(first.message || `${operationName} failed`);
  }
}

function rgbColor(red, green, blue) {
  return { _obj: 'RGBColor', red, green, blue };
}

function percent(value) {
  return { _unit: 'percentUnit', _value: value };
}

function pixels(value) {
  return { _unit: 'pixelsUnit', _value: value };
}

function degrees(value) {
  return { _unit: 'angleUnit', _value: value };
}

function layerEffectFor(params) {
  const style = String(params.style ?? 'drop_shadow');
  const red = Number(params.red);
  const green = Number(params.green);
  const blue = Number(params.blue);
  const opacity = Number(params.opacity);
  const size = Number(params.size);
  const distance = Number(params.distance);
  const angle = Number(params.angle);
  const color = rgbColor(red, green, blue);

  if (style === 'outer_glow') {
    return {
      outerGlow: {
        _obj: 'outerGlow',
        enabled: true,
        mode: { _enum: 'blendMode', _value: 'screen' },
        color,
        opacity: percent(opacity),
        chokeMatte: pixels(0),
        blur: pixels(size),
        noise: percent(0),
        shadingNoise: percent(0),
        antiAlias: true,
      },
    };
  }
  if (style === 'stroke') {
    return {
      frameFX: {
        _obj: 'frameFX',
        enabled: true,
        style: { _enum: 'frameStyle', _value: 'outsetFrame' },
        paintType: { _enum: 'frameFill', _value: 'solidColor' },
        mode: { _enum: 'blendMode', _value: 'normal' },
        opacity: percent(opacity),
        size: pixels(size),
        color,
        overprint: false,
      },
    };
  }
  if (style === 'bevel_emboss') {
    return {
      bevelEmboss: {
        _obj: 'bevelEmboss',
        enabled: true,
        style: { _enum: 'bevelEmbossStyle', _value: 'innerBevel' },
        technique: { _enum: 'bevelEmbossTechnique', _value: 'softMatte' },
        direction: { _enum: 'bevelEmbossStampStyle', _value: 'in' },
        strengthRatio: percent(100),
        blur: pixels(size),
        soften: pixels(0),
        useGlobalAngle: false,
        localLightingAngle: degrees(angle),
        localLightingAltitude: degrees(30),
        highlightMode: { _enum: 'blendMode', _value: 'screen' },
        highlightColor: rgbColor(255, 255, 255),
        highlightOpacity: percent(75),
        shadowMode: { _enum: 'blendMode', _value: 'multiply' },
        shadowColor: color,
        shadowOpacity: percent(opacity),
      },
    };
  }
  return {
    dropShadow: {
      _obj: 'dropShadow',
      enabled: true,
      mode: { _enum: 'blendMode', _value: 'multiply' },
      color,
      opacity: percent(opacity),
      useGlobalAngle: false,
      localLightingAngle: degrees(angle),
      distance: pixels(distance),
      chokeMatte: pixels(0),
      blur: pixels(size),
      noise: percent(0),
      antiAlias: false,
      layerConceals: true,
    },
  };
}

async function applyLayerStyle(params = {}) {
  return core.executeAsModal(
    async () => {
      const doc = requirePinnedActiveDocument(params);
      const layer = activeLayer(doc);
      if (!layer) throw new Error('No active layer');
      const result = await action.batchPlay(
        [{
          _obj: 'set',
          _target: [
            { _property: 'layerEffects' },
            { _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' },
          ],
          to: {
            _obj: 'layerEffects',
            scale: percent(100),
            ...layerEffectFor(params),
          },
          _options: { dialogOptions: 'dontDisplay' },
        }],
        { synchronousExecution: true }
      );
      throwBatchPlayError(result, 'apply_layer_style');
      return { applied: true, style: params.style, layer_name: layer.name };
    },
    { commandName: 'MCP Apply Layer Style' }
  );
}

async function createTextLayer(params = {}) {
  const text = typeof params.text === 'string' ? params.text : String(params.text ?? '');
  const x = Number(params.x ?? 100);
  const y = Number(params.y ?? 100);
  const fontSizePoints = Number(params.fontSize ?? 24);
  if (![x, y, fontSizePoints].every(Number.isFinite)) throw new Error('Text position and fontSize must be finite numbers');

  return core.executeAsModal(
    async () => {
      const doc = requirePinnedActiveDocument(params);
      const fontName = typeof params.fontName === 'string' && params.fontName.trim()
        ? resolveFontPostScriptName(params.fontName.trim())
        : null;
      if (params.fontName && !fontName) throw new Error(`font_not_found: ${params.fontName}`);
      const options = {
        contents: text,
        position: { x, y },
        fontSize: fontSizePoints * Number(doc.resolution || 72) / 72,
        ...(fontName ? { fontName } : {}),
      };
      const layer = await doc.createTextLayer(options);
      return {
        created: true,
        layerName: layer.name,
        text,
        position: { x, y },
        fontSize: fontSizePoints,
        ...(fontName ? { font: fontName } : {}),
        context: contextFor(doc),
        layerId: layer.id,
        path: layerPath(layer),
      };
    },
    { commandName: 'MCP Create Text Layer' }
  );
}

async function rasterizeLayer(params = {}) {
  return core.executeAsModal(
    async () => {
      const doc = requirePinnedActiveDocument(params);
      const layer = activeLayer(doc);
      if (!layer) throw new Error('No active layer');
      const originalKind = kindName(layer);
      if (layer.kind === constants.LayerKind.NORMAL) {
        return { message: 'Layer is already rasterized', kind: 'NORMAL' };
      }
      if (layer.kind === constants.LayerKind.GROUP) {
        throw new Error('Cannot rasterize a layer group — select a single layer');
      }
      const result = await action.batchPlay(
        [{
          _obj: 'rasterizeLayer',
          _target: [{ _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }],
          _options: { dialogOptions: 'dontDisplay' },
        }],
        { synchronousExecution: true }
      );
      throwBatchPlayError(result, 'rasterize_layer');
      return { rasterized: true, originalKind, newKind: 'NORMAL' };
    },
    { commandName: 'MCP Rasterize Layer' }
  );
}

async function convertToSmartObject(params = {}) {
  return core.executeAsModal(
    async () => {
      const doc = requirePinnedActiveDocument(params);
      const layer = await resolveTargetLayer(doc, params);
      if (layer.isBackgroundLayer === true) {
        throw new Error('Cannot convert background layer to Smart Object. Unlock or duplicate it first.');
      }
      if (isSmartObject(layer)) {
        return {
          already_smart_object: true,
          layer_name: layer.name,
          kind: 'LayerKind.SMARTOBJECT',
          context: contextFor(doc),
        };
      }
      const result = await action.batchPlay(
        [{ _obj: 'newPlacedLayer', _options: { dialogOptions: 'dontDisplay' } }],
        { synchronousExecution: true }
      );
      throwBatchPlayError(result, 'convert_to_smart_object');
      const converted = activeLayer(doc);
      return {
        layer_name: converted?.name ?? layer.name,
        kind: converted ? kindName(converted) : 'LayerKind.SMARTOBJECT',
        context: contextFor(doc),
      };
    },
    { commandName: 'MCP Convert to Smart Object' }
  );
}

async function createSmartObjectViaCopy(params = {}) {
  return core.executeAsModal(
    async () => {
      const doc = requirePinnedActiveDocument(params);
      const source = await resolveTargetLayer(doc, params);
      if (!isSmartObject(source)) {
        throw new Error(`Target layer "${source.name}" is not a Smart Object (kind=${kindName(source)}).`);
      }
      const sourceName = source.name;
      const result = await action.batchPlay(
        [{ _obj: 'placedLayerMakeCopy', _options: { dialogOptions: 'dontDisplay' } }],
        { synchronousExecution: true }
      );
      throwBatchPlayError(result, 'create_smart_object_via_copy');
      const copy = activeLayer(doc);
      return {
        source_layer_name: sourceName,
        new_layer_name: copy?.name ?? sourceName,
        kind: copy ? kindName(copy) : 'LayerKind.SMARTOBJECT',
        context: contextFor(doc),
      };
    },
    { commandName: 'MCP Smart Object via Copy' }
  );
}

async function editSmartObjectContents(params = {}) {
  return core.executeAsModal(
    async () => {
      const parent = requirePinnedActiveDocument(params);
      const layer = await resolveTargetLayer(parent, params);
      if (!isSmartObject(layer)) {
        throw new Error(`Target layer "${layer.name}" is not a Smart Object (kind=${kindName(layer)}).`);
      }
      const parentInfo = { name: String(parent.title ?? parent.name ?? ''), id: parent.id };
      const layerName = layer.name;
      const result = await action.batchPlay(
        [{ _obj: 'placedLayerEditContents', _options: { dialogOptions: 'dontDisplay' } }],
        { synchronousExecution: true }
      );
      throwBatchPlayError(result, 'edit_smart_object_contents');
      const embedded = app.activeDocument;
      return {
        parent_document: parentInfo,
        embedded_document: { name: String(embedded.title ?? embedded.name ?? ''), id: embedded.id },
        layer_name: layerName,
        context: contextFor(embedded),
      };
    },
    { commandName: 'MCP Edit Smart Object Contents' }
  );
}

async function replaceSmartObjectContents(params = {}) {
  const filePath = typeof params.file_path === 'string' ? params.file_path.trim() : '';
  if (!filePath) throw new Error('file_path is required.');
  const entry = await localFileSystem.getEntryWithUrl(fileUrlFromNativePath(filePath, 'replace_smart_object_contents'));
  if (!entry || entry.isFile === false) throw new Error(`Replacement file not found: ${filePath}`);
  const token = localFileSystem.createSessionToken(entry);

  return core.executeAsModal(
    async () => {
      const doc = requirePinnedActiveDocument(params);
      const layer = await resolveTargetLayer(doc, params);
      if (!isSmartObject(layer)) {
        throw new Error(`Target layer "${layer.name}" is not a Smart Object (kind=${kindName(layer)}).`);
      }
      const result = await action.batchPlay(
        [{
          _obj: 'placedLayerReplaceContents',
          null: { _path: token, _kind: 'local' },
          pageNumber: 1,
          _options: { dialogOptions: 'dontDisplay' },
        }],
        { synchronousExecution: true }
      );
      throwBatchPlayError(result, 'replace_smart_object_contents');
      return { layer_name: activeLayer(doc)?.name ?? layer.name, file_path: filePath, context: contextFor(doc) };
    },
    { commandName: 'MCP Replace Smart Object Contents' }
  );
}

async function skyReplacement(params = {}) {
  if (!app.documents || app.documents.length === 0) {
    return { ok: false, code: 'no_active_document', message: 'No active document' };
  }
  const skyPath = typeof params.sky_image_path === 'string' ? params.sky_image_path.trim() : '';
  let pathValue;
  if (skyPath) {
    const entry = await localFileSystem.getEntryWithUrl(fileUrlFromNativePath(skyPath, 'sky_replacement'));
    if (!entry || entry.isFile === false) throw new Error(`Sky image not found: ${skyPath}`);
    const token = localFileSystem.createSessionToken(entry);
    pathValue = { _path: token, _kind: 'local' };
  }
  return core.executeAsModal(
    async () => {
      requirePinnedActiveDocument(params);
      const descriptor = {
        _obj: 'skyReplacement',
        ...(pathValue ? { skyImage: pathValue, null: pathValue } : {}),
        _options: { dialogOptions: 'dontDisplay' },
      };
      const result = await action.batchPlay([descriptor], { synchronousExecution: true });
      throwBatchPlayError(result, 'sky_replacement');
      return {
        ok: true,
        summary: 'Native Sky Replacement invoked via skyReplacement',
        details: { action_id: 'skyReplacement', sky_image_path: skyPath },
        next_suggested_tool: 'photoshop_get_preview',
      };
    },
    { commandName: 'MCP Sky Replacement' }
  );
}

async function tryHandleP3LayerAdvancedOperation(cmdAction, params = {}) {
  switch (cmdAction) {
    case 'apply_layer_style': return { handled: true, data: await applyLayerStyle(params) };
    case 'create_text_layer': return { handled: true, data: await createTextLayer(params) };
    case 'rasterize_layer': return { handled: true, data: await rasterizeLayer(params) };
    case 'sky_replacement': return { handled: true, data: await skyReplacement(params) };
    case 'convert_to_smart_object': return { handled: true, data: await convertToSmartObject(params) };
    case 'create_smart_object_via_copy': return { handled: true, data: await createSmartObjectViaCopy(params) };
    case 'edit_smart_object_contents': return { handled: true, data: await editSmartObjectContents(params) };
    case 'replace_smart_object_contents': return { handled: true, data: await replaceSmartObjectContents(params) };
    default: return { handled: false };
  }
}

module.exports = { tryHandleP3LayerAdvancedOperation };
