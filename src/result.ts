import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { OpengistApiError } from './api.js';

export function textResult(text: string): CallToolResult {
  return { content: [{ type: 'text', text }] };
}

/** Hard ceiling on a single tool result, as a backstop behind the per-tool caps. */
const MAX_RESULT_BYTES = 400_000;

/**
 * Serializes a result, stripping file contents if the payload is still
 * pathologically large after the per-tool truncation.
 */
export function jsonResult(data: unknown): CallToolResult {
  const text = JSON.stringify(data, null, 2);
  if (text.length <= MAX_RESULT_BYTES) return textResult(text);

  const stripped = JSON.stringify(
    data,
    (key, value: unknown) =>
      key === 'content' && typeof value === 'string'
        ? '(omitted: result too large)'
        : value,
    2
  );
  return textResult(
    `${stripped}\n\nNote: the result exceeded ${MAX_RESULT_BYTES} characters, so file contents were dropped. Fetch them individually with get_gist_file.`
  );
}

export function errorResult(text: string): CallToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}

const MAX_ERROR_BODY_LENGTH = 2000;

/**
 * Limits what an upstream error body can inject into the model context:
 * HTML error pages (reverse proxies, WAFs) are dropped entirely and other
 * bodies are truncated.
 */
function sanitizeErrorBody(body: string): string {
  const trimmed = body.trim();
  // Anything markup-shaped: a reverse proxy's error page or a WAF block page.
  // The check is deliberately loose — an XML declaration, a leading comment or
  // a doctype followed by a newline are all the same thing here.
  if (/^(<!doctype|<html[\s>]|<\?xml|<!--)/i.test(trimmed)) {
    return '(HTML error page omitted)';
  }
  if (trimmed.length > MAX_ERROR_BODY_LENGTH) {
    return `${trimmed.slice(0, MAX_ERROR_BODY_LENGTH)}… (truncated)`;
  }
  return trimmed;
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
  fn: () => Promise<CallToolResult>
): Promise<CallToolResult> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof ToolInputError) {
      return errorResult(error.message);
    }
    if (error instanceof OpengistApiError) {
      return errorResult(
        `${error.message}\n${sanitizeErrorBody(error.body)}${hintFor(error.status)}`
      );
    }
    const message = error instanceof Error ? error.message : String(error);
    return errorResult(`opengist-mcp: ${message}`);
  }
}
