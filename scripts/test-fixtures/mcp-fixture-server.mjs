import fs from 'node:fs';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const logFile = process.env.PHOTOSHOP_MCP_FIXTURE_LOG;
if (!logFile) throw new Error('PHOTOSHOP_MCP_FIXTURE_LOG is required');

function log(event, extra = {}) {
  fs.appendFileSync(logFile, `${JSON.stringify({ event, pid: process.pid, at: Date.now(), ...extra })}\n`, 'utf8');
}

log('start');

const server = new Server(
  { name: 'photoshop-mcp-test-fixture', version: '1.0.0' },
  { capabilities: { tools: {} }, instructions: 'fixture' }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  log('list_tools');
  return {
    tools: [
      { name: 'fixture_echo', description: 'Echo fixture', inputSchema: { type: 'object', properties: { value: {} } } },
      { name: 'fixture_disconnect', description: 'Drop transport before reply', inputSchema: { type: 'object', properties: {} } },
      {
        name: 'photoshop_save_document',
        description: 'Delayed fixture operation used by controller interruption tests',
        inputSchema: {
          type: 'object',
          properties: {
            document_id: { type: 'integer' },
            path: { type: 'string' },
            format: { type: 'string' },
            delay_ms: { type: 'integer' },
          },
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async request => {
  const name = request.params.name;
  log('call_tool', { name, arguments: request.params.arguments ?? {} });
  if (name === 'fixture_disconnect') {
    setImmediate(() => process.exit(17));
    await new Promise(() => {});
  }
  if (name === 'photoshop_save_document') {
    const delayMs = Math.max(0, Math.min(5_000, Number(request.params.arguments?.delay_ms ?? 400)));
    await new Promise(resolve => setTimeout(resolve, delayMs));
    return {
      content: [{ type: 'text', text: JSON.stringify({ ok: true, fixture: true, pid: process.pid, delay_ms: delayMs }) }],
    };
  }
  if (name !== 'fixture_echo') throw new Error(`Unknown fixture tool ${name}`);
  return {
    content: [{ type: 'text', text: JSON.stringify({ ok: true, pid: process.pid, value: request.params.arguments?.value ?? null }) }],
  };
});

const transport = new StdioServerTransport();
await server.connect(transport);
