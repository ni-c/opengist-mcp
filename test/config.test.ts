import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadConfig } from '../src/config.js';

function env(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    OPENGIST_URL: 'https://gist.example.com',
    OPENGIST_TOKEN: 'og_secret',
    ...overrides,
  };
}

function mockExit(): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(process, 'exit').mockImplementation(() => {
    throw new Error('process.exit');
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('loadConfig', () => {
  it('returns the config and derives the API base URL', () => {
    expect(loadConfig(env())).toEqual({
      url: 'https://gist.example.com',
      baseUrl: 'https://gist.example.com/api',
      token: 'og_secret',
      readOnly: false,
      insecureTls: false,
    });
  });

  it('strips trailing slashes', () => {
    const config = loadConfig(
      env({ OPENGIST_URL: 'https://gist.example.com//' })
    );
    expect(config.baseUrl).toBe('https://gist.example.com/api');
  });

  it('does not append a second /api when the URL already has one', () => {
    const config = loadConfig(
      env({ OPENGIST_URL: 'https://gist.example.com/api' })
    );
    expect(config.url).toBe('https://gist.example.com');
    expect(config.baseUrl).toBe('https://gist.example.com/api');
  });

  it('parses OPENGIST_READ_ONLY and OPENGIST_INSECURE_TLS', () => {
    const config = loadConfig(
      env({ OPENGIST_READ_ONLY: 'true', OPENGIST_INSECURE_TLS: 'true' })
    );
    expect(config.readOnly).toBe(true);
    expect(config.insecureTls).toBe(true);
  });

  it('treats any value other than "true" as false', () => {
    const config = loadConfig(env({ OPENGIST_READ_ONLY: 'yes' }));
    expect(config.readOnly).toBe(false);
  });

  it('removes the token from the environment after loading', () => {
    const environment = env();
    loadConfig(environment);
    expect(environment.OPENGIST_TOKEN).toBeUndefined();
    expect(environment.OPENGIST_URL).toBe('https://gist.example.com');
  });

  it('removes the token even when the URL is missing', () => {
    // The credential-less start path is exactly the one where a token is set
    // and something else is wrong (a typo in the URL, a half-filled config),
    // so an early return here would leave it in /proc/<pid>/environ.
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const environment: NodeJS.ProcessEnv = { OPENGIST_TOKEN: 'og_secret' };
    const config = loadConfig(environment);
    expect(environment.OPENGIST_TOKEN).toBeUndefined();
    expect(config.token).toBe('og_secret');
    error.mockRestore();
  });

  it('removes the token even when the URL is invalid', () => {
    const exit = mockExit();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const environment: NodeJS.ProcessEnv = {
      OPENGIST_URL: 'ftp://gist.example.com',
      OPENGIST_TOKEN: 'og_secret',
    };
    try {
      loadConfig(environment);
    } catch {
      // mockExit throws to stop the function, which is the point.
    }
    expect(environment.OPENGIST_TOKEN).toBeUndefined();
    expect(exit).toHaveBeenCalled();
    error.mockRestore();
  });

  it('warns but does not exit when required variables are missing', () => {
    // Registries and sandbox inspectors start the server without credentials
    // and expect the MCP handshake and tools/list to still work.
    const exit = mockExit();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    const config = loadConfig({});

    expect(config).toEqual({
      url: undefined,
      baseUrl: undefined,
      token: undefined,
      readOnly: false,
      insecureTls: false,
    });
    expect(exit).not.toHaveBeenCalled();
    expect(String(error.mock.calls[0]?.[0])).toContain(
      'OPENGIST_URL, OPENGIST_TOKEN'
    );
  });

  it('keeps read-only and insecure-TLS flags when credentials are missing', () => {
    mockExit();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const config = loadConfig({
      OPENGIST_READ_ONLY: 'true',
      OPENGIST_INSECURE_TLS: 'true',
    });
    expect(config.readOnly).toBe(true);
    expect(config.insecureTls).toBe(true);
  });

  it('exits on an invalid URL', () => {
    const exit = mockExit();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => loadConfig(env({ OPENGIST_URL: 'not a url' }))).toThrow(
      'process.exit'
    );
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('exits on a non-http(s) URL scheme', () => {
    const exit = mockExit();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() =>
      loadConfig(env({ OPENGIST_URL: 'ftp://gist.example.com' }))
    ).toThrow('process.exit');
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('exits when the URL contains credentials', () => {
    const exit = mockExit();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() =>
      loadConfig(env({ OPENGIST_URL: 'https://user:pw@gist.example.com' }))
    ).toThrow('process.exit');
    expect(exit).toHaveBeenCalledWith(1);
    expect(String(error.mock.calls[0]?.[0])).toContain('username or password');
  });

  it('warns on plain http to a non-local host', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    loadConfig(env({ OPENGIST_URL: 'http://gist.example.com' }));
    expect(String(error.mock.calls[0]?.[0])).toContain('unencrypted');
  });

  it('does not warn on plain http to localhost', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    loadConfig(env({ OPENGIST_URL: 'http://localhost:6157' }));
    loadConfig(env({ OPENGIST_URL: 'http://127.0.0.1:6157' }));
    expect(error).not.toHaveBeenCalled();
  });

  it('warns when the token does not look like an Opengist token', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    loadConfig(env({ OPENGIST_TOKEN: 'hunter2' }));
    expect(String(error.mock.calls[0]?.[0])).toContain('og_');
  });
});
