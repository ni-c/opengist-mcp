import { internalHostKind } from 'mcp-internal-hosts';

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
  /**
   * Whether a client that *can* show a dialog is asked before a guarded tool
   * acts. `ELICITATION=false` turns the dialog off — the guard stays and falls
   * back to the two-call token, so there is no setting in which a guarded call
   * goes unannounced.
   */
  elicitation: boolean;

  insecureTls: boolean; /**
   * Raw value of `OPENGIST_ALLOW_TOOLS` — comma-separated tool names, `list_*`
   * prefixes, or `essential`. Kept unparsed on purpose: this file is a mirror of
   * the environment, and the names can only be checked against the tool
   * catalogue, which `buildToolFilter` does.
   */
  allowTools: string | undefined;
  /** Raw value of `OPENGIST_DENY_TOOLS`, same shape, subtracted from the above. */
  denyTools: string | undefined;
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
 * Reads `ELICITATION` — deliberately unprefixed, and deliberately fatal on
 * anything it does not recognise.
 *
 * Unprefixed: environment variables are process-wide, so this is one switch for
 * every server in the same environment. That is also its risk, which is why a
 * server started with it off says so on its startup line.
 *
 * Fatal: this is the first variable of the family that defaults to *on*. The
 * others fail open on a typo, which is the safe direction for them. Here a typo
 * would leave the dialog running while the operator believes it is off — and an
 * operator who believes that has no way to find out.
 */
export function parseElicitation(raw: string | undefined): boolean {
  const value = raw?.trim().toLowerCase();
  if (value === undefined || value === '' || value === 'true') return true;
  if (value === 'false') return false;
  console.error(
    `opengist-mcp: ELICITATION must be "true" or "false" — got "${raw}". ` +
      'Refusing to start rather than guess.'
  );
  process.exit(1);
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
  const allowTools = env.OPENGIST_ALLOW_TOOLS;
  const denyTools = env.OPENGIST_DENY_TOOLS;

  // Drop the token immediately after reading it, before any branch that can
  // return or exit. Every early exit below is a path where the token *is* set
  // but something else is wrong — a typo in the URL, or the credential-less
  // start that registries use — and leaving it in the environment there would
  // keep it readable in /proc/<pid>/environ and in every child process.
  delete env.OPENGIST_TOKEN;

  // After the delete, deliberately: this one can exit the process, and an exit
  // above would leave the token in the environment for whatever runs next.
  const elicitation = parseElicitation(env.ELICITATION);

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
      elicitation,
      insecureTls,
      allowTools,
      denyTools,
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
    allowTools,
    denyTools,
    readOnly,
    elicitation,
    insecureTls,
  };
}

function isLoopbackHost(hostname: string): boolean {
  // The shared classifier, so every spelling of a loopback address is
  // recognised — including http://[::ffff:127.0.0.1] and 'localhost.' with its
  // root label, which the string comparison this replaced did not see.
  return internalHostKind(hostname) === 'loopback';
}
