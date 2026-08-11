import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Notes, shapeGistDetail, shapeUser } from '../src/shape.js';
import { withQuery } from '../src/schema.js';

import {
  connectClient,
  gistFixture,
  jsonResponse,
  pageHeaders,
  resultJson,
  resultText,
  stubFetch,
  textResponse,
} from './helpers.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

const FULL_OPTIONS = {
  includeContent: true,
  maxFileBytes: 1000,
  maxTotalBytes: 10_000,
  includeCommits: true,
  maxCommits: 10,
  includeForks: true,
  includeCloneUrls: true,
};

describe('shapeGistDetail', () => {
  it('shapes the parent of a fork and the fork list', () => {
    const notes = new Notes();
    const shaped = shapeGistDetail(
      {
        id: 'fork1',
        fork_of: { id: 'orig', title: 'original', owner: { username: 'bob' } },
        forks: [{ id: 'sub1', title: 'sub' }],
        files: {},
        commits: [],
      },
      FULL_OPTIONS,
      notes
    );
    expect(shaped.forkOf).toEqual({
      id: 'orig',
      title: 'original',
      owner: 'bob',
    });
    expect(shaped.forks).toHaveLength(1);
  });

  it('mentions forks that were left out', () => {
    const notes = new Notes();
    shapeGistDetail(
      { id: 'a', forks: [{ id: 'f1' }, { id: 'f2' }], files: {}, commits: [] },
      { ...FULL_OPTIONS, includeForks: false },
      notes
    );
    expect(notes.list().join(' ')).toContain('2 fork(s)');
  });

  it('keeps empty files as empty strings and reports server truncation', () => {
    const notes = new Notes();
    const shaped = shapeGistDetail(
      {
        id: 'a',
        files: {
          'empty.txt': { filename: 'empty.txt', content: '' },
          'cut.txt': { filename: 'cut.txt', content: 'abc', truncated: true },
        },
        commits: [],
        truncated: true,
      },
      FULL_OPTIONS,
      notes
    );
    const files = shaped.files as Record<string, unknown>[];
    expect(files[0]?.content).toBe('');
    expect(notes.list().join(' ')).toContain(
      'truncated the content of "cut.txt"'
    );
    expect(notes.list().join(' ')).toContain('reports this gist as truncated');
  });

  it('falls back to the map key when a file has no filename', () => {
    const notes = new Notes();
    const shaped = shapeGistDetail(
      { id: 'a', files: { 'keyed.txt': { content: 'x' } }, commits: [] },
      FULL_OPTIONS,
      notes
    );
    expect((shaped.files as Record<string, unknown>[])[0]?.filename).toBe(
      'keyed.txt'
    );
  });

  it('tolerates a gist without files or commits', () => {
    const notes = new Notes();
    const shaped = shapeGistDetail({ id: 'a' }, FULL_OPTIONS, notes);
    expect(shaped.files).toEqual([]);
    expect(shaped.commitCount).toBe(0);
    expect(shaped.latestCommit).toBeUndefined();
  });
});

describe('shapeUser', () => {
  it('returns null for a missing user', () => {
    expect(shapeUser(undefined)).toBeNull();
  });

  it('keeps only id and username', () => {
    expect(shapeUser({ id: 1, username: 'willi', created_at: 'x' })).toEqual({
      id: 1,
      username: 'willi',
    });
  });
});

describe('withQuery', () => {
  it('returns the path unchanged when every parameter is undefined', () => {
    expect(withQuery('/gists', { page: undefined })).toBe('/gists');
  });
});

describe('oversized results', () => {
  it('drops file contents when the serialized result is too large', async () => {
    const files: Record<string, unknown> = {};
    for (let i = 0; i < 3; i++) {
      files[`big${i}.txt`] = {
        filename: `big${i}.txt`,
        size: 200_000,
        content: 'x'.repeat(200_000),
      };
    }
    stubFetch(() => jsonResponse(gistFixture({ files })));
    const client = await connectClient();
    const result = (await client.callTool({
      name: 'get_gist',
      arguments: {
        gistId: 'abc123',
        maxFileBytes: 200_000,
        maxTotalBytes: 400_000,
      },
    })) as CallToolResult;

    const text = resultText(result);
    expect(text).toContain('(omitted: result too large)');
    expect(text).toContain('get_gist_file');
  });
});

describe('api response handling', () => {
  it('passes a non-JSON body through as text', async () => {
    stubFetch(() => textResponse('plain text body'));
    const client = await connectClient();
    const result = (await client.callTool({
      name: 'get_user',
      arguments: {},
    })) as CallToolResult;
    expect(resultJson(result).user).toBe('plain text body');
  });

  it('tolerates a broken JSON body', async () => {
    stubFetch(
      () =>
        new Response('{not json', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
    );
    const client = await connectClient();
    const result = (await client.callTool({
      name: 'get_user',
      arguments: {},
    })) as CallToolResult;
    expect(resultJson(result).user).toBe('{not json');
  });

  it('treats an empty body as no data', async () => {
    stubFetch(() => new Response('', { status: 200 }));
    const client = await connectClient();
    const result = (await client.callTool({
      name: 'get_user',
      arguments: {},
    })) as CallToolResult;
    expect(resultJson(result).user).toBeNull();
  });

  it('explains a 409 conflict', async () => {
    stubFetch(() => jsonResponse({ message: 'taken' }, 409));
    const client = await connectClient();
    const result = (await client.callTool({
      name: 'list_gists',
      arguments: {},
    })) as CallToolResult;
    expect(resultText(result)).toContain('already taken');
  });

  it('explains a 422 validation failure', async () => {
    stubFetch(() => jsonResponse({ message: 'invalid' }, 422));
    const client = await connectClient();
    const result = (await client.callTool({
      name: 'create_gist',
      arguments: {
        files: [{ filename: 'a.txt', content: 'A' }],
        visibility: 'private',
      },
    })) as CallToolResult;
    expect(resultText(result)).toContain('at least one file');
  });

  it('reports a network failure without a status hint', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('connect ECONNREFUSED');
      })
    );
    const client = await connectClient();
    const result = (await client.callTool({
      name: 'list_gists',
      arguments: {},
    })) as CallToolResult;
    expect(result.isError).toBe(true);
    expect(resultText(result)).toContain('opengist-mcp: connect ECONNREFUSED');
  });
});

describe('likes error propagation', () => {
  it('propagates a non-404 error from the like check', async () => {
    stubFetch(() => jsonResponse({ message: 'boom' }, 500));
    const client = await connectClient();
    const result = (await client.callTool({
      name: 'check_gist_like',
      arguments: { gistId: 'abc123' },
    })) as CallToolResult;
    expect(result.isError).toBe(true);
    expect(resultText(result)).toContain('HTTP 500');
  });

  it('propagates a non-404 error from the follow-up gist read', async () => {
    stubFetch((url) =>
      url.endsWith('/like')
        ? jsonResponse({ message: 'not found' }, 404)
        : jsonResponse({ message: 'boom' }, 500)
    );
    const client = await connectClient();
    const result = (await client.callTool({
      name: 'check_gist_like',
      arguments: { gistId: 'abc123' },
    })) as CallToolResult;
    expect(result.isError).toBe(true);
    expect(resultText(result)).toContain('HTTP 500');
  });

  it('refuses to like a gist that is not visible', async () => {
    const calls = stubFetch(() => jsonResponse({ message: 'not found' }, 404));
    const client = await connectClient();
    const result = (await client.callTool({
      name: 'set_gist_like',
      arguments: { gistId: 'abc123', liked: true },
    })) as CallToolResult;
    expect(result.isError).toBe(true);
    expect(resultText(result)).toContain('not visible');
    expect(calls.some((c) => c.init?.method === 'PUT')).toBe(false);
  });
});

describe('search edge cases', () => {
  it('matches on the description and the owner', async () => {
    stubFetch(() =>
      jsonResponse(
        [
          gistFixture({
            id: '1',
            title: '',
            description: 'a haystack with a needle',
            files: undefined,
            commits: [],
          }),
          gistFixture({
            id: '2',
            title: '',
            description: '',
            owner: { id: 2, username: 'needleman' },
            files: undefined,
            commits: [],
          }),
        ],
        200,
        pageHeaders(1, 100, 2)
      )
    );
    const client = await connectClient();
    const result = (await client.callTool({
      name: 'search_gists',
      arguments: { query: 'needle', in: ['description', 'owner'] },
    })) as CallToolResult;
    const matches = resultJson(result).matches as Record<string, unknown>[];
    expect(matches.map((m) => m.id)).toEqual(['1', '2']);
    expect(matches[0]?.matchedOn).toEqual(['description']);
    expect(matches[1]?.matchedOn).toEqual(['owner']);
  });

  it('handles a scope with no gists at all', async () => {
    stubFetch(() => jsonResponse([], 200, pageHeaders(1, 100, 0)));
    const client = await connectClient();
    const result = (await client.callTool({
      name: 'search_gists',
      arguments: { query: 'x' },
    })) as CallToolResult;
    const body = resultJson(result);
    expect(body.matches).toEqual([]);
    expect(body.truncated).toBe(false);
    expect(String(body.notes)).toContain('Complete scan');
  });

  it('reports the missing total when the list endpoint sends no headers', async () => {
    stubFetch(() => jsonResponse([gistFixture({ title: 'needle' })]));
    const client = await connectClient();
    const result = (await client.callTool({
      name: 'search_gists',
      arguments: { query: 'needle', in: ['title'] },
    })) as CallToolResult;
    const scanned = resultJson(result).scanned as Record<string, unknown>;
    expect(scanned.totalAvailable).toBeNull();
  });
});
