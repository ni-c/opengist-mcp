/**
 * The boundary between what the instance sent and what this server reasons
 * about.
 *
 * Every response used to be a TypeScript cast — `as RawGist` — which is not a
 * check. The output schemas each tool declares *are* checked, by the SDK, on
 * every success path: a `like_count` of `1e999` (`Infinity` after
 * `JSON.parse`), a `title` that is a number, a `topics` that is a string, a
 * `files` entry that is `null` — each of these took a whole listing down with
 * "Output validation error" or a `TypeError` out of a projection, and each is
 * one line in the JSON of an instance, or of a proxy in front of it, or of
 * whatever a mistyped `OPENGIST_URL` lands on.
 *
 * So every record is read here, field by field, into the shape the rest of
 * the code assumes. A field of the wrong type is *absent*, not fatal; a
 * display string is bounded; a number is finite; an identifier has its shape.
 * Nothing here throws except the one case where the whole answer is not an
 * object and saying "{}" would hide the actual problem.
 */

import { redactUrl } from './text.js';

/** Longest display string carried on: a title is 250, a description 1000. */
export const MAX_DISPLAY_CHARS = 2000;
const MAX_TOPICS = 50;
const MAX_TOPIC_CHARS = 200;
const MAX_URL_CHARS = 2048;
const MAX_TIMESTAMP_CHARS = 40;
const MAX_USERNAME_CHARS = 255;

export function objectOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function arrayOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * A string, cut at `max` characters with a note. The cut is on the way *in*:
 * the result budget shortens nothing, so a description a proxy padded to a
 * megabyte would otherwise make every listing that carries it unanswerable.
 */
export function stringOf(
  value: unknown,
  max = MAX_DISPLAY_CHARS
): string | undefined {
  if (typeof value !== 'string') return undefined;
  if (value.length <= max) return value;
  return `${value.slice(0, max).toWellFormed()}… (${value.length - max} more characters omitted)`;
}

/** A string of any length — a file body, which the per-tool budgets cut. */
export function textOf(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** A finite number; `-0` becomes `0` so both result channels say the same. */
export function finiteNumberOf(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value + 0
    : undefined;
}

export function safeIntegerOf(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value)
    ? value + 0
    : undefined;
}

export function booleanOf(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

export function stringArrayOf(
  value: unknown,
  maxItems: number,
  maxChars: number
): string[] {
  const out: string[] = [];
  for (const item of arrayOf(value)) {
    if (typeof item !== 'string') continue;
    const bounded = stringOf(item, maxChars);
    if (bounded !== undefined) out.push(bounded);
    if (out.length >= maxItems) break;
  }
  return out;
}

const SHA = /^[0-9a-f]{4,40}$/i;

/**
 * A commit id with the shape Opengist's own API promises for one. It is
 * spliced into a request path and quoted into a note, so anything else is
 * treated as absent — never sent, never quoted.
 */
export function shaOf(value: unknown): string | undefined {
  return typeof value === 'string' && SHA.test(value) ? value : undefined;
}

export type Visibility = 'public' | 'unlisted' | 'private';
export type VisibilityOrUnknown = Visibility | 'unknown';

const VISIBILITIES = new Set<string>(['public', 'unlisted', 'private']);

/**
 * The instance's visibility word, or `unknown`. A `Map`-shaped check rather
 * than a lookup in an object literal: `constructor` and `__proto__` are
 * strings an instance can send, and an object literal answers them with a
 * function, which a rank comparison turns into `NaN` and `NaN > 0` is `false`
 * — a guard that switches itself off without a sound.
 */
export function visibilityOf(value: unknown): VisibilityOrUnknown {
  return typeof value === 'string' && VISIBILITIES.has(value)
    ? (value as Visibility)
    : 'unknown';
}

/** Order for "does this widen": unknown counts as private, so it is guarded. */
export function visibilityRank(value: VisibilityOrUnknown): number {
  switch (value) {
    case 'public':
      return 2;
    case 'unlisted':
      return 1;
    default:
      return 0;
  }
}

const TIMESTAMP = /^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9:.+\-Z]{1,30}$/;

/**
 * A timestamp as Opengist writes one — a string in ISO 8601 shape, or, as
 * some releases have shipped, a number. Anything else is absent. Only the
 * string form is ever quoted into a sentence.
 */
export function timestampOf(value: unknown): string | number | undefined {
  if (typeof value === 'number') return finiteNumberOf(value);
  if (
    typeof value === 'string' &&
    value.length <= MAX_TIMESTAMP_CHARS &&
    TIMESTAMP.test(value)
  ) {
    return value;
  }
  return undefined;
}

/** The string form only — the one that may be quoted into a sentence. */
export function isoTimestampOf(value: unknown): string | undefined {
  const timestamp = timestampOf(value);
  return typeof timestamp === 'string' ? timestamp : undefined;
}

/** A URL the instance chose, bounded and with any credentials removed. */
export function urlOf(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > MAX_URL_CHARS)
    return undefined;
  return redactUrl(value);
}

export interface RawUser {
  id?: number;
  username?: string;
  login?: string;
  type?: string;
  avatar_url?: string;
  /** Only present on the authenticated caller's own record (`/user`). */
  email?: string;
  created_at?: string | number;
}

export interface RawFile {
  filename?: string;
  language?: string;
  size?: number;
  truncated?: boolean;
  content?: string;
}

export interface RawCommit {
  version?: string;
  author?: { name?: string };
  change_status?: Record<string, number>;
  committed_at?: string | number;
}

export interface RawGist {
  id?: string;
  owner?: RawUser;
  title?: string;
  html_url?: string;
  description?: string;
  visibility?: string;
  like_count?: number;
  fork_count?: number;
  clone_url?: string;
  ssh_url?: string;
  topics?: string[];
  archived?: boolean;
  created_at?: string | number;
  updated_at?: string | number;
  expires_at?: string;
  fork_of?: RawGist;
  forks?: RawGist[];
  files?: Record<string, RawFile>;
  commits?: RawCommit[];
  truncated?: boolean;
}

/** Drops the `undefined` slots, so an absent field is absent. */
function defined<T extends object>(record: {
  [K in keyof T]: T[K] | undefined;
}): T {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined)
  ) as T;
}

export function readUser(value: unknown): RawUser | undefined {
  const record = objectOf(value);
  if (record === undefined) return undefined;
  return defined<RawUser>({
    id: safeIntegerOf(record.id),
    username: stringOf(record.username, MAX_USERNAME_CHARS),
    login: stringOf(record.login, MAX_USERNAME_CHARS),
    type: stringOf(record.type, MAX_USERNAME_CHARS),
    avatar_url: urlOf(record.avatar_url),
    email: stringOf(record.email, MAX_USERNAME_CHARS),
    created_at: timestampOf(record.created_at),
  });
}

/** The four keys Opengist documents for `change_status`. */
const CHANGE_STATUS_KEYS = [
  'files_changed',
  'additions',
  'deletions',
  'total',
] as const;

export function readCommit(value: unknown): RawCommit | undefined {
  const record = objectOf(value);
  if (record === undefined) return undefined;
  const author = objectOf(record.author);
  const status = objectOf(record.change_status);
  const changes: Record<string, number> = {};
  if (status !== undefined) {
    for (const key of CHANGE_STATUS_KEYS) {
      const number = finiteNumberOf(status[key]);
      if (number !== undefined) changes[key] = number;
    }
  }
  const name = stringOf(author?.name, MAX_USERNAME_CHARS);
  return defined<RawCommit>({
    version: shaOf(record.version),
    author: name === undefined ? undefined : { name },
    change_status: Object.keys(changes).length > 0 ? changes : undefined,
    committed_at: timestampOf(record.committed_at),
  });
}

export function readFile(value: unknown): RawFile | undefined {
  const record = objectOf(value);
  if (record === undefined) return undefined;
  return defined<RawFile>({
    filename: stringOf(record.filename, MAX_USERNAME_CHARS),
    language: stringOf(record.language, MAX_USERNAME_CHARS),
    size: safeIntegerOf(record.size),
    truncated: booleanOf(record.truncated),
    content: textOf(record.content),
  });
}

/**
 * Reads a gist record. Related gists — the one this was forked from and the
 * forks — are read one level deep and no further: a chain of `fork_of` an
 * instance nests a hundred thousand deep would otherwise be a stack overflow
 * out of a listing.
 */
function readGistAt(record: Record<string, unknown>, depth: number): RawGist {
  // Built with `Object.fromEntries`, never `files[key] = …`: a file named
  // `__proto__` is one `git push` away, and the assignment form would set
  // the prototype instead of the entry.
  const rawFiles = objectOf(record.files);
  const files =
    rawFiles === undefined
      ? undefined
      : Object.fromEntries(
          Object.entries(rawFiles)
            .map(([key, entry]) => [key, readFile(entry)] as const)
            .filter(
              (pair): pair is readonly [string, RawFile] =>
                pair[1] !== undefined
            )
        );
  const forkOf = depth === 0 ? objectOf(record.fork_of) : undefined;
  return defined<RawGist>({
    id: stringOf(record.id, MAX_USERNAME_CHARS),
    owner: readUser(record.owner),
    title: stringOf(record.title),
    html_url: urlOf(record.html_url),
    description: stringOf(record.description),
    visibility: stringOf(record.visibility, MAX_USERNAME_CHARS),
    like_count: finiteNumberOf(record.like_count),
    fork_count: finiteNumberOf(record.fork_count),
    clone_url: urlOf(record.clone_url),
    ssh_url: urlOf(record.ssh_url),
    topics: Array.isArray(record.topics)
      ? stringArrayOf(record.topics, MAX_TOPICS, MAX_TOPIC_CHARS)
      : undefined,
    archived: booleanOf(record.archived),
    created_at: timestampOf(record.created_at),
    updated_at: timestampOf(record.updated_at),
    expires_at: isoTimestampOf(record.expires_at),
    fork_of: forkOf === undefined ? undefined : readGistAt(forkOf, depth + 1),
    forks:
      depth === 0 && Array.isArray(record.forks)
        ? record.forks
            .map((fork) => objectOf(fork))
            .filter(
              (fork): fork is Record<string, unknown> => fork !== undefined
            )
            .map((fork) => readGistAt(fork, depth + 1))
        : undefined,
    files,
    commits: Array.isArray(record.commits)
      ? record.commits
          .map(readCommit)
          .filter((commit): commit is RawCommit => commit !== undefined)
      : undefined,
    truncated: booleanOf(record.truncated),
  });
}

function describeKind(value: unknown): string {
  if (value === null || value === undefined) return 'an empty body';
  if (Array.isArray(value)) return 'an array';
  return `a ${typeof value} value`;
}

/**
 * A gist from a detail endpoint. Throws when the answer is not an object at
 * all — a proxy's error page with status 200, say — because "{}" would hide
 * the actual problem.
 */
export function readGist(value: unknown, path: string): RawGist {
  const record = objectOf(value);
  if (record === undefined) {
    throw new Error(
      `The Opengist API returned ${describeKind(value)} instead of a gist object for ${path}. ` +
        'Check that OPENGIST_URL points at the Opengist instance itself and not at a proxy or login page.'
    );
  }
  return readGistAt(record, 0);
}

/**
 * A list of gists. Elements that are not objects are counted, not fatal: one
 * bad entry must not cost the model the ninety-nine good ones.
 */
export function readGists(value: unknown): {
  gists: RawGist[];
  skipped: number;
} {
  const gists: RawGist[] = [];
  let skipped = 0;
  for (const entry of arrayOf(value)) {
    const record = objectOf(entry);
    if (record === undefined) {
      skipped++;
      continue;
    }
    gists.push(readGistAt(record, 0));
  }
  return { gists, skipped };
}

export function readCommits(value: unknown): {
  commits: RawCommit[];
  skipped: number;
} {
  const commits: RawCommit[] = [];
  let skipped = 0;
  for (const entry of arrayOf(value)) {
    const commit = readCommit(entry);
    if (commit === undefined) {
      skipped++;
      continue;
    }
    commits.push(commit);
  }
  return { commits, skipped };
}

/** The note a listing adds for the entries it could not read. */
export function skippedNote(skipped: number, noun: string): string | undefined {
  return skipped > 0
    ? `${skipped} ${noun}(s) in the answer were not objects and were skipped.`
    : undefined;
}
