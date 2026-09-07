import type { CallToolResult } from '@modelcontextprotocol/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { connect, gistFixture, jsonResponse, resultJson } from './harness.js';

/**
 * The one code path that weakens TLS, and the only test that exercises it.
 *
 * `vi.mock` is hoisted: undici is replaced for this file before `api.ts`
 * imports it, so the dispatcher the server builds under the switch is the
 * fake Agent below, and undici's fetch is the spy.
 */

// Hoisted with the mock: a factory cannot reach a top-level variable.
const { undiciFetch, FakeAgent } = vi.hoisted(() => {
  class Agent {
    constructor(public readonly options: unknown) {}
  }
  return {
    undiciFetch: vi.fn(async (): Promise<Response> => {
      throw new Error('replaced per test');
    }),
    FakeAgent: Agent,
  };
});
type FakeAgentInstance = InstanceType<typeof FakeAgent>;

vi.mock('undici', () => ({
  fetch: undiciFetch,
  Agent: FakeAgent,
}));

afterEach(() => {
  vi.unstubAllGlobals();
  undiciFetch.mockReset();
});

describe('OPENGIST_INSECURE_TLS', () => {
  it('routes the request through undici with a dispatcher that skips verification', async () => {
    undiciFetch.mockImplementation(async () => jsonResponse(gistFixture()));
    const globalFetch = vi.fn(async () => jsonResponse(gistFixture()));
    vi.stubGlobal('fetch', globalFetch);
    const client = await connect({ insecureTls: true });
    const result = (await client.callTool({
      name: 'get_gist',
      arguments: { gistId: 'abc123' },
    })) as CallToolResult;
    expect(resultJson(result).id).toBe('abc123');
    expect(globalFetch).not.toHaveBeenCalled();
    expect(undiciFetch).toHaveBeenCalledTimes(1);
    const [url, init] = undiciFetch.mock.calls[0] as unknown as [
      string,
      {
        dispatcher: FakeAgentInstance;
        redirect: string;
        headers: Record<string, string>;
      },
    ];
    expect(url).toBe('http://gist.test/api/gists/abc123');
    expect(init.dispatcher).toBeInstanceOf(FakeAgent);
    expect(init.dispatcher.options).toEqual({
      connect: { rejectUnauthorized: false },
    });
    // Everything else about the request is unchanged by the switch.
    expect(init.redirect).toBe('error');
    expect(init.headers.Authorization).toBe('Bearer og_test');
  });

  it('never touches undici when the switch is off', async () => {
    const globalFetch = vi.fn(async () => jsonResponse(gistFixture()));
    vi.stubGlobal('fetch', globalFetch);
    const client = await connect({ insecureTls: false });
    await client.callTool({
      name: 'get_gist',
      arguments: { gistId: 'abc123' },
    });
    expect(globalFetch).toHaveBeenCalledTimes(1);
    expect(undiciFetch).not.toHaveBeenCalled();
  });

  it('still refuses a header value HTTP would refuse, before undici sees it', async () => {
    const client = await connect({
      insecureTls: true,
      token: `og_head${String.fromCharCode(10)}SECRETTAIL`,
    });
    const result = (await client.callTool({
      name: 'get_gist',
      arguments: { gistId: 'abc123' },
    })) as CallToolResult;
    expect(result.isError).toBe(true);
    expect(undiciFetch).not.toHaveBeenCalled();
  });
});
