import { PhotoshopConnection } from '../platform/connection.js';

export type APIType = 'ExtendScript';

export interface PhotoshopAPI {
  executeScript(script: string, timeoutMs?: number): Promise<unknown>;
  getAPIType(): APIType;
}

/**
 * Adapter for the explicitly selected legacy fallback backend. UXP execution
 * never enters this factory; semantic tool routing chooses UXP or ExtendScript
 * before dispatch.
 */
export class PhotoshopAPIFactory {
  constructor(private readonly connection: PhotoshopConnection) {}

  async createAPI(): Promise<PhotoshopAPI> {
    if (!this.connection.getPhotoshopInfo()) await this.connection.getVersion();
    return new ExtendScriptPhotoshopAPI(this.connection);
  }
}

class ExtendScriptPhotoshopAPI implements PhotoshopAPI {
  constructor(private readonly connection: PhotoshopConnection) {}

  async executeScript(script: string, timeoutMs?: number): Promise<unknown> {
    return this.connection.executeScript(this.wrapInErrorHandling(script), timeoutMs);
  }

  getAPIType(): APIType {
    return 'ExtendScript';
  }

  private wrapInErrorHandling(script: string): string {
    return `
(function() {
  var __originalRulerUnits = null;
  var __originalTypeUnits = null;
  var __origDialogs = null;
  var __origAlert = null;
  var __origConfirm = null;
  var __origPrompt = null;
  try { __originalRulerUnits = app.preferences.rulerUnits; } catch (e) {}
  try { __originalTypeUnits = app.preferences.typeUnits; } catch (e) {}
  try { __origDialogs = app.displayDialogs; } catch (e) {}
  try { app.displayDialogs = DialogModes.NO; } catch (e) {}
  if (typeof alert !== 'undefined') {
    __origAlert = alert;
    alert = function(msg) { $.writeln('[MCP] ' + msg); };
  }
  if (typeof confirm !== 'undefined') {
    __origConfirm = confirm;
    confirm = function() { $.writeln('[MCP] confirm suppressed'); return true; };
  }
  if (typeof prompt !== 'undefined') {
    __origPrompt = prompt;
    prompt = function(msg, def) { $.writeln('[MCP] prompt suppressed: ' + msg); return def || ''; };
  }
  try {
    try { app.preferences.rulerUnits = Units.PIXELS; } catch (e) {}
    try { app.preferences.typeUnits = TypeUnits.POINTS; } catch (e) {}
    var result = (function() {
      ${script}
    })();
    if (typeof result === 'object' && result !== null) {
      return result.toSource ? result.toSource() : String(result);
    }
    return String(result);
  } catch (error) {
    return 'ERROR: ' + (error.message || String(error));
  } finally {
    try { if (__originalRulerUnits !== null) app.preferences.rulerUnits = __originalRulerUnits; } catch (e) {}
    try { if (__originalTypeUnits !== null) app.preferences.typeUnits = __originalTypeUnits; } catch (e) {}
    try { if (__origDialogs !== null) app.displayDialogs = __origDialogs; } catch (e) {}
    if (__origAlert !== null) { alert = __origAlert; }
    if (__origConfirm !== null) { confirm = __origConfirm; }
    if (__origPrompt !== null) { prompt = __origPrompt; }
  }
})();`.trim();
  }
}
