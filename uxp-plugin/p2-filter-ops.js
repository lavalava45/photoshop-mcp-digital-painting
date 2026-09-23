/** P2 filter operations for the Photoshop UXP bridge. */
const photoshop = require('photoshop');
const { action, app, core } = photoshop;

function activeDocument(params = {}) {
  if (!app.documents || app.documents.length === 0) throw new Error('No active document');
  const doc = app.activeDocument;
  const requestedId = Number.isInteger(params.document_id) && params.document_id > 0
    ? params.document_id
    : null;
  if (requestedId != null && doc.id !== requestedId) {
    const openIds = Array.from(app.documents).map((entry) => entry.id);
    if (!openIds.includes(requestedId)) throw new Error(`document_not_found: no open document with id ${requestedId}`);
    throw new Error(`document_not_active: pinned document ${requestedId} is open but not active; active document was not changed`);
  }
  return doc;
}

function contextFor(doc) {
  const layer = Array.from(doc.activeLayers ?? [])[0] ?? null;
  return {
    document: { id: doc.id, name: String(doc.title ?? doc.name ?? '') },
    activeLayer: layer ? { id: layer.id, name: String(layer.name ?? '') } : null,
  };
}

function px(value) {
  return { _unit: 'pixelsUnit', _value: value };
}

function percent(value) {
  return { _unit: 'percentUnit', _value: value };
}

function angle(value) {
  return { _unit: 'angleUnit', _value: value };
}

async function playFilter(params, commandName, descriptor, details) {
  return core.executeAsModal(
    async () => {
      const doc = activeDocument(params);
      await action.batchPlay(
        [{ ...descriptor, _options: { dialogOptions: 'silent' } }],
        { synchronousExecution: true }
      );
      return { ...details, context: contextFor(doc) };
    },
    { commandName }
  );
}

async function applyGaussianBlur(params = {}) {
  return playFilter(
    params,
    'MCP Gaussian Blur',
    { _obj: 'gaussianBlur', radius: px(Number(params.radius)) },
    { filter: 'gaussian_blur', radius: Number(params.radius) }
  );
}

async function applyHighPass(params = {}) {
  return playFilter(
    params,
    'MCP High Pass',
    { _obj: 'highPass', radius: px(Number(params.radius)) },
    { filter: 'high_pass', radius: Number(params.radius) }
  );
}

async function applyMotionBlur(params = {}) {
  return playFilter(
    params,
    'MCP Motion Blur',
    { _obj: 'motionBlur', angle: angle(Number(params.angle)), distance: px(Number(params.radius)) },
    { filter: 'motion_blur', angle: Number(params.angle), radius: Number(params.radius) }
  );
}

async function applyNoise(params = {}) {
  const distribution = String(params.distribution ?? 'UNIFORM').toUpperCase();
  return playFilter(
    params,
    'MCP Add Noise',
    {
      _obj: 'addNoise',
      amount: percent(Number(params.amount)),
      distribution: {
        _enum: 'noiseDistribution',
        _value: distribution === 'GAUSSIAN' ? 'gaussianDistribution' : 'uniformDistribution',
      },
      monochromatic: params.monochromatic === true,
    },
    {
      filter: 'noise',
      amount: Number(params.amount),
      distribution,
      monochromatic: params.monochromatic === true,
    }
  );
}

async function applySharpen(params = {}) {
  return playFilter(
    params,
    'MCP Unsharp Mask',
    {
      _obj: 'unsharpMask',
      amount: percent(Number(params.amount)),
      radius: px(Number(params.radius)),
      threshold: Number(params.threshold ?? 0),
    },
    {
      filter: 'sharpen',
      amount: Number(params.amount),
      radius: Number(params.radius),
      threshold: Number(params.threshold ?? 0),
    }
  );
}

async function applySmartBlur(params = {}) {
  const mode = String(params.mode ?? 'NORMAL').toUpperCase();
  const quality = String(params.quality ?? 'MEDIUM').toUpperCase();
  const modeValues = { NORMAL: 'normal', EDGEONLY: 'edgeOnly', OVERLAYEDGE: 'overlayEdge' };
  const qualityValues = { LOW: 'low', MEDIUM: 'medium', HIGH: 'high' };
  return playFilter(
    params,
    'MCP Smart Blur',
    {
      _obj: 'smartBlur',
      radius: px(Number(params.radius)),
      threshold: Number(params.threshold),
      quality: { _enum: 'smartBlurQuality', _value: qualityValues[quality] ?? 'medium' },
      mode: { _enum: 'smartBlurMode', _value: modeValues[mode] ?? 'normal' },
    },
    {
      filter: 'smart_blur',
      radius: Number(params.radius),
      threshold: Number(params.threshold),
      mode,
      quality,
    }
  );
}

async function tryHandleP2FilterOperation(cmdAction, params = {}) {
  switch (cmdAction) {
    case 'apply_gaussian_blur': return { handled: true, data: await applyGaussianBlur(params) };
    case 'apply_high_pass': return { handled: true, data: await applyHighPass(params) };
    case 'apply_motion_blur': return { handled: true, data: await applyMotionBlur(params) };
    case 'apply_noise': return { handled: true, data: await applyNoise(params) };
    case 'apply_sharpen': return { handled: true, data: await applySharpen(params) };
    case 'apply_smart_blur': return { handled: true, data: await applySmartBlur(params) };
    default: return { handled: false };
  }
}

module.exports = { tryHandleP2FilterOperation };
