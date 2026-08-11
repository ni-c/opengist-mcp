#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { loadConfig } from './config.js';
import { createServer } from './server.js';

async function main(): Promise<void> {
  const config = loadConfig();

  if (config.insecureTls) {
    console.error(
      'opengist-mcp: OPENGIST_INSECURE_TLS=true — TLS certificate validation is disabled for the Opengist connection'
    );
  }

  const server = createServer(config);
  await server.connect(new StdioServerTransport());
  console.error(
    `opengist-mcp: connected, targeting ${config.baseUrl}${config.readOnly ? ' (read-only: no write tools registered)' : ''}`
  );
}

main().catch((error: unknown) => {
  console.error(
    `opengist-mcp: fatal error: ${error instanceof Error ? error.message : String(error)}`
  );
  process.exit(1);
});
