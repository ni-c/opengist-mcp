import type { CallToolResult } from '@modelcontextprotocol/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  connectClient,
  gistFixture,
  jsonResponse,
  pageHeaders,
  resultJson,
  stubFetch,
} from './helpers.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

function gist(
  id: string,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return gistFixture({ id, files: undefined, commits: [], ...overrides });
}

describe('search_gists', () => {
  it('matches on the cheap list fields without extra requests', async () => {
    const calls = stubFetch(() =>
      jsonResponse(
        [
          gist('1', { title: 'nginx TLS snippets' }),
          gist('2', { title: 'unrelated', description: 'nothing here' }),
        ],
        200,
        pageHeaders(1, 100, 2)
      )
    );
    const client = await connectClient();
    const result = (await client.callTool({
      name: 'search_gists',
      arguments: { query: 'nginx' },
    })) as CallToolResult;

    const body = resultJson(result);
    const matches = body.matches as Record<string, unknown>[];
    expect(matches).toHaveLength(1);
    expect(matches[0]?.id).toBe('1');
    expect(matches[0]?.matchedOn).toEqual(['title']);
    expect(calls).toHaveLength(1);
    expect(body.truncated).toBe(false);
  });

  it('requires all terms to match and ignores their order', async () => {
    stubFetch(() =>
      jsonResponse(
        [
          gist('1', { title: 'Compose file for Docker', description: '' }),
          gist('2', { title: 'Docker only', description: '' }),
        ],
        200,
        pageHeaders(1, 100, 2)
      )
    );
    const client = await connectClient();
    const result = (await client.callTool({
      name: 'search_gists',
      arguments: { query: 'docker compose', in: ['title'] },
    })) as CallToolResult;
    const matches = resultJson(result).matches as Record<string, unknown>[];
    expect(matches.map((m) => m.id)).toEqual(['1']);
  });

  it('matches case-insensitively on topics and owner', async () => {
    stubFetch(() =>
      jsonResponse(
        [gist('1', { title: '', description: '', topics: ['NGINX'] })],
        200,
        pageHeaders(1, 100, 1)
      )
    );
    const client = await connectClient();
    const result = (await client.callTool({
      name: 'search_gists',
      arguments: { query: 'nginx', in: ['topics'] },
    })) as CallToolResult;
    expect((resultJson(result).matches as unknown[]).length).toBe(1);
  });

  it('filters by visibility and archived state', async () => {
    stubFetch(() =>
      jsonResponse(
        [
          gist('1', { title: 'note', visibility: 'private', archived: false }),
          gist('2', { title: 'note', visibility: 'public', archived: false }),
          gist('3', { title: 'note', visibility: 'private', archived: true }),
        ],
        200,
        pageHeaders(1, 100, 3)
      )
    );
    const client = await connectClient();
    const byVisibility = (await client.callTool({
      name: 'search_gists',
      arguments: { query: 'note', in: ['title'], visibility: 'private' },
    })) as CallToolResult;
    expect((resultJson(byVisibility).matches as unknown[]).length).toBe(2);

    const notArchived = (await client.callTool({
      name: 'search_gists',
      arguments: { query: 'note', in: ['title'], archived: false },
    })) as CallToolResult;
    const ids = (
      resultJson(notArchived).matches as Record<string, unknown>[]
    ).map((m) => m.id);
    expect(ids).toEqual(['1', '2']);
  });

  it('follows pagination until the pages are exhausted', async () => {
    const calls = stubFetch((url) => {
      const page = /page=(\d+)/.exec(url)?.[1] ?? '1';
      return jsonResponse(
        [gist(`p${page}`, { title: page === '2' ? 'needle' : 'hay' })],
        200,
        pageHeaders(Number(page), 100, 200)
      );
    });
    const client = await connectClient();
    const result = (await client.callTool({
      name: 'search_gists',
      arguments: { query: 'needle', in: ['title'], maxPages: 3 },
    })) as CallToolResult;

    const body = resultJson(result);
    expect((body.matches as Record<string, unknown>[])[0]?.id).toBe('p2');
    expect(calls).toHaveLength(2);
    expect((body.scanned as Record<string, unknown>).pages).toBe(2);
  });

  it('marks the result truncated when the page cap is hit', async () => {
    stubFetch((url) => {
      const page = /page=(\d+)/.exec(url)?.[1] ?? '1';
      return jsonResponse(
        [gist(`p${page}`, { title: 'hay' })],
        200,
        pageHeaders(Number(page), 100, 1000)
      );
    });
    const client = await connectClient();
    const result = (await client.callTool({
      name: 'search_gists',
      arguments: { query: 'needle', in: ['title'], maxPages: 2 },
    })) as CallToolResult;

    const body = resultJson(result);
    expect(body.truncated).toBe(true);
    expect(String(body.notes)).toContain('INCOMPLETE RESULT');
    expect(String(body.notes)).toContain('of 1000');
    expect((body.scanned as Record<string, unknown>).pages).toBe(2);
  });

  it('marks the result truncated when the match limit is reached', async () => {
    stubFetch(() =>
      jsonResponse(
        [gist('1', { title: 'needle' }), gist('2', { title: 'needle' })],
        200,
        pageHeaders(1, 100, 2)
      )
    );
    const client = await connectClient();
    const result = (await client.callTool({
      name: 'search_gists',
      arguments: { query: 'needle', in: ['title'], limit: 1 },
    })) as CallToolResult;

    const body = resultJson(result);
    expect((body.matches as unknown[]).length).toBe(1);
    expect(body.truncated).toBe(true);
    expect(String(body.notes)).toContain('limit of 1');
  });

  it('scans a specific user with per_page=100', async () => {
    const calls = stubFetch(() =>
      jsonResponse([], 200, pageHeaders(1, 100, 0))
    );
    const client = await connectClient();
    await client.callTool({
      name: 'search_gists',
      arguments: { query: 'x', scope: 'mine', username: 'bob' },
    });
    expect(calls[0]?.url).toBe(
      'http://gist.test/api/users/bob/gists?page=1&per_page=100'
    );
  });

  it('always states that there is no search API', async () => {
    stubFetch(() => jsonResponse([], 200, pageHeaders(1, 100, 0)));
    const client = await connectClient();
    const result = (await client.callTool({
      name: 'search_gists',
      arguments: { query: 'x' },
    })) as CallToolResult;
    expect(String(resultJson(result).notes)).toContain('no search API');
  });

  it('rejects maxPages above the hard cap', async () => {
    const calls = stubFetch(() => jsonResponse([]));
    const client = await connectClient();
    const result = (await client.callTool({
      name: 'search_gists',
      arguments: { query: 'x', maxPages: 999 },
    })) as CallToolResult;
    expect(result.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });
});
