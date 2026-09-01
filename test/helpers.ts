import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import type { CallToolResult } from '@modelcontextprotocol/client';
import { vi } from 'vitest';

import type { Config } from '../src/config.js';
import { createServer } from '../src/server.js';

export const config: Config = {
  url: 'http://gist.test',
  baseUrl: 'http://gist.test/api',
  token: 'og_test',
  readOnly: false,
  insecureTls: false,
};

export type FetchCall = { url: string; init: RequestInit | undefined };

export function jsonResponse(
  data: unknown,
  status = 200,
  headers: Record<string, string> = {}
): Response {
  return new Response(status === 204 ? null : JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

export function textResponse(
  text: string,
  status = 200,
  contentType = 'text/plain'
): Response {
  return new Response(text, {
    status,
    headers: { 'content-type': contentType },
  });
}

/** Pagination headers as the Opengist list endpoints send them. */
export function pageHeaders(
  page: number,
  perPage: number,
  total: number
): Record<string, string> {
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const headers: Record<string, string> = {
    'x-page': String(page),
    'x-per-page': String(perPage),
    'x-total': String(total),
    'x-total-pages': String(totalPages),
  };
  const links: string[] = [];
  if (page < totalPages) {
    links.push(
      `<http://gist.test/api/gists?page=${page + 1}&per_page=${perPage}>; rel="next"`
    );
  }
  if (page > 1) {
    links.push(
      `<http://gist.test/api/gists?page=${page - 1}&per_page=${perPage}>; rel="prev"`
    );
  }
  if (links.length > 0) headers.link = links.join(', ');
  return headers;
}

/** Stubs global fetch and records all calls. */
export function stubFetch(
  handler: (url: string, init?: RequestInit) => Response
): FetchCall[] {
  const calls: FetchCall[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return handler(String(url), init);
    })
  );
  return calls;
}

/** How a client that can show a dialog answers it. */
export type ElicitBehaviour = 'accept' | 'decline' | 'cancel';

/**
 * Connects a client to the real server.
 *
 * Without `elicit` the client declares no elicitation capability, which is the
 * case the two-call token exists for and what every other test drives. With it,
 * the client answers the dialog and `prompts` records what the server put in
 * front of the user.
 */
export async function connectClient(
  overrides: Partial<Config> = {},
  elicit?: ElicitBehaviour
): Promise<Client & { prompts: string[] }> {
  const server = createServer({ ...config, ...overrides });
  const prompts: string[] = [];
  const client = new Client(
    { name: 'test-client', version: '0.0.0' },
    elicit === undefined ? {} : { capabilities: { elicitation: {} } }
  );
  if (elicit !== undefined) {
    client.setRequestHandler('elicitation/create', (request) => {
      const params = request.params as { message?: string };
      prompts.push(params.message ?? '');
      if (elicit === 'cancel') return { action: 'cancel' };
      if (elicit === 'decline') return { action: 'decline' };
      return { action: 'accept', content: { confirm: true } };
    });
  }
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  return Object.assign(client, { prompts });
}

export function resultText(result: CallToolResult): string {
  return result.content
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('\n');
}

export function resultJson(result: CallToolResult): Record<string, unknown> {
  return JSON.parse(resultText(result)) as Record<string, unknown>;
}

export function requestBody(call: FetchCall | undefined): unknown {
  return JSON.parse(String(call?.init?.body ?? 'null'));
}

/** A minimal gist as the API returns it. */
export function gistFixture(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id: 'abc123',
    slug_url: 'abc123',
    owner: { id: 1, username: 'willi', login: 'willi' },
    title: 'notes.md',
    html_url: 'http://gist.test/willi/abc123',
    description: 'some notes',
    public: true,
    visibility: 'public',
    like_count: 0,
    fork_count: 0,
    clone_url: 'http://gist.test/willi/abc123.git',
    ssh_url: 'ssh://gist.test:2222/willi/abc123.git',
    topics: [],
    archived: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
    expires_at: null,
    files: {
      'notes.md': {
        filename: 'notes.md',
        language: 'Markdown',
        size: 5,
        truncated: false,
        content: 'hello',
        encoding: 'utf8',
      },
    },
    commits: [
      {
        version: 'aaaa1111bbbb2222cccc3333dddd4444eeee5555',
        author: { name: 'willi', email: 'willi@example.com' },
        change_status: {
          files_changed: 1,
          additions: 1,
          deletions: 0,
          total: 1,
        },
        committed_at: '2026-01-02T00:00:00Z',
      },
    ],
    forks: [],
    ...overrides,
  };
}
