import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { AxiosError } from "axios";
import { createEtsyClient } from "../../build/etsy-client.js";
import { createEtsyMcpServer } from "../../build/index.js";

export const syntheticKey = "synthetic-key:synthetic-secret";

export function successResponse(config, data) {
  return { data, status: 200, statusText: "OK", headers: {}, config };
}

export function httpError(config, status, data = {}, headers = {}) {
  const response = {
    data,
    status,
    statusText: "Simulated response",
    headers,
    config,
  };
  return new AxiosError(
    "Simulated HTTP failure",
    AxiosError.ERR_BAD_REQUEST,
    config,
    undefined,
    response,
  );
}

export async function withMcp(
  adapter,
  run,
  createServer = createEtsyMcpServer,
) {
  const etsyClient = createEtsyClient(syntheticKey);
  etsyClient.defaults.adapter = adapter;
  const server = createServer(etsyClient);
  const client = new Client(
    { name: "etsy-mcp-test", version: "1.0.0" },
    { capabilities: {} },
  );
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();

  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  try {
    return await run({ client, etsyClient });
  } finally {
    await Promise.all([client.close(), server.close()]);
  }
}

export function mockAdapter(respond, calls = []) {
  return async (config) => {
    calls.push(config);
    return respond(config, calls.length);
  };
}

export function jsonText(result) {
  if (result.content?.[0]?.type !== "text") {
    throw new Error("Expected an MCP text content block.");
  }
  return JSON.parse(result.content[0].text);
}
