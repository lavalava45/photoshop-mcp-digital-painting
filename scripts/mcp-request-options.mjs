const DEFAULT_MCP_REQUEST_TIMEOUT_MS = 180_000;

export function getMcpRequestTimeoutMs() {
  const raw = Number(process.env.PHOTOSHOP_MCP_REQUEST_TIMEOUT_MS);
  if (Number.isFinite(raw) && raw > 0) return Math.trunc(raw);
  return DEFAULT_MCP_REQUEST_TIMEOUT_MS;
}

export function mcpRequestOptions(overrides = {}) {
  return {
    timeout: getMcpRequestTimeoutMs(),
    ...overrides,
  };
}

export function callToolWithTimeout(client, params, overrides = {}) {
  return client.callTool(params, undefined, mcpRequestOptions(overrides));
}
