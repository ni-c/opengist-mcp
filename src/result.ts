import type {
  CallToolResult,
  InputRequiredResult,
} from '@modelcontextprotocol/server';

import { OpengistApiError } from './api.js';
import { cleanText, upstreamText } from './text.js';

export function textResult(text: string): CallToolResult {
  return { content: [{ type: 'text', text }] };
}

/**
 * Hard ceiling on a single tool result, as a backstop behind the per-tool caps.
 * Exported so the tests assert against the real number rather than a copy of it
 * that can drift.
 */
export const MAX_RESULT_BYTES = 400_000;

/**
 * Serializes a result, stripping file contents if the payload is still
 * pathologically large after the per-tool truncation.
 *
 * Stripping only reaches `content` strings, so it does nothing at all for a
 * payload whose bulk is elsewhere — twenty thousand filenames, five hundred
 * fork summaries, a hundred descriptions of a kilobyte each. Every one of those
 * is a gist anybody can push. So the cut at the end is unconditional: this
 * function is the ceiling it claims to be, and a result that has to be cut
 * mid-structure is worth more to the caller as broken JSON with an explanation
 * than as megabytes of well-formed JSON in the model's context.
 */
/**
 * A result built from gist content.
 *
 * Marked, because a gist title, description, filename and git author name are
 * written by whoever pushed the gist. See {@link structured}.
 */
export function untrustedResult(data: Record<string, unknown>): CallToolResult {
  const { untrusted: _untrusted, source: _source, ...rest } = data;
  return jsonResult({
    untrusted: true as const,
    source: 'opengist' as const,
    ...rest,
  });
}

/**
 * A result in both channels, with no marker.
 *
 * For the three tools whose answer is entirely this server's own words: an id
 * it was given, a boolean it computed. The marker has to mean something, and
 * putting it on those would make it noise.
 */
export function jsonResult(raw: Record<string, unknown>): CallToolResult {
  // One walk over every string that leaves, whichever tool built it: control
  // characters out, lone surrogates repaired. See text.ts for why.
  const data = cleanValue(raw) as Record<string, unknown>;
  // Measured on the string that is emitted — the indented text block, which
  // is two to three times the compact form the budget used to measure — so
  // the ceiling is the ceiling of what a client actually receives.
  const text = render(data);
  if (text.length <= MAX_RESULT_BYTES) {
    return structured(data, text);
  }

  const stripped = JSON.parse(
    JSON.stringify(data, (key, value: unknown) =>
      key === 'content' && typeof value === 'string'
        ? '(omitted: result too large)'
        : value
    )
  ) as Record<string, unknown>;
  const withNote = {
    ...stripped,
    notes: [
      ...(Array.isArray(stripped.notes) ? stripped.notes : []),
      `The result exceeded ${MAX_RESULT_BYTES} characters, so file contents were dropped. Fetch them individually with get_gist_file.`,
    ],
  };
  const strippedText = render(withNote);
  if (strippedText.length <= MAX_RESULT_BYTES) {
    return structured(withNote, strippedText);
  }

  // Stripping only reaches `content` strings, so it does nothing at all for a
  // payload whose bulk is elsewhere — twenty thousand filenames, five hundred
  // fork summaries, a hundred descriptions of a kilobyte each. Every one of
  // those is a gist anybody can push.
  //
  // This used to answer with the JSON cut at the ceiling, unparseable but
  // visible. That is no longer an option: `structuredContent` has to parse, the
  // two channels have to carry the same value, and the SDK checks the result
  // against the schema its tool declares. So it is an error, which is the
  // honest description of "there is no answer this size".
  throw new ResultTooLargeError(
    `The result exceeds ${MAX_RESULT_BYTES} characters even after file ` +
      'contents were dropped. Narrow the request — fewer items per page, or ' +
      'get_gist_file for a single file.'
  );
}

/** Raised by {@link jsonResult}; `run` turns it into an error result. */
export class ResultTooLargeError extends Error {}

/**
 * An answer in both channels at once.
 *
 * `structuredContent` is the machine-readable half and the reason every tool
 * here declares an `outputSchema`; the text block stays because the SDK does
 * NOT synthesize one for an object-shaped value, and a client that reads only
 * `content` would otherwise get an empty answer.
 *
 * Where the payload carries gist content, {@link untrustedResult} has already
 * put the marker on it. That marker matters in this channel above all: the
 * notes this server adds are prose in a list, which a client can read but not
 * check, while `untrusted: true` is a field.
 */
function structured(
  data: Record<string, unknown>,
  text: string
): CallToolResult {
  return {
    content: [{ type: 'text', text }],
    structuredContent: data,
  };
}

/** The text block, exactly as it is emitted. */
function render(data: Record<string, unknown>): string {
  return JSON.stringify(data, null, 2);
}

/**
 * Rebuilds a result with every string cleaned. `Object.fromEntries` rather
 * than `out[key] = …`: a key named `__proto__` — legal JSON from any instance
 * — would otherwise set the prototype and drop the field.
 */
function cleanValue(value: unknown): unknown {
  if (typeof value === 'string') return cleanText(value);
  if (Array.isArray(value)) return value.map(cleanValue);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        cleanText(key),
        cleanValue(entry),
      ])
    );
  }
  return value;
}

export function errorResult(text: string): CallToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}

function hintFor(status: number): string {
  switch (status) {
    case 401:
      return (
        '\nHint: check OPENGIST_TOKEN. It must be an Opengist Personal Access Token ' +
        '(Settings → Access Tokens, starts with "og_") and must not have expired.'
      );
    case 403:
      return (
        '\nHint: the token lacks the required scope, or the gist belongs to somebody else. ' +
        'Reading needs gist:read, creating/updating/deleting/forking needs gist:write, ' +
        'liking needs user:write. A 403 can also mean the API is disabled on the instance (api.enabled: false).'
      );
    case 404:
      return (
        '\nHint: the resource does not exist OR it is private and your token cannot see it — ' +
        'Opengist deliberately answers 404 instead of 403 so it does not disclose that a private gist exists. ' +
        'Do not conclude from this that the gist was deleted.'
      );
    case 409:
      return '\nHint: the request conflicts with the current state, e.g. the username is already taken.';
    case 422:
      return (
        '\nHint: the request body failed validation. Common causes: every file needs non-empty content, ' +
        'a gist needs at least one file, and an archived gist cannot be modified.'
      );
    default:
      return '';
  }
}

/** Thrown by tools for problems detected before any request goes out. */
export class ToolInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolInputError';
  }
}

/**
 * Runs a tool handler and converts thrown errors into MCP error results
 * instead of protocol-level failures.
 */
export async function run(
  fn: () => Promise<CallToolResult | InputRequiredResult>
): Promise<CallToolResult | InputRequiredResult> {
  try {
    return await fn();
  } catch (error) {
    if (
      error instanceof ToolInputError ||
      error instanceof ResultTooLargeError
    ) {
      return errorResult(error.message);
    }
    if (error instanceof OpengistApiError) {
      // The body is the instance's text: stripped of control characters,
      // cut, and labelled as such, so the model reads it as a quotation.
      const body = upstreamText(error.body);
      return errorResult(
        `${error.message}${body === '' ? '' : `\n${body}`}${hintFor(error.status)}`
      );
    }
    const message = error instanceof Error ? error.message : String(error);
    return errorResult(`opengist-mcp: ${message}`);
  }
}
