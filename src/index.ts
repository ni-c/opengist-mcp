#!/usr/bin/env node
import type { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';

import { loadConfig } from './config.js';
import { createServer } from './server.js';
import { ToolFilterError } from 'mcp-tool-allowlist';

async function main(): Promise<void> {
  const config = loadConfig();

  if (config.insecureTls) {
    console.error(
      'opengist-mcp: OPENGIST_INSECURE_TLS=true — TLS certificate validation is disabled for the Opengist connection'
    );
  }

  // Built before anything is served, so a rejected tool filter still ends
  // the process rather than surfacing as a failed handshake once a client
  // has already connected.
  let pending: McpServer | undefined;
  try {
    pending = createServer(config);
  } catch (error) {
    // A bad tool list is operator feedback, not a crash: print the
    // sentence on its own rather than behind "fatal error:".
    if (error instanceof ToolFilterError) {
      console.error(`opengist-mcp: ${error.message}`);
      process.exit(1);
    }
    throw error;
  }
  // `serveStdio` owns the era decision for the connection: the opening
  // exchange selects 2025-11-25 or 2026-07-28 and pins one instance from
  // this factory for its lifetime. A hand-wired `StdioServerTransport`
  // serves only the 2025 era, which is why a negotiating client’s
  // `server/discover` probe was answered with "Method not found".
  //
  // The instance built above serves the first connection; a second call — a
  // modern probe followed by the real connection — builds a fresh one, which
  // is safe because `createServer` only registers tools.
  serveStdio(() => {
    const server = pending ?? createServer(config);
    pending = undefined;
    return server;
  });
  // Printed only when it is off. ELICITATION is unprefixed, so one
  // `export ELICITATION=false` reaches every MCP server in the environment —
  // this line is what makes that visible in the log of each one it actually
  // reached. It is its own line rather than folded into the connection message
  // below, because that message is the one people grep for a URL.
  if (!config.elicitation) {
    console.error(
      'opengist-mcp: ELICITATION=false — guarded tools fall back to the two-call token'
    );
  }
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
