import { internalHostKind } from 'mcp-internal-hosts';

import { describeValue, firstNonPrintable } from './text.js';

/**
 * The shape an access token has to have to travel in a header: visible ASCII,
 * one to 1024 characters. Not the `og_` + hex form Opengist documents — that
 * is a warning below, because a future release may change it — but the one
 * property HTTP itself enforces, checked here so that HTTP never gets to. A
 * wrapped paste with a line break in the middle is what fails this.
 */
const MAX_TOKEN_CHARS = 1024;

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
  // Described, not quoted: this variable sits in the same block as the token
  // in every compose file, and a value that is neither "true" nor "false" is
  // what a token pasted into the wrong line looks like.
  console.error(
    `opengist-mcp: ELICITATION must be "true" or "false" — got ${describeValue(raw ?? '')}. ` +
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
  // Trimmed: `$(cat token)` leaves a trailing newline, which is a mistake the
  // Headers constructor forgives and one inside the value is not.
  const trimmedToken = env.OPENGIST_TOKEN?.trim();
  const token = trimmedToken === '' ? undefined : trimmedToken;
  // Deliberately generous, and deliberately not the same test as the line
  // below. This switch takes capability away, so every spelling an operator
  // plausibly means has to work: `=1` or `=yes` that quietly left every write
  // tool registered is a protection somebody believes they have and does not.
  // OPENGIST_INSECURE_TLS grants something instead — it turns certificate
  // verification off — so there the strict comparison is the safe direction and
  // an unrecognised value must fail towards verifying.
  const readOnly = /^(1|true|yes)$/i.test(env.OPENGIST_READ_ONLY?.trim() ?? '');
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

  if (token !== undefined) {
    const position = firstNonPrintable(token);
    if (position !== -1 || token.length > MAX_TOKEN_CHARS) {
      // The value is never printed. Its length and the position of the first
      // character HTTP would refuse are enough to find a wrapped paste, and
      // the message undici would otherwise produce quotes the whole header.
      console.error(
        position !== -1
          ? `opengist-mcp: OPENGIST_TOKEN is ${describeValue(token)} with a character outside printable ASCII at position ${position} — a line break inside a pasted token is the usual cause. Refusing to start.`
          : `opengist-mcp: OPENGIST_TOKEN is ${describeValue(token)}; an access token is at most ${MAX_TOKEN_CHARS}. Refusing to start.`
      );
      process.exit(1);
    }
  }

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
    // The scheme is not echoed: a hexadecimal key with a colon after it is a
    // valid URL whose scheme is the key.
    console.error(
      'opengist-mcp: OPENGIST_URL must use http:// or https://, and uses another scheme'
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

  // Stored from the parsed URL rather than as the raw string: a query string
  // or fragment in the value would otherwise be glued in front of every path.
  // Trailing slashes come off in a counted loop — `/\/+$/` is tried from every
  // position of a run of slashes that is not at the end, and costs 1.6 s at
  // 80 000 of them — and a trailing `/api` is accepted and removed rather
  // than producing `/api/api`.
  if (parsed.search !== '' || parsed.hash !== '') {
    console.error(
      'opengist-mcp: WARNING: OPENGIST_URL carried a query string or fragment, which was ignored'
    );
  }
  let end = parsed.pathname.length;
  while (end > 0 && parsed.pathname.charCodeAt(end - 1) === 0x2f) end--;
  let pathname = parsed.pathname.slice(0, end);
  if (pathname.endsWith('/api')) pathname = pathname.slice(0, -4);
  const url = `${parsed.origin}${pathname}`;

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
