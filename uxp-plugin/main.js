/**
 * Photoshop MCP UXP Bridge — keeps a localhost long-poll open for commands and
 * runs them inside Photoshop. Load via Adobe UXP Developer Tools.
 */
const { entrypoints } = require('uxp');
const photoshop = require('photoshop');
const { action, core, app, constants } = photoshop;
const { localFileSystem, types } = require('uxp').storage;
const { tryHandleP1DocumentOperation } = require('./p1-document-ops');
const { tryHandleP1SelectionOperation } = require('./p1-selection-ops');
const { tryHandleP1LayerOperation } = require('./p1-layer-ops');
const { tryHandleP2AdjustmentOperation } = require('./p2-adjustment-ops');
const { tryHandleP2FilterOperation } = require('./p2-filter-ops');
const { tryHandleP2TextExportOperation } = require('./p2-text-export-ops');
const { tryHandleP3UtilityOperation } = require('./p3-utility-ops');
const { tryHandleP3DocumentDataOperation } = require('./p3-document-data-ops');
const { tryHandleP3LayerAdvancedOperation } = require('./p3-layer-advanced-ops');

const BRIDGE_PORT = 38452;
const BRIDGE_BASE = `http://127.0.0.1:${BRIDGE_PORT}`;
const BRIDGE_REVISION = 'compact-v2-20260923-full';
const REGISTRATION_PROTOCOL = 'photoshop.uxp.registration.v1';
const COMMAND_PROTOCOL = 'photoshop.uxp.command.v1';
const RESULT_PROTOCOL = 'photoshop.uxp.command_result.v1';

let polling = false;
const pendingResultDeliveries = new Map();
const RESULT_DELIVERY_TTL_MS = 15 * 60 * 1000;
const MAX_PENDING_RESULT_DELIVERIES = 128;

function fileUrlFromNativePath(nativePath, operation = 'save_document') {
  if (typeof nativePath !== 'string' || nativePath.trim().length === 0) {
    throw new Error(`${operation} requires a non-empty absolute path`);
  }
  let normalized = nativePath.trim().replace(/\\/g, '/');
  if (/^[A-Za-z]:\//.test(normalized)) normalized = `/${normalized}`;
  if (!normalized.startsWith('/')) {
    throw new Error(`${operation} requires an absolute path: ${nativePath}`);
  }
  return `file:${encodeURI(normalized)}`;
}

function normalizedBounds(bounds) {
  if (!bounds) return null;
  return {
    left: numericValue(bounds.left),
    top: numericValue(bounds.top),
    right: numericValue(bounds.right),
    bottom: numericValue(bounds.bottom),
  };
}

function numericValue(value) {
  if (typeof value === 'number') return value;
  if (value && typeof value._value === 'number') return value._value;
  if (value && typeof value.value === 'number') return value.value;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

// Action Manager document dimensions may be points even when callers use pixels.
// Never apply this conversion to unitless ids, opacity, or Imaging API sizes.
function documentPixelDimension(value, resolution) {
  const number = numericValue(value);
  if (number == null) return undefined;
  const unit = value && typeof value === 'object' ? value._unit : undefined;
  if (!unit || unit === 'pixelsUnit') return number;
  const dpi = numericValue(resolution);
  if (!(dpi > 0)) throw new Error('document dimension requires a positive resolution');
  // Photoshop uses distanceUnit for document lengths in some descriptors. Its
  // base value is points (72 per inch), just like an explicit pointsUnit.
  if (unit === 'pointsUnit' || unit === 'distanceUnit') return number * dpi / 72;
  if (unit === 'inchesUnit') return number * dpi;
  if (unit === 'centimetersUnit') return number * dpi / 2.54;
  if (unit === 'millimetersUnit') return number * dpi / 25.4;
  throw new Error(`Unsupported document dimension unit: ${unit}`);
}

function descriptorValue(value) {
  if (value && typeof value === 'object' && '_value' in value) {
    return value._value;
  }
  return value;
}

function legacyEnum(prefix, value) {
  if (value == null) return undefined;
  const raw = String(descriptorValue(value));
  if (prefix === 'LayerKind' && raw.toUpperCase() === 'LAYERKIND.PIXEL') {
    return 'LayerKind.NORMAL';
  }
  if (raw.startsWith(`${prefix}.`)) return raw;
  if (prefix === 'LayerKind' && raw.toLowerCase() === 'pixel') {
    return 'LayerKind.NORMAL';
  }
  const token = raw
    .replace(/([a-z0-9])([A-Z])/g, '$1$2')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase();
  return token ? `${prefix}.${token}` : undefined;
}

function legacyDocumentMode(value) {
  const raw = String(value ?? '');
  if (raw.startsWith('DocumentMode.')) return raw;
  const key = raw.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  const aliases = {
    rgb: 'RGB',
    rgbcolor: 'RGB',
    rgbcolormode: 'RGB',
    cmyk: 'CMYK',
    cmykcolor: 'CMYK',
    cmykcolormode: 'CMYK',
    grayscale: 'GRAYSCALE',
    grayscalemode: 'GRAYSCALE',
    bitmap: 'BITMAP',
    bitmapmode: 'BITMAP',
    lab: 'LAB',
    labcolormode: 'LAB',
    indexedcolor: 'INDEXEDCOLOR',
    indexedcolormode: 'INDEXEDCOLOR',
    duotone: 'DUOTONE',
    duotonemode: 'DUOTONE',
    multichannel: 'MULTICHANNEL',
    multichannelmode: 'MULTICHANNEL',
  };
  const token = aliases[key] || key.toUpperCase();
  return token ? `DocumentMode.${token}` : undefined;
}

function legacyOpacity(value) {
  if (value && typeof value === 'object' && value._unit === 'percentUnit') {
    return numericValue(value);
  }
  const numeric = numericValue(value);
  if (numeric == null) return undefined;
  if (numeric > 100 && numeric <= 255) return (numeric * 100) / 255;
  return numeric;
}

function adjustmentObjectName(adjustment) {
  const queue = Array.isArray(adjustment) ? [...adjustment] : [adjustment];
  while (queue.length > 0) {
    const value = queue.shift();
    if (!value || typeof value !== 'object') continue;
    if (typeof value._obj === 'string') return value._obj;
    for (const nested of Object.values(value)) {
      if (nested && typeof nested === 'object') queue.push(nested);
    }
  }
  return null;
}

function legacyLayerKind(layerDescriptor) {
  const rawKind = descriptorValue(layerDescriptor?.layerKind ?? layerDescriptor?.kind);
  const numericKind = numericValue(rawKind);
  const adjustmentKinds = {
    brightnessContrast: 'BRIGHTNESSCONTRAST',
    levels: 'LEVELS',
    curves: 'CURVES',
    exposure: 'EXPOSURE',
    vibrance: 'VIBRANCE',
    hueSaturation: 'HUESATURATION',
    colorBalance: 'COLORBALANCE',
    blackAndWhite: 'BLACKANDWHITE',
    photoFilter: 'PHOTOFILTER',
    channelMixer: 'CHANNELMIXER',
    colorLookup: 'COLORLOOKUP',
    invert: 'INVERSION',
    inversion: 'INVERSION',
    posterization: 'POSTERIZE',
    posterize: 'POSTERIZE',
    thresholdClassEvent: 'THRESHOLD',
    threshold: 'THRESHOLD',
    selectiveColor: 'SELECTIVECOLOR',
    gradientMapClass: 'GRADIENTMAP',
    gradientMap: 'GRADIENTMAP',
  };

  if (numericKind === 2) {
    const adjustmentName = adjustmentObjectName(layerDescriptor?.adjustment);
    const token = adjustmentName ? adjustmentKinds[adjustmentName] : undefined;
    return token ? `LayerKind.${token}` : undefined;
  }

  const numericMap = {
    1: 'NORMAL',
    3: 'TEXT',
    4: 'SOLIDFILL',
    5: 'SMARTOBJECT',
    6: 'VIDEO',
    8: 'LAYER3D',
    9: 'GRADIENTFILL',
    10: 'PATTERNFILL',
    11: 'SOLIDFILL',
    12: 'NORMAL',
  };
  if (numericKind != null && numericMap[numericKind]) {
    return `LayerKind.${numericMap[numericKind]}`;
  }

  if (typeof rawKind === 'string') {
    const stringMap = {
      pixel: 'NORMAL',
      text: 'TEXT',
      vector: 'SOLIDFILL',
      smartObject: 'SMARTOBJECT',
      video: 'VIDEO',
      threeD: 'LAYER3D',
      gradient: 'GRADIENTFILL',
      pattern: 'PATTERNFILL',
      solidColor: 'SOLIDFILL',
      background: 'NORMAL',
    };
    const token = stringMap[rawKind];
    if (token) return `LayerKind.${token}`;
  }

  // Action Manager kinds 7/13 are layer-set boundaries. ExtendScript's
  // getContextInfo() falls through to activeLayer=null for LayerSet because
  // LayerSet has no ArtLayer.kind property, so preserve that legacy behavior.
  return undefined;
}

const READ_BATCHPLAY_OPTIONS = {
  synchronousExecution: true,
  modalBehavior: 'fail',
};

function getNumberOfDocumentsDescriptor() {
  return {
    _obj: 'get',
    _target: [
      { _property: 'numberOfDocuments' },
      { _ref: 'application', _enum: 'ordinal', _value: 'targetEnum' },
    ],
    _options: { dialogOptions: 'dontDisplay' },
  };
}

function stateMultiGetDescriptors() {
  return [
    {
      _obj: 'multiGet',
      _target: {
        _ref: [{ _ref: 'document', _enum: 'ordinal', _value: 'targetEnum' }],
      },
      extendedReference: [[
        'documentID',
        'title',
        'width',
        'height',
        'resolution',
        'mode',
        'numberOfLayers',
        'hasBackgroundLayer',
        'selection',
      ]],
      options: { failOnMissingProperty: false, failOnMissingElement: false },
      _options: { dialogOptions: 'dontDisplay' },
    },
    {
      _obj: 'multiGet',
      _target: {
        _ref: [
          { _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' },
          { _ref: 'document', _enum: 'ordinal', _value: 'targetEnum' },
        ],
      },
      extendedReference: [[
        'name',
        'layerKind',
        'adjustment',
        'opacity',
        'mode',
        'visible',
        'layerLocking',
        'background',
        'bounds',
      ]],
      options: { failOnMissingProperty: false, failOnMissingElement: false },
      _options: { dialogOptions: 'dontDisplay' },
    },
  ];
}

async function readSessionDescriptors(batchOptions = READ_BATCHPLAY_OPTIONS) {
  const countResult = await action.batchPlay(
    [getNumberOfDocumentsDescriptor()],
    batchOptions
  );
  const countDescriptor = countResult?.[0] ?? {};
  const documentCount = numericValue(countDescriptor.numberOfDocuments) ?? 0;
  if (documentCount <= 0) {
    return { documentCount: 0, countDescriptor, documentDescriptor: null, layerDescriptor: null };
  }

  const stateResult = await action.batchPlay(
    stateMultiGetDescriptors(),
    batchOptions
  );
  return {
    documentCount,
    countDescriptor,
    documentDescriptor: stateResult?.[0] ?? null,
    layerDescriptor: stateResult?.[1] ?? null,
  };
}

function normalizeSessionState(descriptors) {
  const context = {
    hasDocument: descriptors.documentCount > 0,
  };

  if (!context.hasDocument) return context;

  const docDescriptor = descriptors.documentDescriptor ?? {};
  const document = {};
  const documentId = numericValue(docDescriptor.documentID);
  if (documentId != null) document.id = documentId;
  if (typeof docDescriptor.title === 'string') document.name = docDescriptor.title;
  const width = documentPixelDimension(docDescriptor.width, docDescriptor.resolution);
  if (width != null) document.width = width;
  const height = documentPixelDimension(docDescriptor.height, docDescriptor.resolution);
  if (height != null) document.height = height;
  const resolution = numericValue(docDescriptor.resolution);
  if (resolution != null) document.resolution = resolution;
  const colorMode = legacyDocumentMode(descriptorValue(docDescriptor.mode));
  if (colorMode) document.colorMode = colorMode;
  const actionManagerLayerCount = numericValue(docDescriptor.numberOfLayers);
  if (actionManagerLayerCount != null) {
    // Action Manager's numberOfLayers excludes the background layer while
    // ExtendScript's doc.layers.length includes it. Preserve the public
    // photoshop_get_state legacy contract.
    document.layerCount =
      actionManagerLayerCount + (docDescriptor.hasBackgroundLayer === true ? 1 : 0);
  }
  document.hasSelection =
    Object.prototype.hasOwnProperty.call(docDescriptor, 'selection') &&
    docDescriptor.selection != null;
  context.document = document;

  const layerDescriptor = descriptors.layerDescriptor;
  const kind = legacyLayerKind(layerDescriptor);
  if (!layerDescriptor || !kind) {
    context.activeLayer = null;
    return context;
  }

  const activeLayer = {};
  const activeLayerId = numericValue(layerDescriptor.layerID);
  if (activeLayerId != null) activeLayer.id = activeLayerId;
  if (typeof layerDescriptor.name === 'string') activeLayer.name = layerDescriptor.name;
  activeLayer.kind = kind;
  const opacity = legacyOpacity(layerDescriptor.opacity);
  if (opacity != null) activeLayer.opacity = opacity;
  const blendMode = legacyEnum('BlendMode', layerDescriptor.mode);
  if (blendMode) activeLayer.blendMode = blendMode;
  if (typeof layerDescriptor.visible === 'boolean') activeLayer.visible = layerDescriptor.visible;
  const locking = layerDescriptor.layerLocking;
  activeLayer.locked = Boolean(
    locking && typeof locking === 'object'
      ? locking.protectAll ?? locking.allLocked
      : layerDescriptor.allLocked ?? layerDescriptor.locked
  );
  activeLayer.isBackground = Boolean(layerDescriptor.background);
  const bounds = normalizedBounds(layerDescriptor.bounds);
  if (bounds && Object.values(bounds).every((value) => value != null)) {
    activeLayer.bounds = bounds;
  }
  context.activeLayer = activeLayer;
  return context;
}

async function snapshotSessionState() {
  return normalizeSessionState(await readSessionDescriptors());
}

function documentInfoDescriptor(index) {
  return {
    _obj: 'multiGet',
    _target: {
      _ref: [{ _ref: 'document', _index: index }],
    },
    extendedReference: [[
      'documentID',
      'title',
      'width',
      'height',
      'resolution',
    ]],
    options: { failOnMissingProperty: false, failOnMissingElement: false },
    _options: { dialogOptions: 'dontDisplay' },
  };
}

async function snapshotDocumentList() {
  const sessionDescriptors = await readSessionDescriptors();
  const context = normalizeSessionState(sessionDescriptors);
  const documentCount = sessionDescriptors.documentCount;
  if (documentCount <= 0) {
    return {
      ok: true,
      count: 0,
      documents: [],
      active_document_id: null,
      context,
    };
  }

  const activeDocumentId = numericValue(sessionDescriptors.documentDescriptor?.documentID) ?? null;
  const descriptors = await action.batchPlay(
    Array.from({ length: documentCount }, (_, index) => documentInfoDescriptor(index + 1)),
    READ_BATCHPLAY_OPTIONS
  );
  const documents = descriptors.map((descriptor) => {
    const entry = {
      is_active: false,
    };
    const id = numericValue(descriptor?.documentID);
    if (id != null) entry.id = id;
    if (typeof descriptor?.title === 'string') entry.name = descriptor.title;
    const width = documentPixelDimension(descriptor?.width, descriptor?.resolution);
    if (width != null) entry.width = width;
    const height = documentPixelDimension(descriptor?.height, descriptor?.resolution);
    if (height != null) entry.height = height;
    const resolution = numericValue(descriptor?.resolution);
    if (resolution != null) entry.resolution = resolution;
    entry.is_active = id != null && activeDocumentId != null && id === activeDocumentId;
    return entry;
  });

  return {
    ok: true,
    count: documents.length,
    documents,
    active_document_id: activeDocumentId,
    context,
  };
}

function normalizeSelectionBounds(selection) {
  if (!selection || typeof selection !== 'object') return null;
  const bounds = {
    left: numericValue(selection.left),
    top: numericValue(selection.top),
    right: numericValue(selection.right),
    bottom: numericValue(selection.bottom),
  };
  return Object.values(bounds).every((value) => value != null) ? bounds : null;
}

async function snapshotSelectionBounds(batchOptions = READ_BATCHPLAY_OPTIONS) {
  const descriptors = await readSessionDescriptors(batchOptions);
  if (descriptors.documentCount <= 0) {
    return { ok: false, code: 'no_document', message: 'No active document' };
  }

  const context = normalizeSessionState(descriptors);
  const selection = descriptors.documentDescriptor?.selection;
  if (selection == null) {
    return {
      ok: true,
      has_selection: false,
      context,
    };
  }

  const bounds = normalizeSelectionBounds(selection);
  if (!bounds) {
    return {
      ok: false,
      code: 'selection_bounds_error',
      message: 'Failed to read selection bounds',
    };
  }

  return {
    ok: true,
    has_selection: true,
    bounds,
    context,
  };
}

function layerByIndexDescriptor(index) {
  return {
    _obj: 'get',
    _target: [
      { _ref: 'layer', _index: index },
      { _ref: 'document', _enum: 'ordinal', _value: 'targetEnum' },
    ],
    _options: { dialogOptions: 'dontDisplay' },
  };
}

function layerSectionValue(descriptor) {
  return String(descriptorValue(descriptor?.layerSection) ?? '');
}

function normalizeListedLayer(descriptor, depth, pathParts, isGroup) {
  const entry = {};
  const name = typeof descriptor?.name === 'string' ? descriptor.name : '';
  entry.name = name;
  entry.typename = isGroup ? 'LayerSet' : 'ArtLayer';
  entry.depth = depth;
  entry.path = [...pathParts, name].join('/');
  if (typeof descriptor?.visible === 'boolean') entry.visible = descriptor.visible;
  const opacity = legacyOpacity(descriptor?.opacity);
  if (opacity != null) entry.opacity = opacity;
  const blendMode = legacyEnum('BlendMode', descriptor?.mode);
  if (blendMode) entry.blendMode = blendMode;
  const id = numericValue(descriptor?.layerID ?? descriptor?.layerId);
  if (id != null) entry.id = id;
  if (isGroup) {
    entry.kind = 'LayerSet';
  } else {
    const kind = legacyLayerKind(descriptor);
    entry.kind = kind ?? 'ArtLayer';
  }
  return entry;
}

async function snapshotLayerList() {
  const sessionDescriptors = await readSessionDescriptors();
  if (sessionDescriptors.documentCount <= 0) {
    throw new Error('No active document');
  }

  const docDescriptor = sessionDescriptors.documentDescriptor ?? {};
  const actionManagerLayerCount = numericValue(docDescriptor.numberOfLayers) ?? 0;
  const hasBackground = docDescriptor.hasBackgroundLayer === true;
  const firstIndex = hasBackground ? 0 : 1;
  const lastIndex = Math.max(firstIndex - 1, actionManagerLayerCount);
  const indices = [];
  for (let index = firstIndex; index <= lastIndex; index++) indices.push(index);

  const rawDescriptors = indices.length > 0
    ? await action.batchPlay(indices.map(layerByIndexDescriptor), READ_BATCHPLAY_OPTIONS)
    : [];

  // Action Manager indexes run bottom-to-top. ExtendScript's container.layers
  // iteration is top-to-bottom and recursively enters LayerSet children, so
  // reverse the AM sequence and use layerSection start/end markers as the
  // hierarchy stack. Section-end pseudo-layers are never part of the public
  // legacy result.
  const layers = [];
  const pathParts = [];
  for (const descriptor of [...rawDescriptors].reverse()) {
    if (!descriptor || descriptor._obj === 'error') continue;
    const section = layerSectionValue(descriptor);
    if (section === 'layerSectionEnd') {
      if (pathParts.length > 0) pathParts.pop();
      continue;
    }
    const isGroup = section === 'layerSectionStart';
    const depth = pathParts.length;
    const entry = normalizeListedLayer(descriptor, depth, pathParts, isGroup);
    layers.push(entry);
    if (isGroup) pathParts.push(entry.name);
  }

  return {
    layerCount: layers.length,
    layers,
    context: normalizeSessionState(sessionDescriptors),
  };
}

async function snapshotBrushPresets(params = {}) {
  const query = String(params.query ?? '').toLowerCase();
  const requestedLimit = Number(params.limit ?? 200);
  const limit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(1000, Math.round(requestedLimit)))
    : 200;
  const [descriptor] = await action.batchPlay(
    [{
      _obj: 'get',
      _target: [
        { _property: 'presetManager' },
        { _ref: 'application', _enum: 'ordinal', _value: 'targetEnum' },
      ],
      _options: { dialogOptions: 'dontDisplay' },
    }],
    READ_BATCHPLAY_OPTIONS
  );

  const managers = Array.isArray(descriptor?.presetManager)
    ? descriptor.presetManager
    : [];
  let names = [];
  for (const manager of managers) {
    const managerType = String(manager?._obj ?? manager?._class ?? '');
    if (managerType !== 'brush') continue;
    if (Array.isArray(manager.name)) {
      names = manager.name.map((value) => String(descriptorValue(value)));
    }
    break;
  }

  const filtered = query
    ? names.filter((name) => name.toLowerCase().includes(query))
    : names;
  const visible = filtered.slice(0, limit);
  return {
    ok: true,
    total: names.length,
    matched: filtered.length,
    truncated: filtered.length > visible.length,
    presets: visible,
  };
}

function currentToolOptionsDescriptor() {
  return {
    _obj: 'get',
    _target: [
      { _property: 'currentToolOptions' },
      { _ref: 'application', _enum: 'ordinal', _value: 'targetEnum' },
    ],
    _options: { dialogOptions: 'dontDisplay' },
  };
}

function normalizeBrushSettingsDescriptor(descriptor) {
  const opts = descriptor?.currentToolOptions;
  const brush = opts?.brush;
  if (!opts || typeof opts !== 'object' || !brush || typeof brush !== 'object') {
    throw new Error('brush_settings_unavailable_for_current_tool');
  }

  function valueOr(value, fallback) {
    const numeric = numericValue(value);
    return numeric == null ? fallback : numeric;
  }

  const presetName = [
    brush.name,
    brush._name,
    opts.presetName,
    opts.brushPreset,
    opts.brushName,
  ].find((value) => typeof value === 'string' && value.trim().length > 0);

  return {
    ok: true,
    ...(presetName ? { preset: presetName.trim() } : {}),
    settings: {
      size: valueOr(brush.diameter, 1),
      hardness: valueOr(brush.hardness, 100),
      angle: valueOr(brush.angle, 0),
      roundness: valueOr(brush.roundness, 100),
      spacing: valueOr(brush.spacing, 25),
      opacity: valueOr(opts.opacity, 100),
      flow: valueOr(opts.flow, 100),
      flip_x: typeof brush.flipX === 'boolean' ? brush.flipX : false,
      flip_y: typeof brush.flipY === 'boolean' ? brush.flipY : false,
      use_pressure_size:
        typeof opts.usePressureOverridesSize === 'boolean'
          ? opts.usePressureOverridesSize
          : false,
      use_pressure_opacity:
        typeof opts.usePressureOverridesOpacity === 'boolean'
          ? opts.usePressureOverridesOpacity
          : false,
      airbrush: typeof opts.repeat === 'boolean' ? opts.repeat : false,
      smoothing_enabled: typeof opts.smoothing === 'boolean' ? opts.smoothing : false,
      smoothing: valueOr(opts.smooth, 10),
    },
  };
}

async function snapshotBrushSettings(batchOptions = READ_BATCHPLAY_OPTIONS) {
  const [descriptor] = await action.batchPlay(
    [currentToolOptionsDescriptor()],
    batchOptions
  );
  return normalizeBrushSettingsDescriptor(descriptor);
}

async function snapshotBrushOptionsRaw() {
  const [descriptor] = await action.batchPlay(
    [currentToolOptionsDescriptor()],
    READ_BATCHPLAY_OPTIONS
  );
  return { currentToolOptions: descriptor?.currentToolOptions ?? null };
}

function selectPaintbrushToolDescriptor() {
  return {
    _obj: 'select',
    _target: [{ _ref: 'paintbrushTool' }],
    _options: { dialogOptions: 'silent' },
  };
}

async function applyBrushSettingsModal(settings = {}) {
  await action.batchPlay([selectPaintbrushToolDescriptor()], { synchronousExecution: true });
  const [descriptor] = await action.batchPlay(
    [currentToolOptionsDescriptor()],
    { synchronousExecution: true }
  );
  const toolOptions = descriptor?.currentToolOptions
    ? JSON.parse(JSON.stringify(descriptor.currentToolOptions))
    : null;
  const brush = toolOptions?.brush;
  if (!toolOptions || typeof toolOptions !== 'object' || !brush || typeof brush !== 'object') {
    throw new Error('brush_settings_unavailable_for_write');
  }

  if (settings.size !== undefined) {
    brush.diameter = { _unit: 'pixelsUnit', _value: Number(settings.size) };
  }
  if (settings.hardness !== undefined) {
    // Photoshop's currentToolOptions brush descriptor exposes hardness as a
    // plain numeric value (the legacy Action Manager path also writes it as a
    // double, not a percentUnit). Supplying a unit object is accepted by
    // batchPlay but silently leaves the effective hardness unchanged.
    brush.hardness = Number(settings.hardness);
  }
  if (settings.angle !== undefined) {
    brush.angle = { _unit: 'angleUnit', _value: Number(settings.angle) };
  }
  if (settings.roundness !== undefined) {
    // Same representation rule as hardness: roundness is a plain numeric
    // value in currentToolOptions.
    brush.roundness = Number(settings.roundness);
  }
  if (settings.spacing !== undefined) {
    brush.spacing = { _unit: 'percentUnit', _value: Number(settings.spacing) };
  }
  if (settings.flip_x !== undefined) brush.flipX = Boolean(settings.flip_x);
  if (settings.flip_y !== undefined) brush.flipY = Boolean(settings.flip_y);

  if (settings.opacity !== undefined) toolOptions.opacity = Math.round(Number(settings.opacity));
  if (settings.flow !== undefined) toolOptions.flow = Math.round(Number(settings.flow));
  if (settings.use_pressure_size !== undefined) {
    toolOptions.usePressureOverridesSize = Boolean(settings.use_pressure_size);
  }
  if (settings.use_pressure_opacity !== undefined) {
    toolOptions.usePressureOverridesOpacity = Boolean(settings.use_pressure_opacity);
  }
  if (settings.airbrush !== undefined) toolOptions.repeat = Boolean(settings.airbrush);
  if (settings.smoothing_enabled !== undefined) {
    toolOptions.smoothing = Boolean(settings.smoothing_enabled);
  }
  if (settings.smoothing !== undefined) {
    const smoothing = Number(settings.smoothing);
    toolOptions.smooth = Math.round(smoothing);
    toolOptions.smoothingValue = smoothing;
  }

  await action.batchPlay(
    [{
      _obj: 'set',
      _target: [{ _ref: 'paintbrushTool' }],
      to: toolOptions,
      _options: { dialogOptions: 'silent' },
    }],
    { synchronousExecution: true }
  );
  return snapshotBrushSettings({ synchronousExecution: true });
}

async function writeBrushSettings(params = {}) {
  const settings = params.settings && typeof params.settings === 'object'
    ? params.settings
    : {};
  return core.executeAsModal(
    async () => applyBrushSettingsModal(settings),
    { commandName: 'MCP Set Brush' }
  );
}

async function selectBrushPreset(params = {}) {
  const name = String(params.name ?? '').trim();
  if (!name) throw new Error('name is required');
  return core.executeAsModal(
    async () => {
      await action.batchPlay(
        [
          {
            _obj: 'select',
            _target: [{ _ref: 'brush', _name: name }],
            _options: { dialogOptions: 'silent' },
          },
          selectPaintbrushToolDescriptor(),
        ],
        { synchronousExecution: true }
      );
      const current = await snapshotBrushSettings({ synchronousExecution: true });
      return { ok: true, preset: name, settings: current.settings };
    },
    { commandName: 'MCP Select Brush Preset' }
  );
}

async function writeForegroundColor(params = {}) {
  const red = Number(params.red);
  const green = Number(params.green);
  const blue = Number(params.blue);
  if (![red, green, blue].every(Number.isFinite)) {
    throw new Error('red, green and blue are required');
  }
  return core.executeAsModal(
    async () => {
      setForegroundColorModal({ red, green, blue });
      return { ok: true, red, green, blue };
    },
    { commandName: 'MCP Set Foreground Color' }
  );
}

function setForegroundColorModal(colorValue) {
  const color = new app.SolidColor();
  color.rgb.red = Number(colorValue.red);
  color.rgb.green = Number(colorValue.green);
  color.rgb.blue = Number(colorValue.blue);
  app.foregroundColor = color;
}

async function snapshotForegroundColor() {
  const [descriptor] = await action.batchPlay(
    [{
      _obj: 'get',
      _target: [
        { _property: 'foregroundColor' },
        { _ref: 'application', _enum: 'ordinal', _value: 'targetEnum' },
      ],
      _options: { dialogOptions: 'dontDisplay' },
    }],
    READ_BATCHPLAY_OPTIONS
  );
  const color = descriptor?.foregroundColor;
  if (!color || typeof color !== 'object') throw new Error('foreground_color_unavailable');
  return {
    red: Number(color.red),
    green: Number(color.grain ?? color.green),
    blue: Number(color.blue),
  };
}

function layerByIdDescriptor(layerId) {
  return {
    _obj: 'get',
    _target: [
      { _ref: 'layer', _id: layerId },
      { _ref: 'document', _enum: 'ordinal', _value: 'targetEnum' },
    ],
    _options: { dialogOptions: 'dontDisplay' },
  };
}

function selectLayerByIdDescriptor(layerId) {
  return {
    _obj: 'select',
    _target: [{ _ref: 'layer', _id: layerId }],
    makeVisible: false,
    _options: { dialogOptions: 'silent' },
  };
}

async function selectLayerByNameMutation(params = {}) {
  const name = typeof params.name === 'string' ? params.name.trim() : '';
  if (!name) throw new Error('name is required');
  return core.executeAsModal(
    async () => {
      const prepared = await prepareLayerMutation(params, 'select_layer_by_name');
      const layer = findLayerByNameDom(prepared.doc, name);
      if (!layer) throw new Error(`Layer not found: ${name}`);
      await action.batchPlay([selectLayerByIdDescriptor(layer.id)], { synchronousExecution: true });
      const context = normalizeSessionState(await readSessionDescriptors({ synchronousExecution: true }));
      const result = {
        selected: true,
        layerName: layer.name,
        layerId: layer.id,
        path: layerPathDom(layer),
        typename: layer.kind === constants.LayerKind.GROUP ? 'LayerSet' : 'ArtLayer',
        kind: layer.kind === constants.LayerKind.GROUP ? 'LayerSet' : String(layer.kind),
        context,
      };
      try {
        const bounds = layer.bounds;
        if (bounds) {
          const left = Number(bounds.left ?? bounds._left ?? 0);
          const top = Number(bounds.top ?? bounds._top ?? 0);
          const right = Number(bounds.right ?? bounds._right ?? 0);
          const bottom = Number(bounds.bottom ?? bounds._bottom ?? 0);
          if ([left, top, right, bottom].every(Number.isFinite)) {
            result.bounds = {
              left,
              top,
              right,
              bottom,
              width: right - left,
              height: bottom - top,
            };
          }
        }
      } catch {}
      return result;
    },
    { commandName: 'MCP Select Layer By Name' }
  );
}

async function undoMutation(params = {}) {
  const steps = Number.isInteger(params.steps) && params.steps > 0 ? params.steps : 1;
  return core.executeAsModal(
    async () => {
      await prepareLayerMutation(params, 'undo');
      for (let i = 0; i < steps; i++) {
        await action.batchPlay(
          [{
            _obj: 'select',
            _target: [{ _ref: 'historyState', _offset: -1 }],
            _options: { dialogOptions: 'silent' },
          }],
          { synchronousExecution: true }
        );
      }
      return {
        undone: true,
        steps,
        context: normalizeSessionState(await readSessionDescriptors({ synchronousExecution: true })),
      };
    },
    { commandName: 'MCP Undo' }
  );
}

async function activeLayerHasUserMask(batchOptions = READ_BATCHPLAY_OPTIONS) {
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
      batchOptions
    );
    return descriptor?.userMaskEnabled !== undefined;
  } catch {
    return false;
  }
}

async function createLayerMaskInCurrentModal() {
  const modalReadOptions = { synchronousExecution: true };
  if (await activeLayerHasUserMask(modalReadOptions)) {
    return {
      maskCreated: false,
      fromSelection: false,
      message: 'Layer already has a mask',
    };
  }
  const selection = await snapshotSelectionBounds(modalReadOptions);
  const hasSelection = selection?.has_selection === true;
  await action.batchPlay(
    [{
      _obj: 'make',
      new: { _class: 'channel' },
      at: { _ref: 'channel', _enum: 'channel', _value: 'mask' },
      using: {
        _enum: 'userMaskEnabled',
        _value: hasSelection ? 'revealSelection' : 'revealAll',
      },
      _options: { dialogOptions: 'silent' },
    }],
    { synchronousExecution: true }
  );
  return { maskCreated: true, fromSelection: hasSelection };
}

async function createLayerMaskMutation(params = {}) {
  return core.executeAsModal(
    async () => {
      await prepareLayerMutation(params, 'create_layer_mask');
      return createLayerMaskInCurrentModal();
    },
    { commandName: 'MCP Create Layer Mask' }
  );
}

function gradientMaskEndpoints(direction, startPct, endPct) {
  if (direction === 'top_to_bottom') return { fromH: 50, fromV: startPct, toH: 50, toV: endPct };
  if (direction === 'left_to_right') return { fromH: startPct, fromV: 50, toH: endPct, toV: 50 };
  if (direction === 'right_to_left') return { fromH: endPct, fromV: 50, toH: startPct, toV: 50 };
  return { fromH: 50, fromV: endPct, toH: 50, toV: startPct };
}

async function applyGradientMaskMutation(params = {}) {
  const direction = ['top_to_bottom', 'bottom_to_top', 'left_to_right', 'right_to_left'].includes(params.direction)
    ? params.direction
    : 'bottom_to_top';
  const startPct = Number.isFinite(Number(params.start_pct)) ? Number(params.start_pct) : 0;
  const endPct = Number.isFinite(Number(params.end_pct)) ? Number(params.end_pct) : 100;
  const angle = Number.isFinite(Number(params.angle_deg))
    ? Number(params.angle_deg)
    : direction === 'left_to_right' || direction === 'right_to_left' ? 0 : 90;
  return core.executeAsModal(
    async () => {
      const prepared = await prepareLayerMutation(params, 'apply_gradient_mask');
      let maskAutoCreated = false;
      if (!(await activeLayerHasUserMask({ synchronousExecution: true }))) {
        const created = await createLayerMaskInCurrentModal();
        maskAutoCreated = created?.maskCreated === true;
      }
      const doc = prepared.doc;
      const width = Number(doc.width);
      const height = Number(doc.height);
      const endpoints = gradientMaskEndpoints(direction, startPct, endPct);
      const fromX = width * endpoints.fromH / 100;
      const fromY = height * endpoints.fromV / 100;
      const toX = width * endpoints.toH / 100;
      const toY = height * endpoints.toV / 100;
      await action.batchPlay(
        [{
          _obj: 'select',
          _target: [{ _ref: 'channel', _enum: 'ordinal', _value: 'targetEnum' }],
          makeVisible: true,
          _options: { dialogOptions: 'silent' },
        }],
        { synchronousExecution: true }
      );
      await action.batchPlay(
        [{
          _obj: 'gradientClassEvent',
          from: { _obj: 'paint', horizontal: { _unit: 'pixelsUnit', _value: fromX }, vertical: { _unit: 'pixelsUnit', _value: fromY } },
          to: { _obj: 'paint', horizontal: { _unit: 'pixelsUnit', _value: toX }, vertical: { _unit: 'pixelsUnit', _value: toY } },
          type: { _enum: 'gradientType', _value: 'linear' },
          dither: true,
          useMask: true,
          reverse: false,
          gradient: {
            _obj: 'gradientClassEvent',
            name: 'Black, White',
            gradientForm: { _enum: 'gradientForm', _value: 'customStops' },
            interfaceIconFrameDimmed: 4096,
            colors: [
              { _obj: 'colorStop', color: { _obj: 'grayscale', gray: { _unit: 'percentUnit', _value: 100 } }, type: { _enum: 'colorStopType', _value: 'userStop' }, location: 0, midpoint: 50 },
              { _obj: 'colorStop', color: { _obj: 'grayscale', gray: { _unit: 'percentUnit', _value: 0 } }, type: { _enum: 'colorStopType', _value: 'userStop' }, location: 4096, midpoint: 50 },
            ],
            transparency: [
              { _obj: 'transferSpec', opacity: { _unit: 'percentUnit', _value: 100 }, location: 0, midpoint: 50 },
              { _obj: 'transferSpec', opacity: { _unit: 'percentUnit', _value: 100 }, location: 4096, midpoint: 50 },
            ],
          },
          _options: { dialogOptions: 'silent' },
        }],
        { synchronousExecution: true }
      );
      return { applied: true, direction, angle, mask_auto_created: maskAutoCreated };
    },
    { commandName: 'MCP Apply Gradient Mask' }
  );
}

async function selectShapeMutation(params = {}, shape = 'rectangle') {
  const left = Number(params.left);
  const top = Number(params.top);
  const right = Number(params.right);
  const bottom = Number(params.bottom);
  if (![left, top, right, bottom].every(Number.isFinite) || right <= left || bottom <= top) {
    throw new Error(`Invalid ${shape} bounds`);
  }
  return core.executeAsModal(
    async () => {
      await prepareLayerMutation(params, `select_${shape}`);
      await action.batchPlay(
        [{
          _obj: 'set',
          _target: [{ _ref: 'channel', _property: 'selection' }],
          to: {
            _obj: shape,
            top: { _unit: 'pixelsUnit', _value: top },
            left: { _unit: 'pixelsUnit', _value: left },
            bottom: { _unit: 'pixelsUnit', _value: bottom },
            right: { _unit: 'pixelsUnit', _value: right },
          },
          feather: { _unit: 'pixelsUnit', _value: 0 },
          antiAlias: true,
          _options: { dialogOptions: 'silent' },
        }],
        { synchronousExecution: true }
      );
      const selection = await snapshotSelectionBounds({ synchronousExecution: true });
      return {
        shape,
        bounds: selection?.bounds ?? { left, top, right, bottom },
        context: normalizeSessionState(await readSessionDescriptors({ synchronousExecution: true })),
      };
    },
    { commandName: shape === 'ellipse' ? 'MCP Select Ellipse' : 'MCP Select Rectangle' }
  );
}

async function featherSelectionMutation(params = {}) {
  const pixels = Number(params.pixels);
  if (!Number.isFinite(pixels) || pixels < 1) throw new Error('pixels must be a finite number >= 1');
  return core.executeAsModal(
    async () => {
      await prepareLayerMutation(params, 'feather_selection');
      await action.batchPlay(
        [{
          _obj: 'feather',
          radius: { _unit: 'pixelsUnit', _value: pixels },
          _options: { dialogOptions: 'silent' },
        }],
        { synchronousExecution: true }
      );
      const selection = await snapshotSelectionBounds({ synchronousExecution: true });
      return {
        pixels,
        ...(selection?.bounds ? { bounds: selection.bounds } : {}),
        context: normalizeSessionState(await readSessionDescriptors({ synchronousExecution: true })),
      };
    },
    { commandName: 'MCP Feather Selection' }
  );
}

async function selectSubjectMutation(params = {}) {
  return core.executeAsModal(
    async () => {
      await prepareLayerMutation(params, 'select_subject');
      await action.batchPlay(
        [{
          _obj: 'autoCutout',
          sampleAllLayers: params.sample_all_layers === true,
          _options: { dialogOptions: 'silent' },
        }],
        { synchronousExecution: true }
      );
      const selection = await snapshotSelectionBounds({ synchronousExecution: true });
      return {
        method: 'selectSubject',
        sample_all_layers: params.sample_all_layers === true,
        ...(selection?.bounds ? { bounds: selection.bounds } : {}),
        context: normalizeSessionState(await readSessionDescriptors({ synchronousExecution: true })),
      };
    },
    { commandName: 'MCP Select Subject' }
  );
}

async function prepareLayerMutation(params = {}, operationName = 'layer mutation') {
  const requestedDocumentId =
    Number.isInteger(params.document_id) && params.document_id > 0
      ? params.document_id
      : null;
  const sessionDescriptors = await readSessionDescriptors({ synchronousExecution: true });
  if (sessionDescriptors.documentCount <= 0) throw new Error('No active document');
  const activeDocumentId = numericValue(sessionDescriptors.documentDescriptor?.documentID);
  if (requestedDocumentId != null && activeDocumentId !== requestedDocumentId) {
    const openIds = Array.from(app.documents ?? []).map((doc) => doc.id);
    if (!openIds.includes(requestedDocumentId)) {
      throw new Error(`document_not_found: no open document with id ${requestedDocumentId}`);
    }
    throw new Error(
      `document_not_active: pinned document ${requestedDocumentId} is open but not active; active document was not changed`
    );
  }
  const doc = app.activeDocument;
  const originalActiveLayer = Array.from(doc.activeLayers ?? [])[0] ?? null;
  return {
    doc,
    sessionDescriptors,
    activeDocumentId,
    originalActiveLayer,
    originalActiveLayerId: originalActiveLayer?.id ?? null,
    operationName,
  };
}

function findLayerByIdDom(container, layerId) {
  const layers = Array.from(container?.layers ?? []);
  for (const layer of layers) {
    if (layer?.id === layerId) return layer;
    const nested = findLayerByIdDom(layer, layerId);
    if (nested) return nested;
  }
  return null;
}

function findLayerByNameDom(container, layerName) {
  const layers = Array.from(container?.layers ?? []);
  for (const layer of layers) {
    if (layer?.name === layerName) return layer;
    const nested = findLayerByNameDom(layer, layerName);
    if (nested) return nested;
  }
  return null;
}

function layerPathDom(layer) {
  if (!layer) return '';
  const parts = [String(layer.name ?? '')];
  let parent = layer.parent ?? null;
  while (parent) {
    parts.unshift(String(parent.name ?? ''));
    parent = parent.parent ?? null;
  }
  return parts.filter(Boolean).join('/');
}

function parentLayerStack(doc, layer) {
  return Array.from(layer?.parent?.layers ?? doc.layers ?? []);
}

function parentLayerName(layer) {
  return layer?.parent?.kind === constants.LayerKind.GROUP ? layer.parent.name : null;
}

function requireActiveLayerTarget(prepared, operationName) {
  const layerId = prepared.originalActiveLayerId;
  if (!Number.isInteger(layerId) || layerId <= 0) {
    throw new Error(`${operationName}: No active layer`);
  }
  const layer = findLayerByIdDom(prepared.doc, layerId);
  if (!layer) throw new Error(`${operationName}: active layer ${layerId} not found`);
  return layer;
}

async function createLayerMutation(params = {}) {
  const aboveLayerId = Number.isInteger(params.above_layer_id) && params.above_layer_id > 0
    ? params.above_layer_id
    : null;
  const belowLayerId = Number.isInteger(params.below_layer_id) && params.below_layer_id > 0
    ? params.below_layer_id
    : null;
  if (aboveLayerId != null && belowLayerId != null) {
    throw new Error('Provide only one of above_layer_id or below_layer_id');
  }
  return core.executeAsModal(
    async () => {
      const prepared = await prepareLayerMutation(params, 'create_layer');
      const { doc, originalActiveLayerId } = prepared;
      const explicitTargetId = aboveLayerId ?? belowLayerId;
      const targetId = explicitTargetId ?? originalActiveLayerId;
      const targetLayer = targetId != null ? findLayerByIdDom(doc, targetId) : null;
      if (explicitTargetId != null && !targetLayer) {
        throw new Error(`Layer not found: id=${explicitTargetId}`);
      }
      const requestedPlacement = aboveLayerId != null
        ? 'ABOVE'
        : belowLayerId != null
          ? 'BELOW'
          : targetLayer
            ? 'ABOVE_ACTIVE'
            : null;
      const relativeToId = targetLayer?.id ?? null;
      const relativeToPath = targetLayer ? layerPathDom(targetLayer) : null;
      const options = typeof params.name === 'string' ? { name: params.name } : {};
      const layer = await doc.createLayer(constants.LayerKind.NORMAL, options);
      if (targetLayer && targetLayer.id !== layer.id) {
        layer.move(
          targetLayer,
          requestedPlacement === 'BELOW'
            ? constants.ElementPlacement.PLACEAFTER
            : constants.ElementPlacement.PLACEBEFORE
        );
      }
      await action.batchPlay(
        [selectLayerByIdDescriptor(layer.id)],
        { synchronousExecution: true }
      );
      const stack = parentLayerStack(doc, layer);
      const actualIndex = stack.findIndex((entry) => entry?.id === layer.id);
      const aboveNeighbor = actualIndex > 0 ? stack[actualIndex - 1] : null;
      const belowNeighbor = actualIndex >= 0 && actualIndex < stack.length - 1
        ? stack[actualIndex + 1]
        : null;
      const context = normalizeSessionState(
        await readSessionDescriptors({ synchronousExecution: true })
      );
      const result = {
        created: true,
        layerName: layer.name,
        path: layerPathDom(layer),
        requestedPlacement,
        actualIndex,
        aboveLayerId: aboveNeighbor?.id ?? null,
        belowLayerId: belowNeighbor?.id ?? null,
        context,
        layerId: layer.id,
      };
      if (layer.parent) result.parentPath = layerPathDom(layer.parent);
      else result.parentPath = '';
      if (targetLayer) {
        result.relativeToId = relativeToId;
        result.relativeToPath = relativeToPath;
      }
      return result;
    },
    { commandName: 'MCP Create Layer' }
  );
}

async function deleteLayerMutation(params = {}) {
  const requestedLayerId =
    Number.isInteger(params.layer_id) && params.layer_id > 0 ? params.layer_id : null;
  return core.executeAsModal(
    async () => {
      const prepared = await prepareLayerMutation(params, 'delete_layer');
      const { doc, originalActiveLayerId } = prepared;
      const targetLayerId = requestedLayerId ?? originalActiveLayerId;
      if (!Number.isInteger(targetLayerId) || targetLayerId <= 0) throw new Error('No active layer');
      const layer = findLayerByIdDom(doc, targetLayerId);
      if (!layer) {
        throw new Error(
          requestedLayerId != null
            ? `Target layer id not found: ${requestedLayerId}`
            : 'No active layer'
        );
      }
      const deletedName = layer.name;
      const deletedId = layer.id;
      const deletedPath = layerPathDom(layer);
      const deletingOriginalActive = originalActiveLayerId === targetLayerId;
      await action.batchPlay(
        [{
          _obj: 'delete',
          _target: [{ _ref: 'layer', _id: targetLayerId }],
          _options: { dialogOptions: 'silent' },
        }],
        { synchronousExecution: true }
      );
      if (!deletingOriginalActive && originalActiveLayerId != null) {
        const originalStillExists = findLayerByIdDom(doc, originalActiveLayerId);
        if (originalStillExists) {
          await action.batchPlay(
            [selectLayerByIdDescriptor(originalActiveLayerId)],
            { synchronousExecution: true }
          );
        }
      }
      const context = normalizeSessionState(
        await readSessionDescriptors({ synchronousExecution: true })
      );
      return {
        deleted: true,
        layerName: deletedName,
        layerId: deletedId,
        path: deletedPath,
        requestedLayerId,
        originalActiveLayerId,
        activeLayerRestored: !deletingOriginalActive,
        context,
      };
    },
    { commandName: 'MCP Delete Layer' }
  );
}

async function setLayerOpacityMutation(params = {}) {
  const opacity = Number(params.opacity);
  if (!Number.isFinite(opacity) || opacity < 0 || opacity > 100) throw new Error('Invalid opacity');
  return core.executeAsModal(
    async () => {
      const prepared = await prepareLayerMutation(params, 'set_layer_opacity');
      const layer = requireActiveLayerTarget(prepared, 'set_layer_opacity');
      layer.opacity = opacity;
      return {
        updated: true,
        property: 'opacity',
        value: layer.opacity,
        layerName: layer.name,
        context: normalizeSessionState(await readSessionDescriptors({ synchronousExecution: true })),
      };
    },
    { commandName: 'MCP Set Layer Opacity' }
  );
}

async function setLayerBlendModeMutation(params = {}) {
  const requested = String(params.blendMode ?? '').trim().toUpperCase();
  const blendMode = constants.BlendMode?.[requested];
  if (blendMode == null) throw new Error(`Invalid enumeration value: BlendMode.${requested}`);
  return core.executeAsModal(
    async () => {
      const prepared = await prepareLayerMutation(params, 'set_layer_blend_mode');
      const layer = requireActiveLayerTarget(prepared, 'set_layer_blend_mode');
      layer.blendMode = blendMode;
      return {
        updated: true,
        property: 'blendMode',
        value: String(layer.blendMode),
        layerName: layer.name,
        context: normalizeSessionState(await readSessionDescriptors({ synchronousExecution: true })),
      };
    },
    { commandName: 'MCP Set Layer Blend Mode' }
  );
}

async function setLayerVisibilityMutation(params = {}) {
  if (typeof params.visible !== 'boolean') throw new Error('visible must be boolean');
  return core.executeAsModal(
    async () => {
      const prepared = await prepareLayerMutation(params, 'set_layer_visibility');
      const layer = requireActiveLayerTarget(prepared, 'set_layer_visibility');
      layer.visible = params.visible;
      return { visible: layer.visible, name: layer.name };
    },
    { commandName: 'MCP Set Layer Visibility' }
  );
}

async function setLayerLockedMutation(params = {}) {
  if (typeof params.locked !== 'boolean') throw new Error('locked must be boolean');
  return core.executeAsModal(
    async () => {
      const prepared = await prepareLayerMutation(params, 'set_layer_locked');
      const layer = requireActiveLayerTarget(prepared, 'set_layer_locked');
      layer.allLocked = params.locked;
      return { locked: layer.allLocked, name: layer.name };
    },
    { commandName: 'MCP Set Layer Locked' }
  );
}

async function renameLayerMutation(params = {}) {
  if (typeof params.name !== 'string') throw new Error('name is required');
  return core.executeAsModal(
    async () => {
      const prepared = await prepareLayerMutation(params, 'rename_layer');
      const layer = requireActiveLayerTarget(prepared, 'rename_layer');
      const oldName = layer.name;
      layer.name = params.name;
      return { oldName, newName: layer.name };
    },
    { commandName: 'MCP Rename Layer' }
  );
}

async function duplicateLayerMutation(params = {}) {
  return core.executeAsModal(
    async () => {
      const prepared = await prepareLayerMutation(params, 'duplicate_layer');
      const layer = requireActiveLayerTarget(prepared, 'duplicate_layer');
      const originalName = layer.name;
      const duplicated = await layer.duplicate();
      if (typeof params.newName === 'string') duplicated.name = params.newName;
      await action.batchPlay(
        [selectLayerByIdDescriptor(duplicated.id)],
        { synchronousExecution: true }
      );
      return {
        originalName,
        newName: duplicated.name,
        activated: true,
        newLayerId: duplicated.id,
      };
    },
    { commandName: 'MCP Duplicate Layer' }
  );
}

async function moveLayerMutation(params = {}) {
  const requestedPosition = String(params.position ?? '').trim().toUpperCase();
  if (!['ABOVE', 'BELOW', 'TOP', 'BOTTOM', 'UP', 'DOWN'].includes(requestedPosition)) {
    throw new Error('Invalid position. Use: ABOVE, BELOW, TOP, BOTTOM, UP, or DOWN');
  }
  const requestedTargetId =
    Number.isInteger(params.targetLayerId) ? params.targetLayerId : null;
  const requestedTargetName =
    typeof params.targetLayerName === 'string' && params.targetLayerName.trim()
      ? params.targetLayerName.trim()
      : null;
  if ((requestedPosition === 'ABOVE' || requestedPosition === 'BELOW') &&
      requestedTargetId == null && requestedTargetName == null) {
    throw new Error('Invalid arguments: ABOVE/BELOW requires targetLayerId or targetLayerName');
  }

  return core.executeAsModal(
    async () => {
      const prepared = await prepareLayerMutation(params, 'move_layer');
      const { doc } = prepared;
      const layer = requireActiveLayerTarget(prepared, 'move_layer');
      const stack = parentLayerStack(doc, layer);
      const currentIndex = stack.findIndex((entry) => entry?.id === layer.id);
      let targetLayer = null;

      if (requestedPosition === 'TOP') {
        if (currentIndex > 0) layer.move(stack[0], constants.ElementPlacement.PLACEBEFORE);
        return {
          moved: true,
          layerName: layer.name,
          layerId: layer.id,
          parentName: parentLayerName(layer),
          position: 'top',
          context: normalizeSessionState(await readSessionDescriptors({ synchronousExecution: true })),
        };
      }

      if (requestedPosition === 'BOTTOM') {
        if (layer.isBackgroundLayer) throw new Error('Cannot move background layer');
        if (currentIndex >= 0 && currentIndex < stack.length - 1) {
          const bottomLayer = stack[stack.length - 1];
          layer.move(
            bottomLayer,
            bottomLayer?.isBackgroundLayer
              ? constants.ElementPlacement.PLACEBEFORE
              : constants.ElementPlacement.PLACEAFTER
          );
        }
        return {
          moved: true,
          layerName: layer.name,
          layerId: layer.id,
          parentName: parentLayerName(layer),
          position: 'bottom',
          context: normalizeSessionState(await readSessionDescriptors({ synchronousExecution: true })),
        };
      }

      if (requestedPosition === 'UP') {
        if (currentIndex <= 0) {
          return {
            moved: false,
            message: 'Layer is already at the top',
            context: normalizeSessionState(await readSessionDescriptors({ synchronousExecution: true })),
          };
        }
        layer.move(stack[currentIndex - 1], constants.ElementPlacement.PLACEBEFORE);
        return {
          moved: true,
          layerName: layer.name,
          parentName: parentLayerName(layer),
          direction: 'up',
          context: normalizeSessionState(await readSessionDescriptors({ synchronousExecution: true })),
        };
      }

      if (requestedPosition === 'DOWN') {
        if (currentIndex < 0 || currentIndex >= stack.length - 1) {
          return {
            moved: false,
            message: 'Layer is already at the bottom',
            context: normalizeSessionState(await readSessionDescriptors({ synchronousExecution: true })),
          };
        }
        const below = stack[currentIndex + 1];
        layer.move(below, constants.ElementPlacement.PLACEAFTER);
        return {
          moved: true,
          layerName: layer.name,
          parentName: parentLayerName(layer),
          direction: 'down',
          context: normalizeSessionState(await readSessionDescriptors({ synchronousExecution: true })),
        };
      }

      targetLayer = requestedTargetId != null
        ? findLayerByIdDom(doc, requestedTargetId)
        : findLayerByNameDom(doc, requestedTargetName);
      if (!targetLayer) {
        throw new Error(
          'Layer not found: ' +
          (requestedTargetId != null ? `id=${requestedTargetId}` : requestedTargetName)
        );
      }
      if (targetLayer.id === layer.id) {
        throw new Error('Invalid arguments: active layer cannot be moved relative to itself');
      }
      layer.move(
        targetLayer,
        requestedPosition === 'ABOVE'
          ? constants.ElementPlacement.PLACEBEFORE
          : constants.ElementPlacement.PLACEAFTER
      );
      return {
        moved: true,
        layerName: layer.name,
        layerId: layer.id,
        position: requestedPosition,
        context: normalizeSessionState(await readSessionDescriptors({ synchronousExecution: true })),
        relativeTo: targetLayer.name,
        relativeToId: targetLayer.id,
        relativeToPath: layerPathDom(targetLayer),
      };
    },
    { commandName: 'MCP Move Layer' }
  );
}

function fillLayerLockState(descriptor) {
  const locking = descriptor?.layerLocking;
  return Boolean(
    locking && typeof locking === 'object'
      ? locking.protectAll ?? locking.allLocked
      : descriptor?.allLocked ?? descriptor?.locked
  );
}

async function fillLayer(params = {}) {
  const red = Number(params.red);
  const green = Number(params.green);
  const blue = Number(params.blue);
  if (![red, green, blue].every(Number.isFinite)) {
    throw new Error('red, green and blue are required');
  }

  const requestedDocumentId =
    Number.isInteger(params.document_id) && params.document_id > 0
      ? params.document_id
      : null;
  const requestedLayerId =
    Number.isInteger(params.layer_id) && params.layer_id > 0
      ? params.layer_id
      : null;

  const sessionDescriptors = await readSessionDescriptors();
  if (sessionDescriptors.documentCount <= 0) throw new Error('No active document');
  const activeDocumentId = numericValue(sessionDescriptors.documentDescriptor?.documentID);
  if (requestedDocumentId != null && activeDocumentId !== requestedDocumentId) {
    const openIds = Array.from(app.documents ?? []).map((doc) => doc.id);
    if (!openIds.includes(requestedDocumentId)) {
      throw new Error(`document_not_found: no open document with id ${requestedDocumentId}`);
    }
    throw new Error(
      `document_not_active: pinned document ${requestedDocumentId} is open but not active; active document was not changed`
    );
  }

  const doc = app.activeDocument;
  const originalActiveLayer = Array.from(doc.activeLayers ?? [])[0] ?? null;
  const originalActiveLayerId = originalActiveLayer?.id ?? null;
  const targetLayerId = requestedLayerId ?? originalActiveLayerId;
  if (!Number.isInteger(targetLayerId) || targetLayerId <= 0) {
    throw new Error('No active layer');
  }

  const [targetDescriptor] = await action.batchPlay(
    [layerByIdDescriptor(targetLayerId)],
    READ_BATCHPLAY_OPTIONS
  );
  if (!targetDescriptor || targetDescriptor._obj === 'error') {
    throw new Error(`Fill target layer not found: ${targetLayerId}`);
  }
  if (layerSectionValue(targetDescriptor) === 'layerSectionStart') {
    throw new Error('Cannot fill a LayerSet; target must be an ArtLayer');
  }
  if (fillLayerLockState(targetDescriptor)) {
    throw new Error(
      `Cannot fill a fully locked layer: ${String(targetDescriptor.name ?? targetLayerId)}`
    );
  }
  if (legacyLayerKind(targetDescriptor) === 'LayerKind.TEXT') {
    throw new Error('Cannot fill a text layer. Rasterize it first.');
  }

  const hadSelection =
    Object.prototype.hasOwnProperty.call(sessionDescriptors.documentDescriptor ?? {}, 'selection') &&
    sessionDescriptors.documentDescriptor?.selection != null;

  return core.executeAsModal(
    async () => {
      let selectedAll = false;
      try {
        if (originalActiveLayerId !== targetLayerId) {
          await action.batchPlay(
            [selectLayerByIdDescriptor(targetLayerId)],
            { synchronousExecution: true }
          );
        }
        if (!hadSelection) {
          await doc.selection.selectAll();
          selectedAll = true;
        }
        await action.batchPlay(
          [{
            _obj: 'fill',
            using: { _enum: 'fillContents', _value: 'color' },
            color: { _obj: 'RGBColor', red, green, blue },
            opacity: { _unit: 'percentUnit', _value: 100 },
            mode: { _enum: 'blendMode', _value: 'normal' },
            _options: { dialogOptions: 'silent' },
          }],
          { synchronousExecution: true }
        );
        if (selectedAll) {
          await doc.selection.deselect();
          selectedAll = false;
        }
        const context = normalizeSessionState(
          await readSessionDescriptors({ synchronousExecution: true })
        );
        return {
          filled: true,
          layerName: String(targetDescriptor.name ?? ''),
          layerId: targetLayerId,
          color: { red, green, blue },
          context,
        };
      } finally {
        if (selectedAll) {
          try { await doc.selection.deselect(); } catch {}
        }
        if (
          originalActiveLayerId != null &&
          originalActiveLayerId !== targetLayerId
        ) {
          try {
            await action.batchPlay(
              [selectLayerByIdDescriptor(originalActiveLayerId)],
              { synchronousExecution: true }
            );
          } catch {}
        }
      }
    },
    { commandName: 'MCP Fill Layer' }
  );
}

function assertCanvasPoint(point, label, width, height, clipBounds) {
  const checks = [
    ['anchor', Number(point.x), Number(point.y)],
    ...(Array.isArray(point.left) ? [['left', Number(point.left[0]), Number(point.left[1])]] : []),
    ...(Array.isArray(point.right) ? [['right', Number(point.right[0]), Number(point.right[1])]] : []),
  ];
  for (const [suffix, x, y] of checks) {
    if (![x, y].every(Number.isFinite) || x < 0 || x > width || y < 0 || y > height) {
      throw new Error(`${label}.${suffix} lies outside document canvas`);
    }
    if (
      clipBounds &&
      (x < clipBounds.left || x > clipBounds.right || y < clipBounds.top || y > clipBounds.bottom)
    ) {
      throw new Error(`${label}.${suffix} lies outside clip_bounds`);
    }
  }
}

function makeUxpPathPoint(point) {
  const pathPoint = new app.PathPointInfo();
  pathPoint.kind = point.smooth
    ? constants.PointKind.SMOOTHPOINT
    : constants.PointKind.CORNERPOINT;
  pathPoint.anchor = [Number(point.x), Number(point.y)];
  pathPoint.leftDirection = Array.isArray(point.left)
    ? [Number(point.left[0]), Number(point.left[1])]
    : [Number(point.x), Number(point.y)];
  pathPoint.rightDirection = Array.isArray(point.right)
    ? [Number(point.right[0]), Number(point.right[1])]
    : [Number(point.x), Number(point.y)];
  return pathPoint;
}

function makeUxpRegionSubPath(contour) {
  const subPath = new app.SubPathInfo();
  subPath.closed = true;
  subPath.operation =
    contour.operation === 'SUBTRACT'
      ? constants.ShapeOperation.SHAPESUBTRACT
      : constants.ShapeOperation.SHAPEADD;
  subPath.entireSubPath = contour.points.map(makeUxpPathPoint);
  return subPath;
}

function validatePaintTargetDescriptor(descriptor, toolName) {
  if (!descriptor || descriptor._obj === 'error') {
    throw new Error(`${toolName} target layer not found`);
  }
  if (layerSectionValue(descriptor) === 'layerSectionStart') {
    throw new Error(`${toolName} target must be an ArtLayer, not a LayerSet`);
  }
  if (legacyLayerKind(descriptor) !== 'LayerKind.NORMAL') {
    throw new Error(
      `${toolName} target must be a normal raster ArtLayer: ${String(descriptor.name ?? '')}`
    );
  }
  if (fillLayerLockState(descriptor)) {
    throw new Error(`${toolName} target layer is locked: ${String(descriptor.name ?? '')}`);
  }
}

async function preparePaintTarget(params, toolName) {
  const requestedDocumentId =
    Number.isInteger(params.document_id) && params.document_id > 0
      ? params.document_id
      : null;
  const requestedLayerId =
    Number.isInteger(params.layer_id) && params.layer_id > 0
      ? params.layer_id
      : null;
  const descriptors = await readSessionDescriptors();
  if (descriptors.documentCount <= 0) throw new Error('No active document');
  const activeDocumentId = numericValue(descriptors.documentDescriptor?.documentID);
  if (requestedDocumentId != null && activeDocumentId !== requestedDocumentId) {
    const openIds = Array.from(app.documents ?? []).map((doc) => doc.id);
    if (!openIds.includes(requestedDocumentId)) {
      throw new Error(`document_not_found: no open document with id ${requestedDocumentId}`);
    }
    throw new Error(
      `document_not_active: pinned document ${requestedDocumentId} is open but not active; active document was not changed`
    );
  }
  const doc = app.activeDocument;
  const originalLayer = Array.from(doc.activeLayers ?? [])[0] ?? null;
  const originalLayerId = originalLayer?.id ?? null;
  const targetLayerId = requestedLayerId ?? originalLayerId;
  if (!Number.isInteger(targetLayerId) || targetLayerId <= 0) {
    throw new Error(`${toolName} requires an active layer`);
  }
  const [targetDescriptor] = await action.batchPlay(
    [layerByIdDescriptor(targetLayerId)],
    READ_BATCHPLAY_OPTIONS
  );
  if (!targetDescriptor || targetDescriptor._obj === 'error') {
    throw new Error(`${toolName} target layer not found: ${targetLayerId}`);
  }
  validatePaintTargetDescriptor(targetDescriptor, toolName);
  return {
    doc,
    targetLayerId,
    targetDescriptor,
    originalLayerId,
    resolution: numericValue(descriptors.documentDescriptor?.resolution) ?? 72,
  };
}

function samePaintColor(a, b) {
  return Boolean(
    a && b &&
    Number(a.red) === Number(b.red) &&
    Number(a.green) === Number(b.green) &&
    Number(a.blue) === Number(b.blue)
  );
}

function currentForegroundRgb() {
  const rgb = app.foregroundColor?.rgb;
  return {
    red: Number(rgb?.red ?? 0),
    green: Number(rgb?.green ?? 0),
    blue: Number(rgb?.blue ?? 0),
  };
}

function makeUxpStrokeSubPath(stroke) {
  const points = (Array.isArray(stroke.points) ? stroke.points : []).map(makeUxpPathPoint);
  if (points.length === 1) {
    const src = stroke.points[0];
    const duplicate = new app.PathPointInfo();
    duplicate.kind = constants.PointKind.CORNERPOINT;
    duplicate.anchor = [Number(src.x), Number(src.y)];
    duplicate.leftDirection = [Number(src.x), Number(src.y)];
    duplicate.rightDirection = [Number(src.x), Number(src.y)];
    points.push(duplicate);
  }
  const subPath = new app.SubPathInfo();
  subPath.closed = Boolean(stroke.closed);
  subPath.operation = constants.ShapeOperation.SHAPEADD;
  subPath.entireSubPath = points;
  return subPath;
}

function makeUxpDabSubPath(point) {
  const makePoint = () => {
    const pathPoint = new app.PathPointInfo();
    pathPoint.kind = constants.PointKind.CORNERPOINT;
    pathPoint.anchor = [Number(point.x), Number(point.y)];
    pathPoint.leftDirection = [Number(point.x), Number(point.y)];
    pathPoint.rightDirection = [Number(point.x), Number(point.y)];
    return pathPoint;
  };
  const subPath = new app.SubPathInfo();
  subPath.closed = false;
  subPath.operation = constants.ShapeOperation.SHAPEADD;
  subPath.entireSubPath = [makePoint(), makePoint()];
  return subPath;
}

async function deleteNamedPathModal(pathName) {
  try {
    await action.batchPlay(
      [{
        _obj: 'delete',
        _target: [{ _ref: 'path', _name: pathName }],
        _options: { dialogOptions: 'silent' },
      }],
      { synchronousExecution: true }
    );
  } catch {}
}

async function strokeNamedPathModal(doc, pathName, tool, simulatePressure) {
  const pathItem = doc.pathItems.getByName(pathName);
  if (!pathItem || typeof pathItem.strokePath !== 'function') {
    throw new Error('uxp_path_stroke_method_unavailable');
  }
  await pathItem.strokePath(tool, Boolean(simulatePressure));
}

async function paintStrokesBatch(params = {}) {
  const strokes = Array.isArray(params.strokes) ? params.strokes : [];
  if (strokes.length < 1) throw new Error('strokes must be a non-empty array');
  const target = await preparePaintTarget(params, 'paint_strokes');
  const { doc, targetLayerId, targetDescriptor, originalLayerId, resolution } = target;
  return core.executeAsModal(
    async (executionContext) => {
      const suspensionId = await executionContext.hostControl.suspendHistory({
        documentID: doc.id,
        name: 'MCP Digital Painting',
      });
      let committed = false;
      try {
        if (targetLayerId !== originalLayerId) {
          await action.batchPlay(
            [selectLayerByIdDescriptor(targetLayerId)],
            { synchronousExecution: true }
          );
        }
        const initialBrush = await snapshotBrushSettings({ synchronousExecution: true });
        let brushState = { ...initialBrush.settings };
        let cachedColor = currentForegroundRgb();

        for (let index = 0; index < strokes.length; index++) {
          const stroke = strokes[index];
          let brushChanged = false;
          if (stroke.size !== undefined && Number(stroke.size) !== Number(brushState.size)) {
            brushState.size = Number(stroke.size);
            brushChanged = true;
          }
          if (stroke.opacity !== undefined && Number(stroke.opacity) !== Number(brushState.opacity)) {
            brushState.opacity = Number(stroke.opacity);
            brushChanged = true;
          }
          if (stroke.flow !== undefined && Number(stroke.flow) !== Number(brushState.flow)) {
            brushState.flow = Number(stroke.flow);
            brushChanged = true;
          }
          const colorChanged = Boolean(stroke.color && !samePaintColor(cachedColor, stroke.color));
          if (colorChanged) {
            setForegroundColorModal(stroke.color);
            cachedColor = {
              red: Number(stroke.color.red),
              green: Number(stroke.color.green),
              blue: Number(stroke.color.blue),
            };
          }
          // In this UXP host, assigning app.foregroundColor inside the same
          // painting modal can restore the pre-assignment brush opacity/flow.
          // Re-apply the desired core brush state after a color write so
          // per-stroke style semantics match the legacy PathItem route.
          if (brushChanged || colorChanged) {
            const updated = await applyBrushSettingsModal({
              size: Number(brushState.size),
              opacity: Number(brushState.opacity),
              flow: Number(brushState.flow),
            });
            brushState = { ...updated.settings };
          }

          const pathName = `__MCP_PAINT_${Date.now()}_${index}`;
          await doc.pathItems.add(pathName, [makeUxpStrokeSubPath(stroke)]);
          try {
            const tool = constants.ToolType[String(stroke.tool ?? 'BRUSH').toUpperCase()];
            if (!tool) throw new Error(`unsupported UXP stroke tool: ${String(stroke.tool)}`);
            await strokeNamedPathModal(doc, pathName, tool, stroke.simulatePressure);
          } finally {
            await deleteNamedPathModal(pathName);
          }
        }
        if (originalLayerId != null && originalLayerId !== targetLayerId) {
          await action.batchPlay(
            [selectLayerByIdDescriptor(originalLayerId)],
            { synchronousExecution: true }
          );
        }
        await executionContext.hostControl.resumeHistory(suspensionId, true);
        committed = true;
        return {
          ok: true,
          stroke_count: strokes.length,
          layer_id: targetLayerId,
          layer_name: String(targetDescriptor.name ?? ''),
          coordinate_space: 'canvas_pixels',
          document_resolution_dpi: resolution,
          path_coordinate_scale: 1,
        };
      } catch (error) {
        if (!committed) {
          try { await executionContext.hostControl.resumeHistory(suspensionId, false); } catch {}
        }
        throw error;
      } finally {
        if (originalLayerId != null && originalLayerId !== targetLayerId) {
          try {
            await action.batchPlay(
              [selectLayerByIdDescriptor(originalLayerId)],
              { synchronousExecution: true }
            );
          } catch {}
        }
      }
    },
    { commandName: 'MCP Digital Painting' }
  );
}

async function paintDabsBatch(params = {}) {
  const groups = Array.isArray(params.groups) ? params.groups : [];
  if (groups.length < 1) throw new Error('groups must be a non-empty array');
  const target = await preparePaintTarget(params, 'paint_dabs');
  const { doc, targetLayerId, targetDescriptor, originalLayerId, resolution } = target;
  return core.executeAsModal(
    async (executionContext) => {
      const suspensionId = await executionContext.hostControl.suspendHistory({
        documentID: doc.id,
        name: 'MCP Paint Dabs',
      });
      let committed = false;
      try {
        if (targetLayerId !== originalLayerId) {
          await action.batchPlay(
            [selectLayerByIdDescriptor(targetLayerId)],
            { synchronousExecution: true }
          );
        }
        const initialBrush = await snapshotBrushSettings({ synchronousExecution: true });
        let brushState = { ...initialBrush.settings };

        for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
          const group = groups[groupIndex];
          let brushChanged = false;
          if (group.size !== undefined && Number(group.size) !== Number(brushState.size)) {
            brushState.size = Number(group.size);
            brushChanged = true;
          }
          if (group.opacity !== undefined && Number(group.opacity) !== Number(brushState.opacity)) {
            brushState.opacity = Number(group.opacity);
            brushChanged = true;
          }
          if (group.flow !== undefined && Number(group.flow) !== Number(brushState.flow)) {
            brushState.flow = Number(group.flow);
            brushChanged = true;
          }
          const colorWritten = Boolean(group.color);
          if (colorWritten) setForegroundColorModal(group.color);
          // Foreground-color assignment can restore stale brush opacity/flow
          // inside the same modal. Restore the desired style after every color
          // write, including color-only groups that inherit the prior style.
          if (brushChanged || colorWritten) {
            const updated = await applyBrushSettingsModal({
              size: Number(brushState.size),
              opacity: Number(brushState.opacity),
              flow: Number(brushState.flow),
            });
            brushState = { ...updated.settings };
          }
          const points = Array.isArray(group.points) ? group.points : [];
          const pathName = `__MCP_DABS_${Date.now()}_${groupIndex}`;
          await doc.pathItems.add(pathName, points.map(makeUxpDabSubPath));
          try {
            await strokeNamedPathModal(doc, pathName, constants.ToolType.BRUSH, false);
          } finally {
            await deleteNamedPathModal(pathName);
          }
        }
        if (originalLayerId != null && originalLayerId !== targetLayerId) {
          await action.batchPlay(
            [selectLayerByIdDescriptor(originalLayerId)],
            { synchronousExecution: true }
          );
        }
        await executionContext.hostControl.resumeHistory(suspensionId, true);
        committed = true;
        return {
          ok: true,
          group_count: groups.length,
          layer_id: targetLayerId,
          layer_name: String(targetDescriptor.name ?? ''),
          coordinate_space: 'canvas_pixels',
          document_resolution_dpi: resolution,
          path_coordinate_scale: 1,
        };
      } catch (error) {
        if (!committed) {
          try { await executionContext.hostControl.resumeHistory(suspensionId, false); } catch {}
        }
        throw error;
      } finally {
        if (originalLayerId != null && originalLayerId !== targetLayerId) {
          try {
            await action.batchPlay(
              [selectLayerByIdDescriptor(originalLayerId)],
              { synchronousExecution: true }
            );
          } catch {}
        }
      }
    },
    { commandName: 'MCP Paint Dabs' }
  );
}

async function paintRegions(params = {}) {
  const regions = Array.isArray(params.regions) ? params.regions : [];
  if (regions.length < 1) throw new Error('regions must be a non-empty array');
  const clipBounds =
    params.clip_bounds && typeof params.clip_bounds === 'object'
      ? params.clip_bounds
      : null;
  const requestedDocumentId =
    Number.isInteger(params.document_id) && params.document_id > 0
      ? params.document_id
      : null;

  const descriptors = await readSessionDescriptors();
  if (descriptors.documentCount <= 0) throw new Error('No active document');
  const activeDocumentId = numericValue(descriptors.documentDescriptor?.documentID);
  if (requestedDocumentId != null && activeDocumentId !== requestedDocumentId) {
    const openIds = Array.from(app.documents ?? []).map((doc) => doc.id);
    if (!openIds.includes(requestedDocumentId)) {
      throw new Error(`document_not_found: no open document with id ${requestedDocumentId}`);
    }
    throw new Error(
      `document_not_active: pinned document ${requestedDocumentId} is open but not active; active document was not changed`
    );
  }

  const width = documentPixelDimension(descriptors.documentDescriptor?.width, descriptors.documentDescriptor?.resolution);
  const height = documentPixelDimension(descriptors.documentDescriptor?.height, descriptors.documentDescriptor?.resolution);
  const resolution = numericValue(descriptors.documentDescriptor?.resolution) ?? 72;
  if (width == null || height == null) throw new Error('paint_regions document geometry unavailable');

  const doc = app.activeDocument;
  const originalLayer = Array.from(doc.activeLayers ?? [])[0] ?? null;
  const originalLayerId = originalLayer?.id ?? null;
  if (!Number.isInteger(originalLayerId) || originalLayerId <= 0) {
    throw new Error('paint_regions requires an active layer');
  }

  const targets = [];
  for (let regionIndex = 0; regionIndex < regions.length; regionIndex++) {
    const region = regions[regionIndex];
    const targetId =
      Number.isInteger(region?.layerId) && region.layerId > 0
        ? region.layerId
        : originalLayerId;
    const [targetDescriptor] = await action.batchPlay(
      [layerByIdDescriptor(targetId)],
      READ_BATCHPLAY_OPTIONS
    );
    if (!targetDescriptor || targetDescriptor._obj === 'error') {
      throw new Error(`Target layer not found for region ${region?.id || regionIndex}`);
    }
    validatePaintTargetDescriptor(targetDescriptor, 'paint_regions');
    const contours = Array.isArray(region?.contours) ? region.contours : [];
    for (let contourIndex = 0; contourIndex < contours.length; contourIndex++) {
      const points = Array.isArray(contours[contourIndex]?.points)
        ? contours[contourIndex].points
        : [];
      for (let pointIndex = 0; pointIndex < points.length; pointIndex++) {
        assertCanvasPoint(
          points[pointIndex],
          `regions[${regionIndex}].contours[${contourIndex}].points[${pointIndex}]`,
          width,
          height,
          clipBounds
        );
      }
    }
    targets.push({ id: targetId, descriptor: targetDescriptor });
  }

  return core.executeAsModal(
    async (executionContext) => {
      const suspensionId = await executionContext.hostControl.suspendHistory({
        documentID: doc.id,
        name: 'MCP Paint Regions',
      });
      const painted = [];
      let committed = false;
      try {
        for (let regionIndex = 0; regionIndex < regions.length; regionIndex++) {
          const region = regions[regionIndex];
          const target = targets[regionIndex];
          if (target.id !== originalLayerId || regionIndex > 0) {
            await action.batchPlay(
              [selectLayerByIdDescriptor(target.id)],
              { synchronousExecution: true }
            );
          }
          const subpaths = region.contours.map(makeUxpRegionSubPath);
          const pathName = `__MCP_REGION_${Date.now()}_${regionIndex}`;
          await doc.pathItems.add(pathName, subpaths);
          try {
            await action.batchPlay(
              [{
                _obj: 'set',
                _target: [{ _property: 'selection', _ref: 'channel' }],
                to: { _ref: 'path', _name: pathName },
                version: 1,
                vectorMaskParams: true,
                _options: { dialogOptions: 'silent' },
              }],
              { synchronousExecution: true }
            );
            await action.batchPlay(
              [{
                _obj: 'fill',
                using: { _enum: 'fillContents', _value: 'color' },
                color: {
                  _obj: 'RGBColor',
                  red: Number(region.color.red),
                  green: Number(region.color.green),
                  blue: Number(region.color.blue),
                },
                opacity: { _unit: 'percentUnit', _value: Number(region.opacity) },
                mode: { _enum: 'blendMode', _value: 'normal' },
                _options: { dialogOptions: 'silent' },
              }],
              { synchronousExecution: true }
            );
            await doc.selection.deselect();
          } finally {
            try { await doc.selection.deselect(); } catch {}
            try {
              await action.batchPlay(
                [{
                  _obj: 'delete',
                  _target: [{ _ref: 'path', _name: pathName }],
                  _options: { dialogOptions: 'silent' },
                }],
                { synchronousExecution: true }
              );
            } catch {}
          }
          painted.push({
            id: region.id || String(regionIndex),
            layer_id: target.id,
            layer_name: String(target.descriptor.name ?? ''),
            contour_count: region.contours.length,
            opacity: Number(region.opacity),
          });
        }
        if (originalLayerId != null) {
          await action.batchPlay(
            [selectLayerByIdDescriptor(originalLayerId)],
            { synchronousExecution: true }
          );
        }
        await executionContext.hostControl.resumeHistory(suspensionId, true);
        committed = true;
        return {
          ok: true,
          region_count: regions.length,
          painted_regions: painted,
          coordinate_space: 'canvas_pixels',
          document_resolution_dpi: resolution,
          path_coordinate_scale: 1,
          clip_bounds: clipBounds,
        };
      } catch (error) {
        if (!committed) {
          try { await executionContext.hostControl.resumeHistory(suspensionId, false); } catch {}
        }
        throw error;
      } finally {
        if (originalLayerId != null) {
          try {
            await action.batchPlay(
              [selectLayerByIdDescriptor(originalLayerId)],
              { synchronousExecution: true }
            );
          } catch {}
        }
      }
    },
    { commandName: 'MCP Paint Regions' }
  );
}

function previewDocumentDescriptor(documentId) {
  const target = Number.isInteger(documentId) && documentId > 0
    ? { _ref: [{ _ref: 'document', _id: documentId }] }
    : { _ref: [{ _ref: 'document', _enum: 'ordinal', _value: 'targetEnum' }] };
  return {
    _obj: 'multiGet',
    _target: target,
    extendedReference: [[
      'documentID',
      'title',
      'width',
      'height',
      'resolution',
    ]],
    options: { failOnMissingProperty: false, failOnMissingElement: false },
    _options: { dialogOptions: 'dontDisplay' },
  };
}

async function readPreviewDocumentDescriptor(documentId) {
  const [descriptor] = await action.batchPlay(
    [previewDocumentDescriptor(documentId)],
    READ_BATCHPLAY_OPTIONS
  );
  if (!descriptor || descriptor._obj === 'error') {
    throw new Error(
      Number.isInteger(documentId) && documentId > 0
        ? `document_not_found: no open document with id ${documentId}`
        : 'No active document'
    );
  }
  // `multiGet` may return width/height as distanceUnit while omitting
  // `resolution` even though the DOM document has a valid positive DPI.
  // Fall back to the matching DOM document so preview geometry can still be
  // converted to pixels instead of failing before capture.
  const domDocument = Number.isInteger(documentId) && documentId > 0
    ? Array.from(app.documents ?? []).find((doc) => doc.id === documentId)
    : app.activeDocument;
  const resolution =
    numericValue(descriptor.resolution) ?? numericValue(domDocument?.resolution) ?? 72;
  const width = documentPixelDimension(descriptor.width, resolution);
  const height = documentPixelDimension(descriptor.height, resolution);
  if (width == null || height == null || width <= 0 || height <= 0) {
    throw new Error('preview_document_geometry_unavailable');
  }
  return {
    id: numericValue(descriptor.documentID),
    name: typeof descriptor.title === 'string' ? descriptor.title : undefined,
    width,
    height,
  };
}

function previewTargetDimensions(width, height, maxDimension) {
  const safeMax = Math.max(64, Math.min(4096, Number(maxDimension) || 1024));
  const scale = Math.max(width, height) > safeMax
    ? safeMax / Math.max(width, height)
    : 1;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function clampPreviewRegion(region, width, height) {
  if (!region || typeof region !== 'object') return null;
  const left = Math.max(0, Math.min(width, Number(region.left)));
  const top = Math.max(0, Math.min(height, Number(region.top)));
  const right = Math.max(0, Math.min(width, Number(region.right)));
  const bottom = Math.max(0, Math.min(height, Number(region.bottom)));
  if (![left, top, right, bottom].every(Number.isFinite) || right <= left || bottom <= top) {
    throw new Error('Preview focus region is empty after clamping');
  }
  return { left, top, right, bottom };
}

async function encodePreviewPixels(documentId, sourceBounds, targetSize) {
  const imagingApi = photoshop.imaging;
  let sourceImageData = null;
  let canvasImageData = null;
  try {
    const pixelResult = await imagingApi.getPixels({
      documentID: documentId,
      sourceBounds,
      targetSize,
      colorSpace: 'RGB',
      componentSize: 8,
      applyAlpha: true,
    });
    sourceImageData = pixelResult?.imageData ?? null;
    if (!sourceImageData) throw new Error('preview_pixels_unavailable');

    let imageDataForEncoding = sourceImageData;
    const sourceWidth = numericValue(sourceImageData.width);
    const sourceHeight = numericValue(sourceImageData.height);
    if (sourceWidth == null || sourceHeight == null) {
      throw new Error('preview_pixels_geometry_unavailable');
    }

    const levelScale = Math.pow(2, Math.max(0, numericValue(pixelResult.level) ?? 0));
    const actualBounds = pixelResult.sourceBounds;
    const actualFull = actualBounds
      ? {
          left: numericValue(actualBounds.left) * levelScale,
          top: numericValue(actualBounds.top) * levelScale,
          right: numericValue(actualBounds.right) * levelScale,
          bottom: numericValue(actualBounds.bottom) * levelScale,
        }
      : sourceBounds;

    const requestedWidth = sourceBounds.right - sourceBounds.left;
    const requestedHeight = sourceBounds.bottom - sourceBounds.top;
    const offsetX = Math.max(
      0,
      Math.round(((actualFull.left - sourceBounds.left) / requestedWidth) * targetSize.width)
    );
    const offsetY = Math.max(
      0,
      Math.round(((actualFull.top - sourceBounds.top) / requestedHeight) * targetSize.height)
    );

    if (
      sourceWidth !== targetSize.width ||
      sourceHeight !== targetSize.height ||
      offsetX !== 0 ||
      offsetY !== 0
    ) {
      const sourcePixels = await sourceImageData.getData({ chunky: true });
      const components = numericValue(sourceImageData.components) ?? 3;
      if (components !== 3) throw new Error('preview_pixels_expected_rgb');
      const canvas = new Uint8Array(targetSize.width * targetSize.height * 3);
      canvas.fill(255);
      const copyWidth = Math.max(0, Math.min(sourceWidth, targetSize.width - offsetX));
      const copyHeight = Math.max(0, Math.min(sourceHeight, targetSize.height - offsetY));
      for (let y = 0; y < copyHeight; y++) {
        const srcStart = y * sourceWidth * 3;
        const srcEnd = srcStart + copyWidth * 3;
        const dstStart = ((y + offsetY) * targetSize.width + offsetX) * 3;
        canvas.set(sourcePixels.slice(srcStart, srcEnd), dstStart);
      }
      canvasImageData = await imagingApi.createImageDataFromBuffer(canvas, {
        width: targetSize.width,
        height: targetSize.height,
        components: 3,
        chunky: true,
        colorSpace: 'RGB',
        colorProfile: sourceImageData.colorProfile || '',
      });
      imageDataForEncoding = canvasImageData;
    }

    const base64 = await imagingApi.encodeImageData({
      imageData: imageDataForEncoding,
      base64: true,
    });
    if (typeof base64 !== 'string' || base64.length === 0) {
      throw new Error('preview_encode_failed');
    }
    return {
      base64,
      width: targetSize.width,
      height: targetSize.height,
      mimeType: 'image/jpeg',
    };
  } finally {
    if (canvasImageData && typeof canvasImageData.dispose === 'function') canvasImageData.dispose();
    if (sourceImageData && typeof sourceImageData.dispose === 'function') sourceImageData.dispose();
  }
}

async function capturePreview(params = {}) {
  const requestedId = Number.isInteger(params.document_id) && params.document_id > 0
    ? params.document_id
    : undefined;
  const documentInfo = await readPreviewDocumentDescriptor(requestedId);
  const documentId = documentInfo.id;
  if (!Number.isInteger(documentId) || documentId <= 0) {
    throw new Error('preview_document_id_unavailable');
  }

  const wholeBounds = {
    left: 0,
    top: 0,
    right: documentInfo.width,
    bottom: documentInfo.height,
  };
  const wholeTarget = previewTargetDimensions(
    documentInfo.width,
    documentInfo.height,
    params.max_dimension_px
  );
  const focusRegion = params.focus_region
    ? clampPreviewRegion(params.focus_region, documentInfo.width, documentInfo.height)
    : null;
  const focusTarget = focusRegion
    ? previewTargetDimensions(
        focusRegion.right - focusRegion.left,
        focusRegion.bottom - focusRegion.top,
        params.focus_max_dimension_px ?? 1200
      )
    : null;

  return core.executeAsModal(
    async () => {
      const whole = await encodePreviewPixels(documentId, wholeBounds, wholeTarget);
      const focus = focusRegion && focusTarget
        ? {
            ...(await encodePreviewPixels(documentId, focusRegion, focusTarget)),
            region: focusRegion,
            canvasWidth: documentInfo.width,
            canvasHeight: documentInfo.height,
          }
        : undefined;
      return {
        transport: 'uxp',
        whole: {
          ...whole,
          canvasWidth: documentInfo.width,
          canvasHeight: documentInfo.height,
        },
        ...(focus ? { focus } : {}),
      };
    },
    { commandName: 'MCP Read Preview' }
  );
}

function colorHex(red, green, blue) {
  const hex2 = (value) => {
    const hex = Math.max(0, Math.min(255, Math.round(value)))
      .toString(16)
      .toUpperCase();
    return hex.length < 2 ? `0${hex}` : hex;
  };
  return `#${hex2(red)}${hex2(green)}${hex2(blue)}`;
}

async function sampleCompositeRegion(documentId, bounds) {
  const imagingApi = photoshop.imaging;
  let imageData = null;
  try {
    const pixelResult = await imagingApi.getPixels({
      documentID: documentId,
      sourceBounds: bounds,
      colorSpace: 'RGB',
      componentSize: 8,
      applyAlpha: true,
    });
    imageData = pixelResult?.imageData ?? null;
    if (!imageData) {
      return { red: 255, green: 255, blue: 255 };
    }

    const pixels = await imageData.getData({ chunky: true });
    const components = numericValue(imageData.components) ?? 3;
    if (components < 3) throw new Error('sample_color_expected_rgb');

    const requestedPixelCount =
      Math.max(0, Math.round(bounds.right - bounds.left)) *
      Math.max(0, Math.round(bounds.bottom - bounds.top));
    if (requestedPixelCount <= 0) throw new Error('sample_color_empty_bounds');

    let red = 0;
    let green = 0;
    let blue = 0;
    const returnedPixelCount = Math.floor(pixels.length / components);
    for (let index = 0; index < returnedPixelCount; index++) {
      const offset = index * components;
      red += pixels[offset] ?? 255;
      green += pixels[offset + 1] ?? 255;
      blue += pixels[offset + 2] ?? 255;
    }

    // Imaging may trim fully transparent pixels from the requested bounds.
    // The legacy merged-duplicate sampler observes the whole requested square;
    // account for trimmed pixels as white so bounds semantics remain stable.
    const missing = Math.max(0, requestedPixelCount - returnedPixelCount);
    red += missing * 255;
    green += missing * 255;
    blue += missing * 255;

    return {
      red: red / requestedPixelCount,
      green: green / requestedPixelCount,
      blue: blue / requestedPixelCount,
    };
  } finally {
    if (imageData && typeof imageData.dispose === 'function') imageData.dispose();
  }
}

function normalizeSampleRgb(rgb) {
  const rgb8 = {
    red: Math.max(0, Math.min(255, Math.round(rgb.red))),
    green: Math.max(0, Math.min(255, Math.round(rgb.green))),
    blue: Math.max(0, Math.min(255, Math.round(rgb.blue))),
  };
  return {
    rgb,
    rgb_8bit: rgb8,
    hex: colorHex(rgb8.red, rgb8.green, rgb8.blue),
  };
}

async function sampleColor(params = {}) {
  const x = Number(params.x);
  const y = Number(params.y);
  const radius = Number(params.radius ?? 0);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error('sample_color requires finite x/y');
  }
  if (!Number.isInteger(radius) || radius < 0 || radius > 100) {
    throw new Error('radius must be an integer between 0 and 100');
  }

  const requestedId = Number.isInteger(params.document_id) && params.document_id > 0
    ? params.document_id
    : undefined;
  const documentInfo = await readPreviewDocumentDescriptor(requestedId);
  const documentId = documentInfo.id;
  if (!Number.isInteger(documentId) || documentId <= 0) {
    throw new Error('sample_color_document_id_unavailable');
  }
  if (x < 0 || y < 0 || x >= documentInfo.width || y >= documentInfo.height) {
    throw new Error(
      `sample_out_of_bounds: point (${x}, ${y}) is outside ${documentInfo.width}x${documentInfo.height}`
    );
  }

  const bounds = radius > 0
    ? {
        left: Math.max(0, x - radius),
        top: Math.max(0, y - radius),
        right: Math.min(documentInfo.width, x + radius + 1),
        bottom: Math.min(documentInfo.height, y + radius + 1),
      }
    : { left: x, top: y, right: x + 1, bottom: y + 1 };

  const rgb = await core.executeAsModal(
    () => sampleCompositeRegion(documentId, bounds),
    { commandName: 'MCP Sample Color' }
  );
  const normalized = normalizeSampleRgb(rgb);
  return {
    ok: true,
    document: {
      id: documentId,
      name: documentInfo.name,
      width: documentInfo.width,
      height: documentInfo.height,
    },
    point: { x, y },
    mode: radius > 0 ? 'AVERAGE' : 'POINT',
    radius,
    bounds: radius > 0
      ? {
          ...bounds,
          width: bounds.right - bounds.left,
          height: bounds.bottom - bounds.top,
        }
      : null,
    ...normalized,
  };
}

async function sampleColors(params = {}) {
  const points = Array.isArray(params.points) ? params.points : [];
  if (points.length < 1 || points.length > 1024) {
    throw new Error('points must contain between 1 and 1024 entries');
  }
  const requestedId = Number.isInteger(params.document_id) && params.document_id > 0
    ? params.document_id
    : undefined;
  const documentInfo = await readPreviewDocumentDescriptor(requestedId);
  const documentId = documentInfo.id;
  if (!Number.isInteger(documentId) || documentId <= 0) {
    throw new Error('sample_colors_document_id_unavailable');
  }

  const normalizedPoints = points.map((point, index) => {
    const x = Number(point?.x);
    const y = Number(point?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new Error(`points[${index}] requires finite x/y`);
    }
    if (x < 0 || y < 0 || x >= documentInfo.width || y >= documentInfo.height) {
      throw new Error(
        `sample_out_of_bounds: point (${x}, ${y}) is outside ${documentInfo.width}x${documentInfo.height}`
      );
    }
    return {
      id: point?.id === undefined ? null : String(point.id),
      x,
      y,
    };
  });

  const samples = await core.executeAsModal(
    async () => {
      const values = [];
      for (const point of normalizedPoints) {
        const rgb = await sampleCompositeRegion(documentId, {
          left: point.x,
          top: point.y,
          right: point.x + 1,
          bottom: point.y + 1,
        });
        values.push({
          id: point.id,
          point: { x: point.x, y: point.y },
          ...normalizeSampleRgb(rgb),
        });
      }
      return values;
    },
    { commandName: 'MCP Sample Colors' }
  );

  return {
    ok: true,
    document: {
      id: documentId,
      name: documentInfo.name,
      width: documentInfo.width,
      height: documentInfo.height,
    },
    mode: 'POINT_BATCH',
    count: samples.length,
    samples,
  };
}

function historyStateDescriptor(indexOrTarget) {
  return {
    _obj: 'get',
    _target: [
      indexOrTarget === 'target'
        ? { _ref: 'historyState', _enum: 'ordinal', _value: 'targetEnum' }
        : { _ref: 'historyState', _index: indexOrTarget },
    ],
    _options: { dialogOptions: 'dontDisplay' },
  };
}

async function snapshotHistory() {
  const sessionDescriptors = await readSessionDescriptors();
  if ((sessionDescriptors.documentCount ?? 0) < 1) {
    throw new Error('No active document');
  }
  const [current] = await action.batchPlay(
    [historyStateDescriptor('target')],
    READ_BATCHPLAY_OPTIONS
  );
  if (!current || current._obj === 'error') {
    throw new Error('history_state_unavailable');
  }
  const count = Math.max(0, Math.round(numericValue(current.count) ?? 0));
  const descriptors = count > 0
    ? await action.batchPlay(
        Array.from({ length: count }, (_, index) => historyStateDescriptor(index + 1)),
        READ_BATCHPLAY_OPTIONS
      )
    : [];
  const states = descriptors.map((descriptor) => ({
    name: typeof descriptor?.name === 'string' ? descriptor.name : 'Unknown',
    snapshot: descriptor?.auto === false,
  }));
  const itemIndex = Math.round(numericValue(current.itemIndex) ?? 0);
  const currentIndex = itemIndex > 0 ? itemIndex - 1 : -1;
  return {
    totalStates: states.length,
    currentIndex,
    currentState:
      currentIndex >= 0 && currentIndex < states.length
        ? states[currentIndex].name
        : (typeof current.name === 'string' ? current.name : 'Unknown'),
    canUndo: currentIndex > 0,
    canRedo: currentIndex >= 0 && currentIndex < states.length - 1,
    states,
    context: normalizeSessionState(sessionDescriptors),
  };
}

function structuredDocumentResult(document, extra = {}) {
  const documentId = numericValue(document?.id);
  if (!Number.isInteger(documentId) || documentId <= 0) {
    throw new Error('uxp_document_id_unavailable');
  }
  const activeDocumentId = numericValue(app.activeDocument?.id) ?? null;
  return {
    transport: 'uxp',
    ...extra,
    document: {
      id: documentId,
      name: typeof document?.name === 'string' ? document.name : '',
      width: numericValue(document?.width),
      height: numericValue(document?.height),
      resolution: numericValue(document?.resolution),
    },
    active_document_id: activeDocumentId,
  };
}

async function createDocumentMutation(params = {}) {
  const width = Number(params.width);
  const height = Number(params.height);
  const resolution = Number(params.resolution ?? 72);
  const colorMode = String(params.colorMode ?? 'RGB');
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    throw new Error('create_document requires positive finite width and height');
  }
  if (!Number.isFinite(resolution) || resolution <= 0) {
    throw new Error('create_document requires a positive finite resolution');
  }
  const colorModes = {
    RGB: constants.NewDocumentMode?.RGB ?? 'RGBColorMode',
    CMYK: constants.NewDocumentMode?.CMYK ?? 'CMYKColorMode',
    Grayscale: constants.NewDocumentMode?.GRAYSCALE ?? 'GrayscaleMode',
  };
  if (!Object.prototype.hasOwnProperty.call(colorModes, colorMode)) {
    throw new Error(`unsupported create_document color mode: ${colorMode}`);
  }

  const document = await core.executeAsModal(
    () => app.documents.add({
      width,
      height,
      resolution,
      mode: colorModes[colorMode],
      fill: constants.DocumentFill?.WHITE ?? 'white',
    }),
    { commandName: 'MCP Create Document' }
  );
  return structuredDocumentResult(document, {
    operation: 'create_document',
    requested: { width, height, resolution, colorMode },
  });
}

async function openImageMutation(params = {}) {
  const filePath = typeof params.filePath === 'string' ? params.filePath.trim() : '';
  if (!filePath) throw new Error('open_image requires a non-empty filePath');
  const entry = await localFileSystem.getEntryWithUrl(fileUrlFromNativePath(filePath, 'open_image'));
  if (entry?.isFile === false) throw new Error(`open_image path is not a file: ${filePath}`);
  const document = await core.executeAsModal(
    () => app.open(entry),
    { commandName: 'MCP Open Image' }
  );
  return structuredDocumentResult(document, {
    operation: 'open_image',
    path: filePath,
  });
}

function snapshotPersistenceState(targetDocument) {
  const activeDocument = app.activeDocument;
  let selectionBounds = null;
  let selectionObserved = false;
  try {
    selectionBounds = normalizedBounds(targetDocument.selection?.bounds ?? null);
    selectionObserved = true;
  } catch {}

  return {
    active_document_id: activeDocument?.id ?? null,
    target_document_id: targetDocument.id,
    target_document_path: targetDocument.path ?? '',
    target_document_saved: Boolean(targetDocument.saved),
    active_layer_ids: Array.from(targetDocument.activeLayers ?? []).map((layer) => layer.id),
    active_tool_id: app.currentTool?.id ?? null,
    selection_observed: selectionObserved,
    selection_bounds: selectionBounds,
  };
}

function sameJson(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function persistenceInvariants(before, after) {
  const invariants = {
    active_document_unchanged: before.active_document_id === after.active_document_id,
    working_path_unchanged: before.target_document_path === after.target_document_path,
    active_layers_unchanged: sameJson(before.active_layer_ids, after.active_layer_ids),
    active_tool_unchanged: before.active_tool_id === after.active_tool_id,
    selection_unchanged:
      before.selection_observed && after.selection_observed
        ? sameJson(before.selection_bounds, after.selection_bounds)
        : undefined,
  };
  const observed = Object.values(invariants).filter((value) => value !== undefined);
  return { invariants, invariants_ok: observed.every(Boolean) };
}

async function saveDocumentCopy(params) {
  const requestedId = Number.isInteger(params.document_id) ? params.document_id : null;
  const targetDocument = requestedId == null
    ? app.activeDocument
    : Array.from(app.documents).find((doc) => doc.id === requestedId);
  if (!targetDocument) {
    throw new Error(
      requestedId == null
        ? 'save_document requires an open document'
        : `document_not_found: no open document with id ${requestedId}`
    );
  }

  const format = String(params.format ?? 'PSD').toUpperCase();
  if (!['PSD', 'JPEG', 'PNG'].includes(format)) {
    throw new Error(`unsupported save_document format: ${format}`);
  }

  const before = snapshotPersistenceState(targetDocument);
  const entry = await localFileSystem.createEntryWithUrl(fileUrlFromNativePath(params.path), {
    type: types.file,
    overwrite: true,
  });

  await core.executeAsModal(
    async () => {
      if (format === 'PSD') {
        await targetDocument.saveAs.psd(entry, { embedColorProfile: true, layers: true }, true);
      } else if (format === 'JPEG') {
        const quality = Math.max(1, Math.min(12, Number(params.quality ?? 8)));
        await targetDocument.saveAs.jpg(entry, { quality, embedColorProfile: true }, true);
      } else {
        await targetDocument.saveAs.png(entry, {}, true);
      }
    },
    { commandName: 'MCP Save Copy' }
  );

  const after = snapshotPersistenceState(targetDocument);
  const probe = persistenceInvariants(before, after);
  if (!probe.invariants_ok) {
    const failed = Object.entries(probe.invariants)
      .filter(([, value]) => value === false)
      .map(([name]) => name)
      .join(', ');
    throw new Error(`persistence_invariant_violation:${failed}`);
  }

  return {
    transport: 'uxp',
    path: params.path,
    format,
    as_copy: true,
    before,
    after,
    ...probe,
  };
}

async function tryPostResult(payload) {
  try {
    const response = await fetch(`${BRIDGE_BASE}/result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return response.ok;
  } catch {
    return false;
  }
}

function rememberPendingResult(payload) {
  const now = Date.now();
  for (const [id, pending] of pendingResultDeliveries) {
    if (now - pending.createdAt > RESULT_DELIVERY_TTL_MS) pendingResultDeliveries.delete(id);
  }
  pendingResultDeliveries.set(payload.id, { payload, createdAt: now });
  while (pendingResultDeliveries.size > MAX_PENDING_RESULT_DELIVERIES) {
    const oldestId = pendingResultDeliveries.keys().next().value;
    if (oldestId == null) break;
    pendingResultDeliveries.delete(oldestId);
  }
}

async function postResult(payload) {
  const currentPayload = {
    protocol: RESULT_PROTOCOL,
    ...payload,
  };
  if (await tryPostResult(currentPayload)) {
    pendingResultDeliveries.delete(currentPayload.id);
    return true;
  }
  // Result transport failure must never be converted into a Photoshop action
  // failure after the mutation already ran. Retain and redeliver the exact
  // payload while the companion remains alive.
  rememberPendingResult(currentPayload);
  return false;
}

async function flushPendingResults() {
  const now = Date.now();
  for (const [id, pending] of Array.from(pendingResultDeliveries.entries())) {
    if (now - pending.createdAt > RESULT_DELIVERY_TTL_MS) {
      pendingResultDeliveries.delete(id);
      continue;
    }
    if (await tryPostResult(pending.payload)) pendingResultDeliveries.delete(id);
  }
}

async function claimCommandForExecution(commandId) {
  try {
    const response = await fetch(`${BRIDGE_BASE}/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: commandId }),
    });
    if (!response.ok) return { execute: false };
    return await response.json();
  } catch {
    return { execute: false };
  }
}

function neuralDescriptors(filter, params) {
  const smoothness = params.smoothness ?? 50;
  const blur = params.blur ?? 50;

  switch (filter) {
    case 'skin_smoothing':
      return [
        {
          _obj: 'neuralGalleryFilters',
          neuralGalleryFilters: {
            _obj: 'skinSmoothing',
            smoothness,
            blur,
          },
        },
      ];
    case 'harmonize':
      return [
        {
          _obj: 'neuralGalleryFilters',
          neuralGalleryFilters: {
            _obj: 'harmonization',
          },
        },
      ];
    case 'depth_blur':
      return [
        {
          _obj: 'neuralGalleryFilters',
          neuralGalleryFilters: {
            _obj: 'depthBlur',
          },
        },
      ];
    case 'super_zoom':
      return [
        {
          _obj: 'neuralGalleryFilters',
          neuralGalleryFilters: {
            _obj: 'superZoom',
          },
        },
      ];
    case 'colorize':
      return [
        {
          _obj: 'neuralGalleryFilters',
          neuralGalleryFilters: {
            _obj: 'colorize',
          },
        },
      ];
    default:
      throw new Error(`Unknown neural filter: ${filter}`);
  }
}

async function handleCommand(cmd) {
  const { id, action: cmdAction, params = {} } = cmd;

  try {
    const p1Document = await tryHandleP1DocumentOperation(cmdAction, params);
    if (p1Document?.handled) {
      await postResult({ id, ok: true, data: p1Document.data ?? {} });
      return;
    }
    const p1Selection = await tryHandleP1SelectionOperation(cmdAction, params);
    if (p1Selection?.handled) {
      await postResult({ id, ok: true, data: p1Selection.data ?? {} });
      return;
    }
    const p1Layer = await tryHandleP1LayerOperation(cmdAction, params);
    if (p1Layer?.handled) {
      await postResult({ id, ok: true, data: p1Layer.data ?? {} });
      return;
    }
    const p2Adjustment = await tryHandleP2AdjustmentOperation(cmdAction, params);
    if (p2Adjustment?.handled) {
      await postResult({ id, ok: true, data: p2Adjustment.data ?? {} });
      return;
    }
    const p2Filter = await tryHandleP2FilterOperation(cmdAction, params);
    if (p2Filter?.handled) {
      await postResult({ id, ok: true, data: p2Filter.data ?? {} });
      return;
    }
    const p2TextExport = await tryHandleP2TextExportOperation(cmdAction, params);
    if (p2TextExport?.handled) {
      await postResult({ id, ok: true, data: p2TextExport.data ?? {} });
      return;
    }
    const p3Utility = await tryHandleP3UtilityOperation(cmdAction, params);
    if (p3Utility?.handled) {
      await postResult({ id, ok: true, data: p3Utility.data ?? {} });
      return;
    }
    const p3DocumentData = await tryHandleP3DocumentDataOperation(cmdAction, params);
    if (p3DocumentData?.handled) {
      await postResult({ id, ok: true, data: p3DocumentData.data ?? {} });
      return;
    }
    const p3LayerAdvanced = await tryHandleP3LayerAdvancedOperation(cmdAction, params);
    if (p3LayerAdvanced?.handled) {
      await postResult({ id, ok: true, data: p3LayerAdvanced.data ?? {} });
      return;
    }

    if (cmdAction === 'create_document') {
      await postResult({ id, ok: true, data: await createDocumentMutation(params) });
      return;
    }

    if (cmdAction === 'open_image') {
      await postResult({ id, ok: true, data: await openImageMutation(params) });
      return;
    }

    if (cmdAction === 'diagnostic_ping') {
      const activeDocument = photoshop.app.activeDocument;
      await postResult({
        id,
        ok: true,
        data: {
          transport: 'uxp',
          bridgeRevision: BRIDGE_REVISION,
          photoshopVersion: photoshop.app.version,
          documentCount: photoshop.app.documents.length,
          activeDocument: activeDocument
            ? { id: activeDocument.id, name: activeDocument.name }
            : null,
          pathApi: {
            appPathPointInfo: typeof app.PathPointInfo,
            modulePathPointInfo: typeof photoshop.PathPointInfo,
            appSubPathInfo: typeof app.SubPathInfo,
            moduleSubPathInfo: typeof photoshop.SubPathInfo,
            appPathItem: typeof app.PathItem,
            appPathItems: typeof app.PathItems,
            pathItemMethods:
              typeof app.PathItem === 'function'
                ? Object.getOwnPropertyNames(app.PathItem.prototype)
                : [],
            pathItemsMethods:
              typeof app.PathItems === 'function'
                ? Object.getOwnPropertyNames(app.PathItems.prototype)
                : [],
            activePathItemsObjectMethods: activeDocument?.pathItems
              ? Object.getOwnPropertyNames(Object.getPrototypeOf(activeDocument.pathItems))
              : [],
            activePathItemsDynamic: activeDocument?.pathItems
              ? {
                  add: typeof activeDocument.pathItems.add,
                  getByName: typeof activeDocument.pathItems.getByName,
                }
              : null,
            pointKind: typeof photoshop.constants?.PointKind,
            shapeOperation: typeof photoshop.constants?.ShapeOperation,
            toolType: typeof photoshop.constants?.ToolType,
            colorBlendMode: typeof photoshop.constants?.ColorBlendMode,
          },
          pluginTimestampMs: Date.now(),
        },
      });
      return;
    }

    if (cmdAction === 'diagnostic_batchplay') {
      const started = Date.now();
      const descriptors = await readSessionDescriptors();
      await postResult({
        id,
        ok: true,
        data: {
          transport: 'uxp',
          operation: 'batchPlay:get:numberOfDocuments',
          photoshopActionMs: Date.now() - started,
          descriptor: descriptors.countDescriptor,
          stateDescriptors: {
            document: descriptors.documentDescriptor,
            layer: descriptors.layerDescriptor,
          },
          pluginTimestampMs: Date.now(),
        },
      });
      return;
    }

    if (cmdAction === 'get_state') {
      await postResult({ id, ok: true, data: await snapshotSessionState() });
      return;
    }

    if (cmdAction === 'list_documents') {
      await postResult({ id, ok: true, data: await snapshotDocumentList() });
      return;
    }

    if (cmdAction === 'get_selection_bounds') {
      await postResult({ id, ok: true, data: await snapshotSelectionBounds() });
      return;
    }

    if (cmdAction === 'list_layers') {
      await postResult({ id, ok: true, data: await snapshotLayerList() });
      return;
    }

    if (cmdAction === 'create_layer') {
      await postResult({ id, ok: true, data: await createLayerMutation(params) });
      return;
    }

    if (cmdAction === 'delete_layer') {
      await postResult({ id, ok: true, data: await deleteLayerMutation(params) });
      return;
    }

    if (cmdAction === 'select_layer_by_name') {
      await postResult({ id, ok: true, data: await selectLayerByNameMutation(params) });
      return;
    }

    if (cmdAction === 'undo') {
      await postResult({ id, ok: true, data: await undoMutation(params) });
      return;
    }

    if (cmdAction === 'create_layer_mask') {
      await postResult({ id, ok: true, data: await createLayerMaskMutation(params) });
      return;
    }

    if (cmdAction === 'apply_gradient_mask') {
      await postResult({ id, ok: true, data: await applyGradientMaskMutation(params) });
      return;
    }

    if (cmdAction === 'select_rectangle') {
      await postResult({ id, ok: true, data: await selectShapeMutation(params, 'rectangle') });
      return;
    }

    if (cmdAction === 'select_ellipse') {
      await postResult({ id, ok: true, data: await selectShapeMutation(params, 'ellipse') });
      return;
    }

    if (cmdAction === 'feather_selection') {
      await postResult({ id, ok: true, data: await featherSelectionMutation(params) });
      return;
    }

    if (cmdAction === 'select_subject') {
      await postResult({ id, ok: true, data: await selectSubjectMutation(params) });
      return;
    }

    if (cmdAction === 'set_layer_opacity') {
      await postResult({ id, ok: true, data: await setLayerOpacityMutation(params) });
      return;
    }

    if (cmdAction === 'set_layer_blend_mode') {
      await postResult({ id, ok: true, data: await setLayerBlendModeMutation(params) });
      return;
    }

    if (cmdAction === 'set_layer_visibility') {
      await postResult({ id, ok: true, data: await setLayerVisibilityMutation(params) });
      return;
    }

    if (cmdAction === 'set_layer_locked') {
      await postResult({ id, ok: true, data: await setLayerLockedMutation(params) });
      return;
    }

    if (cmdAction === 'rename_layer') {
      await postResult({ id, ok: true, data: await renameLayerMutation(params) });
      return;
    }

    if (cmdAction === 'duplicate_layer') {
      await postResult({ id, ok: true, data: await duplicateLayerMutation(params) });
      return;
    }

    if (cmdAction === 'move_layer') {
      await postResult({ id, ok: true, data: await moveLayerMutation(params) });
      return;
    }

    if (cmdAction === 'list_brush_presets') {
      await postResult({ id, ok: true, data: await snapshotBrushPresets(params) });
      return;
    }

    if (cmdAction === 'get_brush_settings') {
      await postResult({ id, ok: true, data: await snapshotBrushSettings() });
      return;
    }

    if (cmdAction === 'get_brush_options_raw') {
      await postResult({ id, ok: true, data: await snapshotBrushOptionsRaw() });
      return;
    }

    if (cmdAction === 'set_brush') {
      await postResult({ id, ok: true, data: await writeBrushSettings(params) });
      return;
    }

    if (cmdAction === 'select_brush_preset') {
      await postResult({ id, ok: true, data: await selectBrushPreset(params) });
      return;
    }

    if (cmdAction === 'set_foreground_color') {
      await postResult({ id, ok: true, data: await writeForegroundColor(params) });
      return;
    }

    if (cmdAction === 'get_foreground_color') {
      await postResult({ id, ok: true, data: await snapshotForegroundColor() });
      return;
    }

    if (cmdAction === 'fill_layer') {
      await postResult({ id, ok: true, data: await fillLayer(params) });
      return;
    }

    if (cmdAction === 'paint_regions') {
      await postResult({ id, ok: true, data: await paintRegions(params) });
      return;
    }

    if (cmdAction === 'paint_strokes') {
      await postResult({ id, ok: true, data: await paintStrokesBatch(params) });
      return;
    }

    if (cmdAction === 'paint_dabs') {
      await postResult({ id, ok: true, data: await paintDabsBatch(params) });
      return;
    }

    if (cmdAction === 'capture_preview') {
      await postResult({ id, ok: true, data: await capturePreview(params) });
      return;
    }

    if (cmdAction === 'sample_color') {
      await postResult({ id, ok: true, data: await sampleColor(params) });
      return;
    }

    if (cmdAction === 'sample_colors') {
      await postResult({ id, ok: true, data: await sampleColors(params) });
      return;
    }

    if (cmdAction === 'get_history') {
      await postResult({ id, ok: true, data: await snapshotHistory() });
      return;
    }

    if (cmdAction === 'save_document') {
      const data = await saveDocumentCopy(params);
      await postResult({ id, ok: true, data });
      return;
    }

    if (cmdAction === 'neural_filter') {
      const descriptors = neuralDescriptors(params.filter, params);
      if (Number.isInteger(params.document_id) && params.document_id > 0) {
        descriptors.unshift({
          _obj: 'select',
          _target: [{ _ref: 'document', _id: params.document_id }],
          _options: { dialogOptions: 'dontDisplay' },
        });
      }
      const result = await action.batchPlay(descriptors, {
        synchronousExecution: true,
        modalBehavior: 'execute',
      });
      await postResult({ id, ok: true, data: result });
      return;
    }

    await postResult({ id, ok: false, error: `unknown_action:${cmdAction}` });
  } catch (error) {
    await postResult({
      id,
      ok: false,
      error: error?.message || String(error),
    });
  }
}

async function pollOnce() {
  try {
    await flushPendingResults();
    const activeDocument = app.activeDocument;
    const query = [
      `protocol=${encodeURIComponent(REGISTRATION_PROTOCOL)}`,
      `revision=${encodeURIComponent(BRIDGE_REVISION)}`,
      `photoshopVersion=${encodeURIComponent(String(app.version || ''))}`,
      `documentCount=${encodeURIComponent(String(app.documents?.length ?? 0))}`,
      `activeDocumentId=${encodeURIComponent(activeDocument ? String(activeDocument.id) : '')}`,
      `activeDocumentName=${encodeURIComponent(activeDocument ? String(activeDocument.name) : '')}`,
    ].join('&');
    const res = await fetch(`${BRIDGE_BASE}/poll?${query}`);
    if (res.status === 204) return true;
    if (!res.ok) return false;
    const cmd = await res.json();
    if (cmd?.protocol !== COMMAND_PROTOCOL) return false;
    if (cmd?.id) {
      const claim = await claimCommandForExecution(cmd.id);
      if (claim?.execute === true) await handleCommand(cmd);
    }
    return true;
  } catch {
    // MCP server may not be running yet
    return false;
  }
}

async function pollLoop() {
  if (polling) return;
  polling = true;
  while (polling) {
    const connected = await pollOnce();
    // A healthy long-poll immediately opens the next request. Back off only when
    // the localhost server is unavailable so a stopped MCP process cannot cause
    // a tight retry loop inside Photoshop.
    if (!connected) {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
}

entrypoints.setup({
  plugin: {
    create() {
      pollLoop();
    },
    destroy() {
      polling = false;
    },
  },
  panels: {
    bridgePanel: {
      create() {
        pollLoop();
      },
      show() {
        pollLoop();
      },
      // Keep the bridge alive when the panel is hidden. Persistence is a
      // plugin-level service; panel visibility must not control transport.
      hide() {},
    },
  },
});

pollLoop();
