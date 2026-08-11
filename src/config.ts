export interface Config {
  /** Root URL of the Opengist instance without a trailing slash, e.g. `https://gist.example.com` */
  url: string;
  /** API base, i.e. `url` + `/api` */
  baseUrl: string;
  token: string;
  /** When true, no write tools are registered at all. */
  readOnly: boolean;
  insecureTls: boolean;
}

/**
 * Reads the configuration from environment variables and exits the process
 * with a helpful message if a required variable is missing or invalid.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const rawUrl = env.OPENGIST_URL;
  const token = env.OPENGIST_TOKEN;

  const missing = [
    !rawUrl && 'OPENGIST_URL',
    !token && 'OPENGIST_TOKEN',
  ].filter((v): v is string => Boolean(v));

  if (missing.length > 0 || !rawUrl || !token) {
    console.error(
      `opengist-mcp: missing required environment variable(s): ${missing.join(', ')}\n` +
        'Required: OPENGIST_URL (e.g. https://gist.example.com), OPENGIST_TOKEN\n' +
        'Create a token in the Opengist web UI under Settings → Access Tokens with the\n' +
        'scopes gist:read, gist:write, user:read (and user:write to like/unlike gists).\n' +
        'Optional: OPENGIST_READ_ONLY=true to register only read tools,\n' +
        '          OPENGIST_INSECURE_TLS=true to accept self-signed certificates'
    );
    process.exit(1);
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
  if (!token.startsWith('og_')) {
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
    readOnly: env.OPENGIST_READ_ONLY === 'true',
    insecureTls: env.OPENGIST_INSECURE_TLS === 'true',
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
