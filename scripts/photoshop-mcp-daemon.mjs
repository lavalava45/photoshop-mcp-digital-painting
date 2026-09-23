#!/usr/bin/env node
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { MCP_DAEMON_PROTOCOL_VERSION } from './lib/mcp-daemon-client.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const runtimeDirectory = process.env.PHOTOSHOP_MCP_DAEMON_RUNTIME || path.join(root, '.photoshop-runtime', 'controller');
const endpoint = process.env.PHOTOSHOP_MCP_DAEMON_ENDPOINT;
const token = process.env.PHOTOSHOP_MCP_DAEMON_TOKEN;
const idleMs = Math.max(60_000, Number(process.env.PHOTOSHOP_MCP_DAEMON_IDLE_MS || 30 * 60_000));

if (!endpoint || !token) throw new Error('Daemon requires PHOTOSHOP_MCP_DAEMON_ENDPOINT and PHOTOSHOP_MCP_DAEMON_TOKEN');
fs.mkdirSync(runtimeDirectory, { recursive: true });

let client = null;
let transport = null;
let diagnostic = '';
let starting = null;
let queue = Promise.resolve();
let idleTimer;
let shuttingDown = false;

function serverInfo() {
  return {
    pid: process.pid,
    mcp_ready: !!client,
    instructions_received: !!client?.getInstructions?.(),
  };
}

async function closeMcp() {
  const heldClient = client;
  client = null;
  transport = null;
  starting = null;
  if (heldClient) await heldClient.close().catch(() => {});
}

async function ensureMcp() {
  if (client) return client;
  if (starting) return await starting;
  starting = (async () => {
    const childEnv = { ...process.env, ANALYTICS_DISABLED: '1', LOG_LEVEL: '3' };
    for (const key of [
      'PHOTOSHOP_MCP_DAEMON_ENDPOINT',
      'PHOTOSHOP_MCP_DAEMON_TOKEN',
      'PHOTOSHOP_MCP_DAEMON_RUNTIME',
      'COS_ASSISTANT_RECEIPT_VERSION',
      'COS_ASSISTANT_MESSAGE_ID',
      'COS_ASSISTANT_MESSAGE_SHA256',
      'COS_ASSISTANT_TURN_ID',
      'COS_ASSISTANT_DELIVERED_AT',
    ]) delete childEnv[key];
    const nextClient = new Client({ name: 'photoshop-persistent-controller-daemon', version: '1.0.0' });
    const serverEntry = process.env.PHOTOSHOP_MCP_SERVER_ENTRY
      ? path.resolve(process.env.PHOTOSHOP_MCP_SERVER_ENTRY)
      : path.join(root, 'dist', 'index.js');
    const nextTransport = new StdioClientTransport({
      command: process.execPath,
      args: [serverEntry],
      cwd: root,
      env: childEnv,
      stderr: 'pipe',
    });
    diagnostic = '';
    nextTransport.stderr?.on('data', chunk => { diagnostic = (diagnostic + chunk.toString()).slice(-8000); });
    try {
      await nextClient.connect(nextTransport, { timeout: 20_000 });
      client = nextClient;
      transport = nextTransport;
      return nextClient;
    } catch (error) {
      await nextClient.close().catch(() => {});
      throw new Error(`${error instanceof Error ? error.message : String(error)}${diagnostic ? `\nServer: ${diagnostic}` : ''}`);
    } finally {
      starting = null;
    }
  })();
  return await starting;
}

function armIdle() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { void shutdown('idle'); }, idleMs);
  idleTimer.unref?.();
}

async function handle(request) {
  if (request.protocol !== MCP_DAEMON_PROTOCOL_VERSION) throw new Error('Unsupported MCP daemon protocol');
  if (request.token !== token) throw new Error('Unauthorized MCP daemon request');
  armIdle();
  if (request.method === 'ping') return { pong: true };
  if (request.method === 'list_tools') {
    const held = await ensureMcp();
    return { result: await held.listTools({}, { timeout: 20_000 }) };
  }
  if (request.method === 'call_tool') {
    if (typeof request.name !== 'string' || !request.name) throw new Error('call_tool requires name');
    const timeoutMs = Number(request.timeout_ms ?? 60_000);
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 180_000) throw new Error('Invalid call_tool timeout');
    const held = await ensureMcp();
    try {
      const deadlineAt = Date.now() + Math.max(500, timeoutMs - 500);
      return {
        result: await held.callTool(
          {
            name: request.name,
            arguments: request.arguments ?? {},
            _meta: { photoshop_mcp_deadline_at: deadlineAt },
          },
          undefined,
          { timeout: timeoutMs }
        ),
      };
    } catch (error) {
      // A thrown call is transport/timeout ambiguity. Never replay it here. Drop the
      // persistent MCP process so the *next* reconciled operation gets a fresh channel.
      await closeMcp();
      throw error;
    }
  }
  if (request.method === 'shutdown') {
    setImmediate(() => { void shutdown('request'); });
    return { shutting_down: true };
  }
  throw new Error(`Unknown MCP daemon method: ${request.method}`);
}

const server = net.createServer(socket => {
  socket.setEncoding('utf8');
  let text = '';
  let answered = false;
  const respond = body => {
    if (answered) return;
    answered = true;
    socket.end(`${JSON.stringify(body)}\n`);
  };
  socket.on('data', chunk => {
    text += chunk;
    const newline = text.indexOf('\n');
    if (newline < 0 || answered) return;
    let request;
    try { request = JSON.parse(text.slice(0, newline)); }
    catch { respond({ ok: false, error: 'Invalid JSON request' }); return; }
    queue = queue.then(async () => {
      try {
        const body = await handle(request);
        respond({ ok: true, id: request.id, ...body, server_info: serverInfo() });
      } catch (error) {
        respond({
          ok: false,
          id: request.id,
          error: error instanceof Error ? error.message : String(error),
          server_info: serverInfo(),
        });
      }
    }).catch(error => respond({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  });
  socket.on('error', () => {});
});

async function shutdown(_reason) {
  if (shuttingDown) return;
  shuttingDown = true;
  clearTimeout(idleTimer);
  await closeMcp();
  await new Promise(resolve => server.close(() => resolve()));
  if (process.platform !== 'win32') fs.rmSync(endpoint, { force: true });
  process.exit(0);
}

process.on('SIGINT', () => { void shutdown('SIGINT'); });
process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
process.on('uncaughtException', async () => { await shutdown('uncaughtException'); });

if (process.platform !== 'win32') fs.rmSync(endpoint, { force: true });
server.listen(endpoint, () => armIdle());
