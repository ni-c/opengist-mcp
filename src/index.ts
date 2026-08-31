#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { loadConfig } from './config.js';
import { createServer } from './server.js';
import { ToolFilterError } from './tool-filter.js';

async function main(): Promise<void> {
  const config = loadConfig();

  if (config.insecureTls) {
    console.error(
      'opengist-mcp: OPENGIST_INSECURE_TLS=true — TLS certificate validation is disabled for the Opengist connection'
    );
  }

  let server;
  try {
    server = createServer(config);
  } catch (error) {
    // A bad tool list is operator feedback, not a crash: print the
    // sentence on its own rather than behind "fatal error:".
    if (error instanceof ToolFilterError) {
      console.error(`opengist-mcp: ${error.message}`);
      process.exit(1);
    }
    throw error;
  }
  await server.connect(new StdioServerTransport());
  const readOnlyNote = config.readOnly
    ? ' (read-only: no write tools registered)'
    : '';
  console.error(
    config.baseUrl
      ? `opengist-mcp: connected, targeting ${config.baseUrl}${readOnlyNote}`
      : `opengist-mcp: connected without configuration — tools are listed but every call will fail${readOnlyNote}`
  );
}

// In a container node runs as PID 1 with no default signal disposition, so
// without this handler `docker stop` waits out the grace period and SIGKILLs.
process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));

main().catch((error: unknown) => {
  console.error(
    `opengist-mcp: fatal error: ${error instanceof Error ? error.message : String(error)}`
  );
  process.exit(1);
});
