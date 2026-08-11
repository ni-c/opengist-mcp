import { z } from 'zod';

// The negative lookahead rejects "." and ".." — encodeURIComponent leaves dots
// untouched, so a bare dot segment would be normalized away by the URL parser
// and escape the intended API path.
export const gistId = z
  .string()
  .min(1)
  .max(64)
  .regex(
    /^(?!\.\.?$)[A-Za-z0-9_-]+$/,
    'must be a gist ID (letters, digits, "-", "_")'
  )
  .describe(
    'ID of the gist — the "id" field returned by list_gists/search_gists, not its title'
  );

// Opengist rejects anything but a hex SHA here: "HEAD" returns HTTP 400.
export const sha = z
  .string()
  .regex(
    /^[0-9a-fA-F]{4,40}$/,
    'must be a hex commit SHA (4-40 hex characters); "HEAD" is not accepted by the API'
  )
  .describe(
    'Full or partial hex commit SHA (see list_gist_commits). Omit for the latest revision.'
  );

// Gists are flat, so a slash in a filename can only be a mistake or an attempt
// to escape the API path.
export const filename = z
  .string()
  .min(1)
  .max(255)
  .regex(
    // eslint-disable-next-line no-control-regex
    /^(?!\.\.?$)[^/\\\x00-\x1f]+$/,
    'must be a plain filename without "/", "\\" or control characters (gists are flat)'
  )
  .refine((v) => v.trim() === v, 'must not start or end with whitespace')
  .describe('Name of a file inside the gist, e.g. "main.go"');

export const username = z
  .string()
  .min(1)
  .max(64)
  .regex(
    /^(?!\.\.?$)[A-Za-z0-9._-]+$/,
    'must be a username (letters, digits, ".", "-", "_")'
  )
  .describe('Opengist username, e.g. "alice"');

export const visibility = z
  .enum(['public', 'unlisted', 'private'])
  .describe(
    'public = listed and world-readable, unlisted = readable by URL but not listed, private = only the owner'
  );

export const gistScope = z
  .enum(['mine', 'public', 'liked', 'forked'])
  .describe(
    'mine = the gists of the token owner (or of `username`); public = every public gist on the instance; ' +
      'liked/forked = gists liked/forked by the token owner (or by `username`)'
  );

export const page = z
  .number()
  .int()
  .min(1)
  .optional()
  .describe(
    'Page number to return, 1-based (see the pagination in the result)'
  );

export const perPage = z
  .number()
  .int()
  .min(1)
  .max(100)
  .optional()
  .describe('Items per page (1-100, default 30)');

export const since = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2}))?$/,
    'must be an RFC 3339 timestamp, e.g. 2026-01-01T00:00:00Z'
  )
  .optional()
  .describe('Only return gists updated at or after this RFC 3339 timestamp');

/** Builds the path of a gist resource, e.g. `/gists/abc123/commits`. */
export function gistPath(id: string, suffix = ''): string {
  return `/gists/${encodeURIComponent(id)}${suffix}`;
}

/** Builds the raw file path, e.g. `/gists/abc/files/9f2c1ab/main.go`. */
export function rawFilePath(id: string, sha: string, name: string): string {
  return `/gists/${encodeURIComponent(id)}/files/${encodeURIComponent(sha)}/${encodeURIComponent(name)}`;
}

/** Appends a query string built from the defined entries only. */
export function withQuery(
  path: string,
  params: Record<string, string | number | undefined>
): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) query.set(key, String(value));
  }
  return query.size > 0 ? `${path}?${query.toString()}` : path;
}
