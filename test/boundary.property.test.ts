import type { CallToolResult } from '@modelcontextprotocol/server';
import fc from 'fast-check';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { connect, resultText, stubFetch, textResponse } from './harness.js';

/**
 * The instance's JSON, shaped like an answer and filled with whatever JSON
 * allows, through every read tool and the real server.
 *
 * Three sentences must never appear in a result: the SDK's own "Output
 * validation error" (a schema the projection broke), and the two a TypeError
 * out of a projection produces. And whenever the answer is not an error, the
 * text block has to parse to exactly the structured half.
 *
 * `SHAPE_RUNS=300` for a deep local pass; the CI count stays small.
 */

const RUNS = Number(process.env.SHAPE_RUNS ?? 25);
const LONE_SURROGATE = String.fromCharCode(0xd83d);

const CRASH_SENTENCES = [
  'Output validation error',
  'Cannot read properties',
  'is not a function',
  'Maximum call stack',
  'Invalid time value',
];

/** A leaf where a typed value belongs: the right type, the wrong one, a hole. */
const leaf = fc.oneof(
  fc.double(),
  fc.constant(null),
  fc.constant(undefined),
  fc.string({ maxLength: 40 }),
  fc.string({ maxLength: 40 }).map((s) => `${s}${LONE_SURROGATE}${s}`),
  fc.string({ maxLength: 40 }).map((s) => `${s}${String.fromCharCode(27)}[2J`),
  fc.constant(-(2 ** 53)),
  fc.constant(2 ** 53),
  fc.constant(-0),
  fc.constant('x'.repeat(30_000)),
  fc.constant({ toString: 'constructor' }),
  fc.constantFrom('constructor', '__proto__', 'toString', 'HEAD'),
  fc.constant([]),
  fc.constant({}),
  fc.jsonValue({ maxDepth: 2 })
);

const userShape = fc.oneof(
  leaf,
  fc.record({ id: leaf, username: leaf, login: leaf, avatar_url: leaf })
);

const commitShape = fc.oneof(
  leaf,
  fc.record({
    version: fc.oneof(leaf, fc.stringMatching(/^[0-9a-f]{4,40}$/)),
    author: fc.oneof(leaf, fc.record({ name: leaf })),
    change_status: fc.oneof(
      leaf,
      fc.record({
        additions: leaf,
        deletions: leaf,
        total: leaf,
        injected: leaf,
      })
    ),
    committed_at: leaf,
  })
);

const fileShape = fc.oneof(
  leaf,
  fc.record({
    filename: leaf,
    language: leaf,
    size: leaf,
    content: leaf,
    truncated: leaf,
  })
);

const shallowGist = fc.record({
  id: leaf,
  title: leaf,
  description: leaf,
  owner: userShape,
  visibility: leaf,
  like_count: leaf,
  fork_count: leaf,
  topics: fc.oneof(leaf, fc.array(leaf, { maxLength: 5 })),
  archived: leaf,
  created_at: leaf,
  updated_at: leaf,
  expires_at: leaf,
  html_url: leaf,
  clone_url: leaf,
  files: fc.oneof(
    leaf,
    fc.dictionary(fc.string({ maxLength: 10 }), fileShape, { maxKeys: 4 })
  ),
  commits: fc.oneof(leaf, fc.array(commitShape, { maxLength: 4 })),
  truncated: leaf,
});

const gistShape = shallowGist.chain((gist) =>
  fc
    .record({
      fork_of: fc.oneof(leaf, shallowGist),
      forks: fc.oneof(leaf, fc.array(shallowGist, { maxLength: 3 })),
      __proto__: leaf,
    })
    .map((extra) => ({ ...gist, ...extra }))
);

/** Serialised, with a `1e999` — legal JSON, `Infinity` after parsing — spliced in. */
function serialise(value: unknown, splice: boolean): string {
  const text = JSON.stringify(value === undefined ? null : value);
  return splice ? text.replace(/null/, '1e999') : text;
}

const headerValue = fc.oneof(
  fc.constant(undefined),
  fc.string({ maxLength: 12 }),
  fc.constantFrom('1e300', '0', '-1', '99999999999999999999', ' 7 ', '')
);

function headersOf(
  entries: Record<string, string | undefined>
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(entries).filter(
      (pair): pair is [string, string] => pair[1] !== undefined
    )
  );
}

function check(result: CallToolResult): void {
  const text = resultText(result);
  for (const sentence of CRASH_SENTENCES) {
    expect(text, sentence).not.toContain(sentence);
  }
  expect(text.isWellFormed()).toBe(true);
  if (!result.isError) {
    expect(JSON.parse(text)).toEqual(result.structuredContent);
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('every read tool survives the instance', () => {
  it('list_gists, list_gist_forks and search_gists over a shaped list', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(
          fc.array(gistShape, { maxLength: 4 }),
          fc.jsonValue({ maxDepth: 3 })
        ),
        fc.boolean(),
        fc.record({
          'x-page': headerValue,
          'x-total': headerValue,
          link: headerValue,
        }),
        fc.constantFrom('list_gists', 'list_gist_forks', 'search_gists'),
        async (body, splice, headers, name) => {
          stubFetch(() =>
            textResponse(serialise(body, splice), 200, 'application/json')
          );
          const client = await connect();
          // The stub's content-type header is what the harness sets; the
          // page headers ride alongside it.
          vi.stubGlobal(
            'fetch',
            vi.fn(
              async () =>
                new Response(serialise(body, splice), {
                  status: 200,
                  headers: {
                    'content-type': 'application/json',
                    ...headersOf(headers),
                  },
                })
            )
          );
          const args =
            name === 'search_gists'
              ? { query: 'a' }
              : name === 'list_gist_forks'
                ? { gistId: 'abc123' }
                : {};
          check(
            (await client.callTool({ name, arguments: args })) as CallToolResult
          );
        }
      ),
      { numRuns: RUNS }
    );
  });

  it('get_gist over a shaped record', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(gistShape, fc.jsonValue({ maxDepth: 3 })),
        fc.boolean(),
        fc.boolean(),
        async (body, splice, everything) => {
          stubFetch(() =>
            textResponse(serialise(body, splice), 200, 'application/json')
          );
          const client = await connect();
          check(
            (await client.callTool({
              name: 'get_gist',
              arguments: {
                gistId: 'abc123',
                includeCommits: everything,
                includeForks: everything,
                includeCloneUrls: everything,
              },
            })) as CallToolResult
          );
        }
      ),
      { numRuns: RUNS }
    );
  });

  it('list_gist_commits over a shaped list', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(
          fc.array(commitShape, { maxLength: 4 }),
          fc.jsonValue({ maxDepth: 3 })
        ),
        fc.boolean(),
        async (body, splice) => {
          stubFetch(() =>
            textResponse(serialise(body, splice), 200, 'application/json')
          );
          const client = await connect();
          check(
            (await client.callTool({
              name: 'list_gist_commits',
              arguments: { gistId: 'abc123' },
            })) as CallToolResult
          );
        }
      ),
      { numRuns: RUNS }
    );
  });

  it('get_gist_file over a shaped commit list and an arbitrary raw body', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(
          fc.array(commitShape, { maxLength: 2 }),
          fc.jsonValue({ maxDepth: 2 })
        ),
        fc.string({ maxLength: 200 }),
        fc.integer({ min: 0, max: 50 }),
        async (commits, raw, offset) => {
          stubFetch((url) =>
            url.includes('/commits')
              ? textResponse(JSON.stringify(commits), 200, 'application/json')
              : textResponse(raw)
          );
          const client = await connect();
          check(
            (await client.callTool({
              name: 'get_gist_file',
              arguments: {
                gistId: 'abc123',
                filename: 'a.txt',
                offset,
                maxBytes: 20,
              },
            })) as CallToolResult
          );
        }
      ),
      { numRuns: RUNS }
    );
  });

  it('get_user over a shaped record', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(userShape, fc.jsonValue({ maxDepth: 3 })),
        fc.boolean(),
        async (body, splice) => {
          stubFetch(() =>
            textResponse(serialise(body, splice), 200, 'application/json')
          );
          const client = await connect();
          check(
            (await client.callTool({
              name: 'get_user',
              arguments: {},
            })) as CallToolResult
          );
        }
      ),
      { numRuns: RUNS }
    );
  });
});
