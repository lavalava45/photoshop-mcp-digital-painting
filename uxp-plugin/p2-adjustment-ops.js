const photoshop = require('photoshop');
const { localFileSystem } = require('uxp').storage;

const { action, app, core } = photoshop;

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

function numericValue(value) {
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object' && typeof value._value === 'number') return value._value;
  if (value && typeof value === 'object' && typeof value.value === 'number') return value.value;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function activeLayerKindDescriptor() {
  return {
    _obj: 'get',
    _target: [
      { _property: 'layerKind' },
      { _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' },
    ],
    _options: { dialogOptions: 'dontDisplay' },
  };
}

async function rasterizeTextOrSmartObject() {
  const [descriptor] = await action.batchPlay(
    [activeLayerKindDescriptor()],
    { synchronousExecution: true }
  );
  const layerKind = numericValue(descriptor?.layerKind);
  if (layerKind !== 3 && layerKind !== 5) return;
  await action.batchPlay(
    [{
      _obj: 'rasterizeLayer',
      _target: [{ _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }],
      _options: { dialogOptions: 'dontDisplay' },
    }],
    { synchronousExecution: true }
  );
}

async function setActiveLayerNormalBlendMode() {
  await action.batchPlay(
    [{
      _obj: 'set',
      _target: [{ _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }],
      to: {
        _obj: 'layer',
        mode: { _enum: 'blendMode', _value: 'normal' },
      },
      _options: { dialogOptions: 'dontDisplay' },
    }],
    { synchronousExecution: true }
  );
}

function isNormalBlendMode(layer) {
  const value = String(layer?.blendMode ?? '').toLowerCase();
  return value === 'normal' || value.endsWith('.normal');
}

async function runPixelAdjustment(params, operationName, descriptor, options = {}) {
  return core.executeAsModal(
    async () => {
      const doc = requirePinnedActiveDocument(params);
      const layer = requireActiveLayer(doc, operationName);
      if (options.normalizeBlendMode === true && !isNormalBlendMode(layer)) {
        await setActiveLayerNormalBlendMode();
      }
      await rasterizeTextOrSmartObject();
      await action.batchPlay(
        [{ ...descriptor, _options: { dialogOptions: 'dontDisplay' } }],
        { synchronousExecution: true }
      );
      return options.result ?? {};
    },
    { commandName: operationName }
  );
}

function adjustmentLayerDescriptor(type) {
  return {
    _obj: 'make',
    _target: [{ _ref: 'adjustmentLayer' }],
    using: {
      _obj: 'adjustmentLayer',
      type,
    },
    _options: { dialogOptions: 'dontDisplay' },
  };
}

async function makeAdjustmentLayer(params, operationName, type, extraResult = {}) {
  return core.executeAsModal(
    async () => {
      const doc = requirePinnedActiveDocument(params);
      await action.batchPlay(
        [adjustmentLayerDescriptor(type)],
        { synchronousExecution: true }
      );
      const layer = requireActiveLayer(doc, operationName);
      return {
        created: true,
        layer_name: layer.name,
        ...extraResult,
      };
    },
    { commandName: operationName }
  );
}

async function adjustBrightnessContrast(params = {}) {
  const brightness = Number(params.brightness);
  const contrast = Number(params.contrast);
  if (!Number.isFinite(brightness) || !Number.isFinite(contrast)) {
    throw new Error('brightness and contrast must be finite numbers');
  }
  return runPixelAdjustment(
    params,
    'MCP Brightness Contrast',
    {
      _obj: 'brightnessEvent',
      brightness,
      center: contrast,
      useLegacy: false,
    },
    { result: { adjustment: 'Brightness/Contrast', brightness, contrast } }
  );
}

async function adjustHueSaturation(params = {}) {
  const hue = Number(params.hue);
  const saturation = Number(params.saturation);
  const lightness = Number(params.lightness);
  if (![hue, saturation, lightness].every(Number.isFinite)) {
    throw new Error('hue, saturation and lightness must be finite numbers');
  }
  return runPixelAdjustment(
    params,
    'MCP Hue Saturation',
    {
      _obj: 'hueSaturation',
      presetKind: { _enum: 'presetKindType', _value: 'presetKindCustom' },
      colorize: false,
      adjustment: [{
        _obj: 'hueSatAdjustmentV2',
        hue,
        saturation,
        lightness,
      }],
    },
    {
      normalizeBlendMode: true,
      result: { adjustment: 'Hue/Saturation', hue, saturation, lightness },
    }
  );
}

async function autoContrast(params = {}) {
  return runPixelAdjustment(
    params,
    'MCP Auto Contrast',
    { _obj: 'autoContrast' },
    { result: { adjustment: 'Auto Contrast' } }
  );
}

async function autoLevels(params = {}) {
  return runPixelAdjustment(
    params,
    'MCP Auto Levels',
    { _obj: 'autoLevels' },
    { result: { adjustment: 'Auto Levels' } }
  );
}

async function desaturate(params = {}) {
  return runPixelAdjustment(
    params,
    'MCP Desaturate',
    { _obj: 'desaturate' },
    {
      normalizeBlendMode: true,
      result: { adjustment: 'Desaturate' },
    }
  );
}

async function invert(params = {}) {
  return runPixelAdjustment(
    params,
    'MCP Invert',
    { _obj: 'invert' },
    { result: { adjustment: 'Invert' } }
  );
}

async function adjustCurves(params = {}) {
  const preset = params.preset === 'neutral' ? 'neutral' : 'auto_tone';
  const points = preset === 'neutral'
    ? [[0, 0], [255, 255]]
    : [[12, 0], [243, 255]];
  return makeAdjustmentLayer(
    params,
    'MCP Curves Adjustment',
    {
      _obj: 'curves',
      adjustment: [{
        _obj: 'curvesAdjustment',
        channel: { _ref: 'channel', _enum: 'channel', _value: 'composite' },
        curve: points.map(([horizontal, vertical]) => ({
          _obj: 'paint',
          horizontal,
          vertical,
        })),
      }],
    },
    { preset }
  );
}

async function adjustExposure(params = {}) {
  const exposure = Number(params.exposure);
  const offset = Number(params.offset);
  const gamma = Number(params.gamma);
  if (![exposure, offset, gamma].every(Number.isFinite)) {
    throw new Error('exposure, offset and gamma must be finite numbers');
  }
  return makeAdjustmentLayer(
    params,
    'MCP Exposure Adjustment',
    {
      _obj: 'exposure',
      presetKind: { _enum: 'presetKindType', _value: 'presetKindCustom' },
      exposure,
      offset,
      gammaCorrection: gamma,
    },
    { exposure, offset, gamma }
  );
}

async function adjustVibrance(params = {}) {
  const vibrance = Number(params.vibrance);
  const saturation = Number(params.saturation);
  if (![vibrance, saturation].every(Number.isFinite)) {
    throw new Error('vibrance and saturation must be finite numbers');
  }
  return makeAdjustmentLayer(
    params,
    'MCP Vibrance Adjustment',
    {
      _obj: 'vibrance',
      vibrance,
      saturation,
    },
    { vibrance, saturation }
  );
}

async function applyPhotoFilter(params = {}) {
  const red = Number(params.red);
  const green = Number(params.green);
  const blue = Number(params.blue);
  const density = Number(params.density);
  const preserveLuminosity = params.preserve_luminosity !== false;
  if (![red, green, blue, density].every(Number.isFinite)) {
    throw new Error('photo filter color and density must be finite numbers');
  }
  return makeAdjustmentLayer(
    params,
    'MCP Photo Filter Adjustment',
    {
      _obj: 'photoFilter',
      type: { _enum: 'photoFilterType', _value: 'photoFilterColor' },
      color: { _obj: 'RGBColor', red, green, blue },
      density: { _unit: 'percentUnit', _value: density },
      preserveLuminosity,
    },
    { color: { red, green, blue }, density }
  );
}

function gradientStop(location, gray) {
  return {
    _obj: 'colorStop',
    color: { _obj: 'grayscale', gray },
    type: { _enum: 'colorStopType', _value: 'userStop' },
    location,
    midpoint: 50,
  };
}

function transparencyStop(location) {
  return {
    _obj: 'transferSpec',
    opacity: { _unit: 'percentUnit', _value: 100 },
    location,
    midpoint: 50,
  };
}

async function applyGradientMap(params = {}) {
  const reverse = params.reverse === true;
  return makeAdjustmentLayer(
    params,
    'MCP Gradient Map Adjustment',
    {
      _obj: 'gradientMapClass',
      gradient: {
        _obj: 'gradientClassEvent',
        name: 'MCP Gradient Map',
        gradientForm: { _enum: 'gradientForm', _value: 'customStops' },
        interfaceIconFrameDimmed: 4096,
        colors: [
          gradientStop(reverse ? 4096 : 0, 0),
          gradientStop(reverse ? 0 : 4096, 100),
        ],
        transparency: [transparencyStop(0), transparencyStop(4096)],
      },
    },
    { reverse }
  );
}

function fileUrlFromNativePath(nativePath) {
  let normalized = nativePath.trim().replace(/\\/g, '/');
  if (/^[A-Za-z]:\//.test(normalized)) normalized = `/${normalized}`;
  if (!normalized.startsWith('/')) return null;
  return `file:${encodeURI(normalized)}`;
}

async function resolveLutValue(lut) {
  const url = fileUrlFromNativePath(lut);
  if (!url) return { value: lut, source: 'builtin' };
  try {
    const entry = await localFileSystem.getEntryWithUrl(url);
    if (!entry || entry.isFile === false) return { value: lut, source: 'builtin' };
    const token = localFileSystem.createSessionToken(entry);
    return { value: { _path: token, _kind: 'local' }, source: 'file' };
  } catch {
    return { value: lut, source: 'builtin' };
  }
}

async function applyLut(params = {}) {
  const lut = typeof params.lut === 'string' ? params.lut.trim() : '';
  if (!lut) throw new Error('lut parameter is required');
  const resolved = await resolveLutValue(lut);
  return makeAdjustmentLayer(
    params,
    'MCP Color Lookup Adjustment',
    {
      _obj: 'colorLookup',
      lookupType: { _enum: 'colorLookupType', _value: '3DLUT' },
      LUT3DFileName: resolved.value,
    },
    { lut, lut_source: resolved.source }
  );
}

async function tryHandleP2AdjustmentOperation(cmdAction, params = {}) {
  switch (cmdAction) {
    case 'adjust_brightness_contrast':
      return { handled: true, data: await adjustBrightnessContrast(params) };
    case 'adjust_curves':
      return { handled: true, data: await adjustCurves(params) };
    case 'adjust_exposure':
      return { handled: true, data: await adjustExposure(params) };
    case 'adjust_hue_saturation':
      return { handled: true, data: await adjustHueSaturation(params) };
    case 'adjust_vibrance':
      return { handled: true, data: await adjustVibrance(params) };
    case 'apply_gradient_map':
      return { handled: true, data: await applyGradientMap(params) };
    case 'apply_lut':
      return { handled: true, data: await applyLut(params) };
    case 'apply_photo_filter':
      return { handled: true, data: await applyPhotoFilter(params) };
    case 'auto_contrast':
      return { handled: true, data: await autoContrast(params) };
    case 'auto_levels':
      return { handled: true, data: await autoLevels(params) };
    case 'desaturate':
      return { handled: true, data: await desaturate(params) };
    case 'invert':
      return { handled: true, data: await invert(params) };
    default:
      return { handled: false };
  }
}

module.exports = { tryHandleP2AdjustmentOperation };
