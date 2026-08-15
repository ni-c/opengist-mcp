export interface Config {
  /**
   * Root URL of the Opengist instance without a trailing slash, e.g.
   * `https://gist.example.com`. May be undefined together with the token: the
   * server still starts and lists its tools, every API call then fails with
   * {@link missingConfigMessage}.
   */
  url: string | undefined;
  /** API base, i.e. `url` + `/api`. Undefined whenever `url` is. */
  baseUrl: string | undefined;
  token: string | undefined;
  /** When true, no write tools are registered at all. */
  readOnly: boolean;
  insecureTls: boolean;
}

/** Shown when the configuration is incomplete — at startup and on every API call. */
export function missingConfigMessage(missing: string[]): string {
  return (
    `missing required environment variable(s): ${missing.join(', ')}\n` +
    'Required: OPENGIST_URL (e.g. https://gist.example.com), OPENGIST_TOKEN\n' +
    'Create a token in the Opengist web UI under Settings → Access Tokens with the\n' +
    'scopes gist:read, gist:write, user:read (and user:write to like/unlike gists).\n' +
    'Optional: OPENGIST_READ_ONLY=true to register only read tools,\n' +
    '          OPENGIST_INSECURE_TLS=true to accept self-signed certificates'
  );
}

/** Names of the required environment variables that are unset in `config`. */
export function missingConfigKeys(config: Config): string[] {
  return [
    !config.url && 'OPENGIST_URL',
    !config.token && 'OPENGIST_TOKEN',
  ].filter((v): v is string => Boolean(v));
}

/**
 * Reads the configuration from environment variables.
 *
 * Missing credentials are only a warning, not a fatal error: the server must be
 * able to complete the MCP handshake and answer `tools/list` without them, so
 * registries and sandbox inspectors can introspect it. A malformed URL still
 * exits — that one could send the token to the wrong host.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const rawUrl = env.OPENGIST_URL;
  const token = env.OPENGIST_TOKEN;
  const readOnly = env.OPENGIST_READ_ONLY === 'true';
  const insecureTls = env.OPENGIST_INSECURE_TLS === 'true';

  const missing = [
    !rawUrl && 'OPENGIST_URL',
    !token && 'OPENGIST_TOKEN',
  ].filter((v): v is string => Boolean(v));

  if (missing.length > 0) {
    console.error(`opengist-mcp: ${missingConfigMessage(missing)}`);
  }

  if (!rawUrl) {
    return {
      url: undefined,
      baseUrl: undefined,
      token,
      readOnly,
      insecureTls,
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    console.error(`opengist-mcp: OPENGIST_URL is not a valid URL: ${rawUrl}`);
    process.exit(1);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    console.error(
      `opengist-mcp: OPENGIST_URL must use http:// or https:// (got ${parsed.protocol})`
    );
    process.exit(1);
  }
  // Credentials in the URL would be sent to the host on every request in
  // addition to the bearer token, and would show up in error messages.
  if (parsed.username !== '' || parsed.password !== '') {
    console.error(
      'opengist-mcp: OPENGIST_URL must not contain a username or password'
    );
    process.exit(1);
  }
  if (parsed.protocol === 'http:' && !isLoopbackHost(parsed.hostname)) {
    console.error(
      'opengist-mcp: WARNING: OPENGIST_URL uses plain http to a non-local host — ' +
        'the access token and all gist contents will be sent unencrypted. Use https:// instead.'
    );
  }
  if (token !== undefined && !token.startsWith('og_')) {
    console.error(
      'opengist-mcp: WARNING: OPENGIST_TOKEN does not start with "og_" — Opengist ' +
        'Personal Access Tokens do. Check that this is an access token and not a password.'
    );
  }

  // Tolerate an URL that already points at the API root instead of appending
  // a second /api to it.
  const url = rawUrl.replace(/\/+$/, '').replace(/\/api$/, '');

  const config: Config = {
    url,
    baseUrl: `${url}/api`,
    token,
    readOnly,
    insecureTls,
  };

  // Don't keep the token in the environment for the process lifetime
  // (visible to child processes and in /proc/<pid>/environ).
  delete env.OPENGIST_TOKEN;

  return config;
}

function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.startsWith('127.') ||
    hostname === '::1' ||
    hostname === '[::1]'
  );
}
