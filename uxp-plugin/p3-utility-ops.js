/** P3 utility operations for the Photoshop UXP bridge. */
const photoshop = require('photoshop');
const { action, app, core, constants } = photoshop;

function numericValue(value) {
  if (typeof value === 'number') return value;
  if (value && typeof value._value === 'number') return value._value;
  if (value && typeof value.value === 'number') return value.value;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function pinnedDocument(params = {}, required = true) {
  const requestedId = Number.isInteger(params.document_id) && params.document_id > 0
    ? params.document_id
    : null;
  if (!app.documents || app.documents.length === 0) {
    if (required || requestedId != null) throw new Error('No active document');
    return null;
  }
  const doc = app.activeDocument;
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

function documentSummary(doc) {
  return {
    id: doc.id,
    name: String(doc.title ?? doc.name ?? ''),
    width: Number(doc.width),
    height: Number(doc.height),
  };
}

function contextFor(doc) {
  const layer = Array.from(doc?.activeLayers ?? [])[0] ?? null;
  return {
    document: doc ? documentSummary(doc) : null,
    activeLayer: layer ? { id: layer.id, name: String(layer.name ?? '') } : null,
  };
}

function guideOrientation(guide) {
  return guide.direction === constants.Direction.VERTICAL ? 'VERTICAL' : 'HORIZONTAL';
}

function guideRecord(guide, index, doc, includeNormalized = true) {
  const orientation = guideOrientation(guide);
  const position = Number(guide.coordinate);
  const axisSize = orientation === 'VERTICAL' ? Number(doc.width) : Number(doc.height);
  return {
    index,
    orientation,
    position,
    ...(includeNormalized ? { position_norm: axisSize ? position / axisSize : null } : {}),
  };
}

async function playAction(params = {}) {
  const actionName = String(params.actionName ?? '');
  const actionSetName = String(params.actionSetName ?? '');
  if (!actionName || !actionSetName) throw new Error('actionName and actionSetName are required');
  return core.executeAsModal(
    async () => {
      pinnedDocument(params, false);
      await action.batchPlay(
        [{
          _obj: 'play',
          _target: [
            { _ref: 'action', _name: actionName },
            { _ref: 'actionSet', _name: actionSetName },
          ],
          _options: { dialogOptions: 'dontDisplay' },
        }],
        { synchronousExecution: true }
      );
      return { action: actionName, set: actionSetName };
    },
    { commandName: 'MCP Play Action' }
  );
}

async function readCurrentHistoryState() {
  const [descriptor] = await action.batchPlay(
    [{
      _obj: 'get',
      _target: [{ _ref: 'historyState', _enum: 'ordinal', _value: 'targetEnum' }],
      _options: { dialogOptions: 'dontDisplay' },
    }],
    { synchronousExecution: true }
  );
  if (!descriptor || descriptor._obj === 'error') throw new Error('history_state_unavailable');
  return descriptor;
}

async function redo(params = {}) {
  const requestedSteps = Number.isInteger(params.steps) && params.steps > 0 ? params.steps : 1;
  return core.executeAsModal(
    async () => {
      const doc = pinnedDocument(params, true);
      const current = await readCurrentHistoryState();
      const count = Math.max(0, Math.round(numericValue(current.count) ?? 0));
      const itemIndex = Math.round(numericValue(current.itemIndex) ?? 0);
      const currentIndex = itemIndex > 0 ? itemIndex - 1 : -1;
      if (currentIndex < 0) throw new Error('Could not find current history state');
      const targetIndex = Math.min(Math.max(0, count - 1), currentIndex + requestedSteps);
      const actualSteps = Math.max(0, targetIndex - currentIndex);
      if (actualSteps > 0) {
        await action.batchPlay(
          [{
            _obj: 'select',
            _target: [{ _ref: 'historyState', _index: targetIndex + 1 }],
            _options: { dialogOptions: 'silent' },
          }],
          { synchronousExecution: true }
        );
      }
      const after = await readCurrentHistoryState();
      return {
        redone: true,
        steps: actualSteps,
        currentHistoryState: typeof after.name === 'string' ? after.name : 'Unknown',
        availableRedoSteps: Math.max(0, count - 1 - targetIndex),
        context: contextFor(doc),
      };
    },
    { commandName: 'MCP Redo' }
  );
}

function validateGuides(params = {}) {
  if (!Array.isArray(params.guides) || params.guides.length === 0) {
    throw new Error('guides must be a non-empty array');
  }
  return params.guides.map((guide, index) => {
    const orientation = String(guide?.orientation ?? '').toUpperCase();
    const position = Number(guide?.position);
    if (orientation !== 'HORIZONTAL' && orientation !== 'VERTICAL') {
      throw new Error(`guides[${index}].orientation must be HORIZONTAL or VERTICAL`);
    }
    if (!Number.isFinite(position)) throw new Error(`guides[${index}].position must be a finite number`);
    return { orientation, position };
  });
}

async function addGuides(params = {}) {
  const guides = validateGuides(params);
  return core.executeAsModal(
    async () => {
      const doc = pinnedDocument(params, true);
      const width = Number(doc.width);
      const height = Number(doc.height);
      for (let index = 0; index < guides.length; index++) {
        const guide = guides[index];
        const max = guide.orientation === 'VERTICAL' ? width : height;
        if (guide.position < 0 || guide.position > max) {
          throw new Error(`guide position out of bounds at index ${index}: ${guide.position} (max ${max})`);
        }
      }
      const added = [];
      for (const guide of guides) {
        const direction = guide.orientation === 'VERTICAL'
          ? constants.Direction.VERTICAL
          : constants.Direction.HORIZONTAL;
        await doc.guides.add(direction, guide.position);
        const max = guide.orientation === 'VERTICAL' ? width : height;
        added.push({
          orientation: guide.orientation,
          position: guide.position,
          position_norm: max ? guide.position / max : null,
        });
      }
      return {
        ok: true,
        added,
        guide_count: doc.guides.length,
        document: documentSummary(doc),
      };
    },
    { commandName: 'MCP Add Guides' }
  );
}

async function listGuides(params = {}) {
  const doc = pinnedDocument(params, true);
  const guides = Array.from(doc.guides ?? []).map((guide, index) => guideRecord(guide, index, doc, true));
  return {
    ok: true,
    guides,
    guide_count: guides.length,
    document: documentSummary(doc),
  };
}

async function clearGuides(params = {}) {
  const requested = params.indices === undefined ? null : params.indices;
  if (requested !== null && !Array.isArray(requested)) throw new Error('indices must be an array');
  return core.executeAsModal(
    async () => {
      const doc = pinnedDocument(params, true);
      const removed = [];
      if (requested === null) {
        const snapshot = Array.from(doc.guides ?? []);
        for (let index = snapshot.length - 1; index >= 0; index--) {
          removed.push(guideRecord(snapshot[index], index, doc, false));
        }
        await doc.guides.removeAll();
      } else {
        const unique = new Set();
        const indices = requested.map((value, index) => {
          const number = Number(value);
          if (!Number.isInteger(number) || number < 0) throw new Error(`indices[${index}] must be a non-negative integer`);
          if (unique.has(number)) throw new Error(`guide index ${number} is duplicated`);
          unique.add(number);
          return number;
        }).sort((a, b) => b - a);
        for (const index of indices) {
          if (index < 0 || index >= doc.guides.length) throw new Error(`guide index out of range: ${index}`);
          const guide = doc.guides[index];
          removed.push(guideRecord(guide, index, doc, false));
          await guide.delete();
        }
      }
      return {
        ok: true,
        removed,
        removed_count: removed.length,
        guide_count: doc.guides.length,
      };
    },
    { commandName: 'MCP Clear Guides' }
  );
}

async function tryHandleP3UtilityOperation(cmdAction, params = {}) {
  switch (cmdAction) {
    case 'play_action': return { handled: true, data: await playAction(params) };
    case 'redo': return { handled: true, data: await redo(params) };
    case 'add_guides': return { handled: true, data: await addGuides(params) };
    case 'list_guides': return { handled: true, data: await listGuides(params) };
    case 'clear_guides': return { handled: true, data: await clearGuides(params) };
    default: return { handled: false };
  }
}

module.exports = { tryHandleP3UtilityOperation };
