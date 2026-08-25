import { internalHostKind } from './hosts.js';

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

  // Drop the token immediately after reading it, before any branch that can
  // return or exit. Every early exit below is a path where the token *is* set
  // but something else is wrong — a typo in the URL, or the credential-less
  // start that registries use — and leaving it in the environment there would
  // keep it readable in /proc/<pid>/environ and in every child process.
  delete env.OPENGIST_TOKEN;

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
    // The value itself is not echoed: this branch fires precisely when the
    // variable does not hold what was expected, and a token pasted into the
    // wrong environment variable would otherwise be printed verbatim into the
    // MCP host's log.
    console.error(
      'opengist-mcp: OPENGIST_URL is not a valid URL (e.g. https://gist.example.com)'
    );
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

  return {
    url,
    baseUrl: `${url}/api`,
    token,
    readOnly,
    insecureTls,
  };
}

function isLoopbackHost(hostname: string): boolean {
  // The shared classifier, so every spelling of a loopback address is
  // recognised — including http://[::ffff:127.0.0.1] and 'localhost.' with its
  // root label, which the string comparison this replaced did not see.
  return internalHostKind(hostname) === 'loopback';
}
