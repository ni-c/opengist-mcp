import { createRequire } from 'node:module';
import { McpServer } from '@modelcontextprotocol/server';
import { buildToolFilter, installToolFilter } from 'mcp-tool-allowlist';

import { ALL_TOOLS, ESSENTIAL_TOOLS, READ_TOOLS } from './tools/catalogue.js';

import { OpengistApi } from './api.js';
import type { Config } from './config.js';
import { ConfirmationStore } from './confirm.js';
import { registerGistReadTools } from './tools/gists.js';
import { registerGistWriteTools } from './tools/gist-write.js';
import { registerSearchTools } from './tools/search.js';
import { registerLikeWriteTools, registerUserTools } from './tools/users.js';

function packageVersion(): string {
  try {
    const require = createRequire(import.meta.url);
    const pkg = require('../package.json') as { version: string };
    return pkg.version;
  } catch {
    return '0.0.0';
  }
}

export function createServer(config: Config): McpServer {
  // Before anything is built: an unusable tool list should fail on the
  // way in, not leave a server running with tools quietly missing.
  const filter = buildToolFilter({
    allowTools: config.allowTools,
    denyTools: config.denyTools,
    catalogue: {
      all: ALL_TOOLS,
      essential: ESSENTIAL_TOOLS,
      ungated: READ_TOOLS,
    },
    names: {
      allow: 'OPENGIST_ALLOW_TOOLS',
      deny: 'OPENGIST_DENY_TOOLS',
      server: 'opengist-mcp',
    },
    gate: {
      closed: config.readOnly,
      variable: 'OPENGIST_READ_ONLY',
      noun: 'read-only mode',
    },
  });

  const api = new OpengistApi(config);

  const server = new McpServer({
    name: 'opengist-mcp',
    version: packageVersion(),
  });

  // Wraps server.registerTool, so it has to sit before the first
  // register call and does not care how they are organised.
  installToolFilter(server, filter);

  registerGistReadTools(server, api);
  registerSearchTools(server, api);
  registerUserTools(server, api);

  // In read-only mode the write tools are not registered at all rather than
  // registered and always failing: an absent tool is visible in tools/list, so
  // the model plans around it instead of retrying against a wall.
  if (!config.readOnly) {
    registerGistWriteTools(server, api, new ConfirmationStore());
    registerLikeWriteTools(server, api);
  }

  return server;
}
