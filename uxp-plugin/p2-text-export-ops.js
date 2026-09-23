const photoshop = require('photoshop');
const { localFileSystem, types } = require('uxp').storage;

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

function requirePinnedActiveDocument(params = {}, operationName = 'text operation') {
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

function requireActiveTextLayer(doc) {
  const layer = Array.from(doc.activeLayers ?? [])[0] ?? null;
  if (!layer || layer.kind !== constants.LayerKind.TEXT) {
    throw new Error('Active layer is not a text layer');
  }
  return layer;
}

function resolveFontPostScriptName(fontName) {
  for (const font of Array.from(app.fonts ?? [])) {
    try {
      if (font.postScriptName === fontName || font.name === fontName) {
        return font.postScriptName;
      }
    } catch {
      // Match legacy behavior: unreadable font entries are skipped.
    }
  }
  return null;
}

async function listFonts(params = {}) {
  const query = typeof params.query === 'string' ? params.query : null;
  const limit = Number.isFinite(params.limit)
    ? Math.max(1, Math.min(1000, Math.trunc(params.limit)))
    : 200;
  const allFonts = Array.from(app.fonts ?? []);
  const fonts = [];
  let truncated = false;

  for (let i = 0; i < allFonts.length; i++) {
    const font = allFonts[i];
    try {
      const entry = {
        name: font.name,
        postScriptName: font.postScriptName,
        family: font.family,
        style: font.style,
      };
      if (query) {
        const q = query.toLowerCase();
        if (
          entry.name.toLowerCase().indexOf(q) < 0 &&
          entry.postScriptName.toLowerCase().indexOf(q) < 0 &&
          entry.family.toLowerCase().indexOf(q) < 0
        ) {
          continue;
        }
      }
      fonts.push(entry);
      if (fonts.length >= limit) {
        truncated = i < allFonts.length - 1;
        break;
      }
    } catch {
      // Match legacy behavior: skip malformed/unreadable entries.
    }
  }

  return { fonts, total: allFonts.length, truncated };
}

async function setTextFont(params = {}) {
  const fontName = typeof params.fontName === 'string' ? params.fontName : '';
  const postScriptName = resolveFontPostScriptName(fontName);
  if (!postScriptName) throw new Error(`font_not_found: ${fontName}`);
  const requestedFontSize = params.fontSize === undefined
    ? undefined
    : Number(params.fontSize);
  if (requestedFontSize !== undefined && (!Number.isFinite(requestedFontSize) || requestedFontSize <= 0)) {
    throw new Error('fontSize must be a positive number');
  }

  return core.executeAsModal(
    async () => {
      const doc = requirePinnedActiveDocument(params, 'set_text_font');
      const layer = requireActiveTextLayer(doc);
      const style = layer.textItem.characterStyle;
      style.font = postScriptName;
      if (requestedFontSize !== undefined) {
        style.size = requestedFontSize * doc.resolution / 72;
      }
      const currentPoints = Number(style.size) * 72 / doc.resolution;
      return {
        font: style.font,
        size: requestedFontSize !== undefined ? requestedFontSize : currentPoints,
      };
    },
    { commandName: 'MCP Set Text Font' }
  );
}

async function setTextColor(params = {}) {
  const red = Number(params.red);
  const green = Number(params.green);
  const blue = Number(params.blue);
  if (![red, green, blue].every((value) => Number.isFinite(value) && value >= 0 && value <= 255)) {
    throw new Error('Text RGB values must be numbers from 0 to 255');
  }

  return core.executeAsModal(
    async () => {
      const doc = requirePinnedActiveDocument(params, 'set_text_color');
      const layer = requireActiveTextLayer(doc);
      const color = new app.SolidColor();
      color.rgb.red = red;
      color.rgb.green = green;
      color.rgb.blue = blue;
      layer.textItem.characterStyle.color = color;
      return { color: `RGB(${red}, ${green}, ${blue})` };
    },
    { commandName: 'MCP Set Text Color' }
  );
}

async function setTextAlignment(params = {}) {
  const alignment = String(params.alignment ?? '').toUpperCase();
  const justification = constants.Justification?.[alignment];
  if (justification === undefined) {
    throw new Error(`Unsupported text alignment: ${alignment}`);
  }

  return core.executeAsModal(
    async () => {
      const doc = requirePinnedActiveDocument(params, 'set_text_alignment');
      const layer = requireActiveTextLayer(doc);
      layer.textItem.paragraphStyle.justification = justification;
      return { alignment };
    },
    { commandName: 'MCP Set Text Alignment' }
  );
}

async function updateTextContent(params = {}) {
  const text = typeof params.text === 'string' ? params.text : String(params.text ?? '');
  return core.executeAsModal(
    async () => {
      const doc = requirePinnedActiveDocument(params, 'update_text_content');
      const layer = requireActiveTextLayer(doc);
      layer.textItem.contents = text;
      return { text: layer.textItem.contents };
    },
    { commandName: 'MCP Update Text Content' }
  );
}

function throwBatchPlayError(result, operationName) {
  const first = Array.isArray(result) ? result[0] : null;
  if (first && String(first._obj ?? '').toLowerCase() === 'error') {
    throw new Error(first.message || `${operationName} failed`);
  }
}

async function saveModernFormat(doc, entry, format, quality) {
  const token = await localFileSystem.createSessionToken(entry);
  const as = format === 'WEBP'
    ? {
        _obj: 'WebPFormat',
        compression: { _enum: 'WebPCompression', _value: 'compressionLossy' },
        quality,
        includeXMPData: false,
        includeEXIFData: false,
        includePsExtras: false,
      }
    : {
        _obj: 'AVIFFormat',
        colorCompression: { _enum: 'AVIFCompression', _value: 'compressionLossy' },
        colorQuality: quality,
        alphaCompression: { _enum: 'AVIFCompression', _value: 'compressionLossless' },
        colorFormat: { _enum: 'AVIFColorFormat', _value: 'AVIFFormat422' },
        sampleDepth: { _enum: 'AVIFSampleDepth', _value: 'AVIFDepth12bit' },
        encoderSpeed: 6,
        includeXMPData: false,
        includeEXIFData: false,
        includePsExtras: false,
      };
  const result = await action.batchPlay(
    [
      {
        _obj: 'save',
        as,
        in: { _path: token, _kind: 'local' },
        documentID: doc.id,
        copy: true,
        lowerCase: true,
        saveStage: { _enum: 'saveStageType', _value: 'saveBegin' },
        _options: { dialogOptions: 'dontDisplay' },
      },
    ],
    { synchronousExecution: true, modalBehavior: 'execute' }
  );
  throwBatchPlayError(result, `export ${format}`);
}

async function exportAs(params = {}) {
  const filePath = typeof params.path === 'string' ? params.path.trim() : '';
  if (!filePath) throw new Error('path parameter is required');
  const format = String(params.format ?? 'PNG').toUpperCase();
  if (!['PNG', 'JPEG', 'WEBP', 'AVIF'].includes(format)) {
    throw new Error(`Unsupported export format: ${format}`);
  }
  const quality = Number.isFinite(params.quality)
    ? Math.max(0, Math.min(100, Math.round(params.quality)))
    : 80;
  const doc = requirePinnedActiveDocument(params, 'export_as');
  const entry = await localFileSystem.createEntryWithUrl(fileUrlFromNativePath(filePath, 'export_as'), {
    type: types.file,
    overwrite: true,
  });

  if (format === 'WEBP' || format === 'AVIF') {
    try {
      await core.executeAsModal(
        async () => saveModernFormat(doc, entry, format, quality),
        { commandName: `MCP Export ${format}` }
      );
    } catch (error) {
      return {
        ok: false,
        code: 'version_unsupported',
        message: `${format} export not available in this Photoshop build: ${error?.message || String(error)}`,
        suggested_next_tool: 'photoshop_save_document',
      };
    }
    return {
      exported: true,
      path: filePath,
      format,
      method: 'native_save_as',
    };
  }

  await core.executeAsModal(
    async () => {
      if (format === 'PNG') {
        await doc.saveAs.png(entry, {}, true);
      } else {
        const jpegQuality = Math.max(0, Math.min(12, Math.round(quality * 12 / 100)));
        await doc.saveAs.jpg(entry, { quality: jpegQuality }, true);
      }
    },
    { commandName: `MCP Export ${format}` }
  );

  return {
    exported: true,
    path: filePath,
    format,
    method: 'save_for_web',
  };
}

async function tryHandleP2TextExportOperation(cmdAction, params = {}) {
  switch (cmdAction) {
    case 'list_fonts':
      return { handled: true, data: await listFonts(params) };
    case 'set_text_alignment':
      return { handled: true, data: await setTextAlignment(params) };
    case 'set_text_color':
      return { handled: true, data: await setTextColor(params) };
    case 'set_text_font':
      return { handled: true, data: await setTextFont(params) };
    case 'update_text_content':
      return { handled: true, data: await updateTextContent(params) };
    case 'export_as':
      return { handled: true, data: await exportAs(params) };
    default:
      return { handled: false };
  }
}

module.exports = { tryHandleP2TextExportOperation };
