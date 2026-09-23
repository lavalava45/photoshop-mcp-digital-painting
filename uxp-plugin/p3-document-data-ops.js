const photoshop = require('photoshop');
const { localFileSystem, types } = require('uxp').storage;

const { action, app, constants, core } = photoshop;

function fileUrlFromNativePath(nativePath, operation) {
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

function requestedDocumentId(params = {}) {
  return Number.isInteger(params.document_id) && params.document_id > 0
    ? params.document_id
    : null;
}

function requirePinnedActiveDocument(params = {}, operation = 'operation') {
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
      `document_not_active: pinned document ${requestedId} is open but not active; active document was not changed for ${operation}`
    );
  }
  return doc;
}

function verifyOptionalPinnedDocument(params = {}, operation = 'operation') {
  if (requestedDocumentId(params) == null) return;
  requirePinnedActiveDocument(params, operation);
}

function throwBatchPlayError(result, operationName) {
  const first = Array.isArray(result) ? result[0] : null;
  if (first && String(first._obj ?? '').toLowerCase() === 'error') {
    throw new Error(first.message || `${operationName} failed`);
  }
}

function normalizedBounds(bounds) {
  if (!bounds) return null;
  const left = Number(bounds.left);
  const top = Number(bounds.top);
  const right = Number(bounds.right);
  const bottom = Number(bounds.bottom);
  if (![left, top, right, bottom].every(Number.isFinite)) return null;
  return { left, top, right, bottom };
}

function contextSnapshot(doc) {
  const context = { hasDocument: Boolean(doc) };
  if (!doc) return context;
  context.document = {
    id: doc.id,
    name: doc.name,
    width: doc.width,
    height: doc.height,
    resolution: doc.resolution,
    colorMode: String(doc.mode),
    layerCount: Array.from(doc.layers ?? []).length,
  };
  const layer = Array.from(doc.activeLayers ?? [])[0] ?? null;
  if (layer) {
    context.activeLayer = {
      name: layer.name,
      kind: String(layer.kind),
      opacity: layer.opacity,
      blendMode: String(layer.blendMode),
      visible: layer.visible,
      locked: layer.locked,
      isBackground: layer.isBackgroundLayer === true,
    };
  } else {
    context.activeLayer = null;
  }
  return context;
}

async function getDataSetDescriptor(index) {
  const result = await action.batchPlay(
    [{
      _obj: 'get',
      _target: [{ _ref: 'dataSetClass', _index: index }],
      _options: { dialogOptions: 'dontDisplay' },
    }],
    { synchronousExecution: true }
  );
  const first = result?.[0] ?? null;
  if (!first || String(first._obj ?? '').toLowerCase() === 'error') return null;
  return first;
}

async function listDataSetsRecord(params = {}) {
  requirePinnedActiveDocument(params, 'list_datasets');
  const datasets = [];
  for (let index = 1; index <= 10000; index++) {
    const descriptor = await getDataSetDescriptor(index);
    if (!descriptor) break;
    const name = typeof descriptor.name === 'string'
      ? descriptor.name
      : typeof descriptor.dataSetName === 'string'
        ? descriptor.dataSetName
        : null;
    if (!name) break;
    datasets.push(name);
  }

  let active = null;
  try {
    const result = await action.batchPlay(
      [{
        _obj: 'get',
        _target: [{ _ref: 'dataSetClass', _enum: 'ordinal', _value: 'targetEnum' }],
        _options: { dialogOptions: 'dontDisplay' },
      }],
      { synchronousExecution: true }
    );
    const descriptor = result?.[0];
    if (descriptor && String(descriptor._obj ?? '').toLowerCase() !== 'error') {
      active = typeof descriptor.name === 'string'
        ? descriptor.name
        : typeof descriptor.dataSetName === 'string'
          ? descriptor.dataSetName
          : null;
    }
  } catch {}

  return { datasets, active, count: datasets.length };
}

async function listDataSets(params = {}) {
  return listDataSetsRecord(params);
}

async function importDataSets(params = {}) {
  const xmlPath = typeof params.xml_path === 'string' ? params.xml_path.trim() : '';
  if (!xmlPath) throw new Error('xml_path parameter is required');
  const entry = await localFileSystem.getEntryWithUrl(fileUrlFromNativePath(xmlPath, 'import_datasets'));
  if (!entry || entry.isFile === false) {
    throw new Error(`variables_xml_not_found: ${xmlPath}`);
  }
  const token = await localFileSystem.createSessionToken(entry);

  await core.executeAsModal(
    async () => {
      requirePinnedActiveDocument(params, 'import_datasets');
      const result = await action.batchPlay(
        [{
          _obj: 'importDataSets',
          _target: [{ _ref: 'dataSetClass' }],
          using: { _path: token, _kind: 'local' },
          encoding: { _enum: 'dataSetEncoding', _value: 'dataSetEncodingAuto' },
          eraseAll: true,
          useFirstColumn: true,
          _options: { dialogOptions: 'dontDisplay' },
        }],
        { synchronousExecution: true }
      );
      throwBatchPlayError(result, 'import_datasets');
    },
    { commandName: 'MCP Import Data Sets' }
  );

  const listed = await listDataSetsRecord(params);
  return {
    imported: true,
    xml_path: xmlPath,
    count: listed.count,
    datasets: listed.datasets,
  };
}

function sanitizeDatasetFileName(name) {
  return String(name).replace(/[^a-zA-Z0-9_\-]+/g, '_');
}

function joinNativePath(directory, filename) {
  const base = directory.replace(/[\\/]+$/, '');
  const separator = directory.includes('\\') ? '\\' : '/';
  return `${base}${separator}${filename}`;
}

async function ensureOutputFolder(outputDir) {
  const url = fileUrlFromNativePath(outputDir, 'generate_from_datasets');
  try {
    const existing = await localFileSystem.getEntryWithUrl(url);
    if (!existing || existing.isFolder === false) {
      throw new Error(`output_dir_not_writable: ${outputDir}`);
    }
    return existing;
  } catch (error) {
    try {
      return await localFileSystem.createEntryWithUrl(url, { type: types.folder });
    } catch {
      throw new Error(`output_dir_not_writable: ${outputDir}: ${error?.message || String(error)}`);
    }
  }
}

async function applyDataSetByName(name) {
  const result = await action.batchPlay(
    [{
      _obj: 'apply',
      _target: [{ _ref: 'dataSetClass', _name: name }],
      _options: { dialogOptions: 'dontDisplay' },
    }],
    { synchronousExecution: true }
  );
  const first = result?.[0];
  return !(first && String(first._obj ?? '').toLowerCase() === 'error');
}

async function generateFromDataSets(params = {}) {
  const outputDir = typeof params.output_dir === 'string' ? params.output_dir.trim() : '';
  if (!outputDir) throw new Error('output_dir parameter is required');
  const format = String(params.format ?? 'JPEG').toUpperCase();
  if (!['JPEG', 'PNG', 'PSD'].includes(format)) {
    throw new Error(`Unsupported data set export format: ${format}`);
  }
  const names = Array.isArray(params.dataset_names)
    ? params.dataset_names.filter((name) => typeof name === 'string')
    : [];
  if (names.length === 0) {
    throw new Error('No data sets to export — import a variables XML first');
  }
  const outputFolder = await ensureOutputFolder(outputDir);
  const extension = format === 'JPEG' ? 'jpg' : format.toLowerCase();
  const entries = new Map();
  for (const name of names) {
    const filename = `${sanitizeDatasetFileName(name)}.${extension}`;
    entries.set(name, await outputFolder.createFile(filename, { overwrite: true }));
  }

  return core.executeAsModal(
    async () => {
      const doc = requirePinnedActiveDocument(params, 'generate_from_datasets');
      const listed = await listDataSetsRecord(params);
      if (listed.count === 0) {
        throw new Error('no_datasets: active document has no data sets — import a variables XML first');
      }
      const known = new Set(listed.datasets);
      const outputPaths = [];
      const skipped = [];
      for (const name of names) {
        if (!known.has(name) || !(await applyDataSetByName(name))) {
          skipped.push(name);
          continue;
        }
        const entry = entries.get(name);
        if (format === 'JPEG') {
          await doc.saveAs.jpg(entry, { quality: 10, embedColorProfile: true }, true);
        } else if (format === 'PNG') {
          await doc.saveAs.png(entry, {}, true);
        } else {
          await doc.saveAs.psd(entry, { embedColorProfile: true, layers: true }, true);
        }
        outputPaths.push(joinNativePath(outputDir, `${sanitizeDatasetFileName(name)}.${extension}`));
      }
      return {
        exported: outputPaths.length,
        skipped,
        output_paths: outputPaths,
        output_dir: outputDir,
        format,
      };
    },
    { commandName: 'MCP Generate From Data Sets' }
  );
}

async function resizeImage(params = {}) {
  const width = Number(params.width);
  const height = Number(params.height);
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    throw new Error('resize_image requires positive finite width and height');
  }
  return core.executeAsModal(
    async () => {
      const doc = requirePinnedActiveDocument(params, 'resize_image');
      await doc.resizeImage(
        width,
        height,
        undefined,
        constants.InterpolationMethod?.BICUBIC ?? 'bicubic'
      );
      return { width: doc.width, height: doc.height };
    },
    { commandName: 'MCP Resize Image' }
  );
}

async function cropDocument(params = {}) {
  const left = Number(params.left);
  const top = Number(params.top);
  const right = Number(params.right);
  const bottom = Number(params.bottom);
  if (![left, top, right, bottom].every(Number.isFinite) || right <= left || bottom <= top) {
    throw new Error('crop_document requires finite bounds with right > left and bottom > top');
  }
  return core.executeAsModal(
    async () => {
      const doc = requirePinnedActiveDocument(params, 'crop_document');
      await doc.crop({ left, top, right, bottom });
      return { cropped: true, newWidth: doc.width, newHeight: doc.height };
    },
    { commandName: 'MCP Crop Document' }
  );
}

async function placeImage(params = {}) {
  const filePath = typeof params.filePath === 'string' ? params.filePath.trim() : '';
  if (!filePath) throw new Error('place_image requires a non-empty filePath');
  const x = Number.isFinite(params.x) ? Number(params.x) : 0;
  const y = Number.isFinite(params.y) ? Number(params.y) : 0;
  const entry = await localFileSystem.getEntryWithUrl(fileUrlFromNativePath(filePath, 'place_image'));
  if (!entry || entry.isFile === false) throw new Error(`Image file not found: ${filePath}`);
  const token = await localFileSystem.createSessionToken(entry);

  return core.executeAsModal(
    async () => {
      const doc = requirePinnedActiveDocument(params, 'place_image');
      const result = await action.batchPlay(
        [{
          _obj: 'placeEvent',
          null: { _path: token, _kind: 'local' },
          freeTransformCenterState: { _enum: 'quadCenterState', _value: 'QCSAverage' },
          offset: {
            _obj: 'offset',
            horizontal: { _unit: 'pixelsUnit', _value: 0 },
            vertical: { _unit: 'pixelsUnit', _value: 0 },
          },
          _options: { dialogOptions: 'dontDisplay' },
        }],
        { synchronousExecution: true }
      );
      throwBatchPlayError(result, 'place_image');
      const layer = Array.from(doc.activeLayers ?? [])[0] ?? null;
      if (!layer) throw new Error('place_image completed without an active placed layer');
      const before = normalizedBounds(layer.bounds);
      if (before) await layer.translate(x - before.left, y - before.top);
      const after = normalizedBounds(layer.bounds);
      const response = {
        placed: true,
        filePath,
        position: { x, y, semantics: 'absolute_top_left' },
        context: contextSnapshot(doc),
        layerName: layer.name,
      };
      if (after) {
        response.layerBounds = {
          left: after.left,
          top: after.top,
          width: after.right - after.left,
          height: after.bottom - after.top,
        };
      }
      return response;
    },
    { commandName: 'MCP Place Image' }
  );
}

async function imageStack(params = {}) {
  const files = Array.isArray(params.files)
    ? params.files.filter((file) => typeof file === 'string' && file.trim().length > 0)
    : [];
  if (files.length < 2) throw new Error('stack_needs_two_files: image stack requires at least 2 images');
  const stackMode = typeof params.stack_mode === 'string' && params.stack_mode
    ? params.stack_mode
    : 'stackModeMedian';
  const entries = [];
  for (const file of files) {
    try {
      const entry = await localFileSystem.getEntryWithUrl(fileUrlFromNativePath(file, 'image_stack'));
      if (!entry || entry.isFile === false) throw new Error('not a file');
      entries.push(entry);
    } catch {
      throw new Error(`stack_file_not_found: ${file}`);
    }
  }

  return core.executeAsModal(
    async () => {
      verifyOptionalPinnedDocument(params, 'image_stack');
      let base = null;
      for (const entry of entries) {
        const opened = await app.open(entry);
        if (!base) {
          base = opened;
          continue;
        }
        const sourceLayer = Array.from(opened.activeLayers ?? [])[0] ?? null;
        if (!sourceLayer) throw new Error(`image_stack source has no active layer: ${opened.name}`);
        await opened.duplicateLayers([sourceLayer], base);
        await opened.close(constants.SaveOptions?.DONOTSAVECHANGES ?? 'doNotSaveChanges');
      }
      if (!base) throw new Error('image_stack failed to open a base document');
      app.activeDocument = base;

      let result = await action.batchPlay(
        [{
          _obj: 'selectAllLayers',
          _target: [{ _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }],
          _options: { dialogOptions: 'dontDisplay' },
        }],
        { synchronousExecution: true }
      );
      throwBatchPlayError(result, 'image_stack select all layers');
      result = await action.batchPlay(
        [{ _obj: 'newPlacedLayer', _options: { dialogOptions: 'dontDisplay' } }],
        { synchronousExecution: true }
      );
      throwBatchPlayError(result, 'image_stack convert smart object');
      result = await action.batchPlay(
        [{
          _obj: 'set',
          _target: [{ _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }],
          to: {
            _obj: 'smartObject',
            stackMode: { _enum: 'stackMode', _value: stackMode },
          },
          _options: { dialogOptions: 'dontDisplay' },
        }],
        { synchronousExecution: true }
      );
      throwBatchPlayError(result, 'image_stack stack mode');
      const layer = Array.from(base.activeLayers ?? [])[0] ?? null;
      return {
        stacked: true,
        file_count: files.length,
        mode: stackMode,
        layer_name: layer?.name ?? '',
      };
    },
    { commandName: 'MCP Image Stack' }
  );
}

async function tryHandleP3DocumentDataOperation(cmdAction, params = {}) {
  switch (cmdAction) {
    case 'list_datasets':
      return { handled: true, data: await listDataSets(params) };
    case 'import_datasets':
      return { handled: true, data: await importDataSets(params) };
    case 'generate_from_datasets':
      return { handled: true, data: await generateFromDataSets(params) };
    case 'resize_image':
      return { handled: true, data: await resizeImage(params) };
    case 'crop_document':
      return { handled: true, data: await cropDocument(params) };
    case 'place_image':
      return { handled: true, data: await placeImage(params) };
    case 'image_stack':
      return { handled: true, data: await imageStack(params) };
    default:
      return { handled: false };
  }
}

module.exports = { tryHandleP3DocumentDataOperation };
