import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';

const PROTOCOL_VERSION = 1;
const DEFAULT_START_TIMEOUT_MS = 10_000;

export function daemonEndpoint(root, runtimeDirectory) {
  const suffix = createHash('sha256')
    .update(`${path.resolve(root)}\u0000${path.resolve(runtimeDirectory)}`)
    .digest('hex')
    .slice(0, 16);
  if (process.platform === 'win32') return `\\\\.\\pipe\\photoshop-mcp-${suffix}`;
  return path.join(runtimeDirectory, `photoshop-mcp-${suffix}.sock`);
}

export function daemonTokenFile(runtimeDirectory) {
  return path.join(runtimeDirectory, 'mcp-daemon.token');
}

export function ensureDaemonToken(runtimeDirectory) {
  fs.mkdirSync(runtimeDirectory, { recursive: true });
  const file = daemonTokenFile(runtimeDirectory);
  try {
    const existing = fs.readFileSync(file, 'utf8').trim();
    if (/^[0-9a-f]{64}$/i.test(existing)) return existing;
  } catch {}
  const token = randomBytes(32).toString('hex');
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, `${token}\n`, { encoding: 'utf8', mode: 0o600 });
  try {
    fs.renameSync(temp, file);
  } catch {
    fs.rmSync(temp, { force: true });
    const existing = fs.readFileSync(file, 'utf8').trim();
    if (/^[0-9a-f]{64}$/i.test(existing)) return existing;
    throw new Error('Could not establish MCP daemon authentication token');
  }
  return token;
}

function requestOnce(endpoint, payload, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(endpoint);
    let text = '';
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(error);
      else resolve(value);
    };
    const timer = setTimeout(() => finish(new Error(`MCP daemon request timed out after ${timeoutMs} ms`)), timeoutMs);
    timer.unref?.();
    socket.setEncoding('utf8');
    socket.on('connect', () => socket.write(`${JSON.stringify(payload)}\n`));
    socket.on('data', chunk => {
      text += chunk;
      const newline = text.indexOf('\n');
      if (newline < 0) return;
      try {
        const response = JSON.parse(text.slice(0, newline));
        if (!response?.ok) finish(new Error(response?.error || 'MCP daemon request failed'));
        else finish(undefined, response);
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    });
    socket.on('error', error => finish(error));
    socket.on('end', () => {
      if (!settled) finish(new Error('MCP daemon closed the connection without a response'));
    });
  });
}

async function waitForDaemon(endpoint, token, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      return await requestOnce(endpoint, {
        protocol: PROTOCOL_VERSION,
        token,
        id: `ping-${process.pid}-${Date.now()}`,
        method: 'ping',
      }, Math.min(500, Math.max(100, deadline - Date.now())));
    } catch (error) {
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, 75));
    }
  }
  throw new Error(`MCP daemon did not become ready: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

export class PersistentMcpClient {
  constructor({ root, runtimeDirectory, startTimeoutMs = DEFAULT_START_TIMEOUT_MS }) {
    this.root = root;
    this.runtimeDirectory = runtimeDirectory;
    this.startTimeoutMs = startTimeoutMs;
    this.endpoint = daemonEndpoint(root, runtimeDirectory);
    this.token = ensureDaemonToken(runtimeDirectory);
    this.serverInfo = null;
  }

  async ensureDaemon() {
    try {
      const response = await requestOnce(this.endpoint, {
        protocol: PROTOCOL_VERSION,
        token: this.token,
        id: `ping-${process.pid}-${Date.now()}`,
        method: 'ping',
      }, 250);
      this.serverInfo = response.server_info ?? this.serverInfo;
      return response;
    } catch {}

    const child = spawn(process.execPath, [path.join(this.root, 'scripts', 'photoshop-mcp-daemon.mjs')], {
      cwd: this.root,
      detached: true,
      windowsHide: true,
      stdio: 'ignore',
      env: {
        ...process.env,
        PHOTOSHOP_MCP_DAEMON_ENDPOINT: this.endpoint,
        PHOTOSHOP_MCP_DAEMON_TOKEN: this.token,
        PHOTOSHOP_MCP_DAEMON_RUNTIME: this.runtimeDirectory,
        PHOTOSHOP_PREVIEW_BARRIER_DIR: path.join(path.dirname(this.runtimeDirectory), 'preview-barriers'),
        ANALYTICS_DISABLED: '1',
        LOG_LEVEL: '3',
      },
    });
    child.unref();
    const response = await waitForDaemon(this.endpoint, this.token, this.startTimeoutMs);
    this.serverInfo = response.server_info ?? this.serverInfo;
    return response;
  }

  async request(method, body = {}, timeoutMs = 60_000) {
    await this.ensureDaemon();
    try {
      const response = await requestOnce(this.endpoint, {
        protocol: PROTOCOL_VERSION,
        token: this.token,
        id: `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        method,
        ...body,
      }, Math.max(1000, timeoutMs + 1500));
      this.serverInfo = response.server_info ?? this.serverInfo;
      return response;
    } catch (error) {
      // The daemon may have exited between ping and request. Restart is safe here only
      // for read-only daemon control/discovery. A lost call_tool response does not prove
      // Photoshop never started the operation, so mutation-capable calls fail closed and
      // let the durable controller reconcile instead of replaying them.
      const message = error instanceof Error ? error.message : String(error);
      if (method === 'call_tool' || !/ENOENT|ECONNREFUSED|closed the connection/i.test(message)) throw error;
      await this.ensureDaemon();
      return await requestOnce(this.endpoint, {
        protocol: PROTOCOL_VERSION,
        token: this.token,
        id: `${process.pid}-${Date.now()}-retry`,
        method,
        ...body,
      }, Math.max(1000, timeoutMs + 1500));
    }
  }

  async listTools(_params = {}, options = {}) {
    const timeoutMs = Number(options?.timeout ?? 20_000);
    const response = await this.request('list_tools', {}, timeoutMs);
    return response.result;
  }

  async callTool(request, _schema, options = {}) {
    const timeoutMs = Number(options?.timeout ?? 60_000);
    const response = await this.request('call_tool', {
      name: request.name,
      arguments: request.arguments ?? {},
      timeout_ms: timeoutMs,
    }, timeoutMs);
    return response.result;
  }

  getInstructions() {
    return this.serverInfo?.instructions_received ? 'persistent-daemon' : undefined;
  }

  async close() {
    // Intentionally keep the daemon and its MCP stdio child alive for the next controller call.
  }

  async status() {
    return await this.ensureDaemon();
  }

  async shutdown() {
    try {
      return await this.request('shutdown', {}, 2000);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/closed the connection|ECONNRESET|ECONNREFUSED|ENOENT/i.test(message)) {
        return { ok: true, shutting_down: true };
      }
      throw error;
    }
  }
}

export const MCP_DAEMON_PROTOCOL_VERSION = PROTOCOL_VERSION;
