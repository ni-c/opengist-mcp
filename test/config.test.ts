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

describe('ELICITATION', () => {
  it('defaults to on, and to on for an empty value', () => {
    // The only variable of this family that defaults to *on*. An unset switch
    // has to mean "ask", or a deployment that never heard of it would quietly
    // stop asking.
    expect(loadConfig(env()).elicitation).toBe(true);
    expect(loadConfig(env({ ELICITATION: '' })).elicitation).toBe(true);
  });

  it('is switched off by "false", in any casing or padding', () => {
    for (const raw of ['false', 'FALSE', ' False ']) {
      expect(loadConfig(env({ ELICITATION: raw })).elicitation, raw).toBe(
        false
      );
    }
  });

  it('refuses to start on anything else, naming both valid values', () => {
    // Deliberately fatal rather than falling back to the default: a typo would
    // leave the dialog running while the operator believes it is off, and
    // nothing else would ever tell them.
    for (const raw of ['1', 'off', 'no']) {
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
        throw new Error('exit');
      }) as never);
      expect(() => loadConfig(env({ ELICITATION: raw }))).toThrow('exit');
      expect(exit).toHaveBeenCalledWith(1);
      const message = String(error.mock.calls[0]?.[0] ?? '');
      expect(message, raw).toContain('ELICITATION');
      expect(message, raw).toContain('"true"');
      expect(message, raw).toContain('"false"');
      vi.restoreAllMocks();
    }
  });

  it('has already wiped the credential by the time it can exit', () => {
    // parseElicitation sits *after* the delete on purpose. An exit above it
    // would leave the credential in the environment for whatever a crash
    // reporter or an inspector does next — which is exactly what that delete
    // exists to prevent, and its comment says so.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit');
    }) as never);
    const e = env({ ELICITATION: 'nonsense' });
    expect(() => loadConfig(e)).toThrow('exit');
    expect(e.OPENGIST_TOKEN).toBeUndefined();
    vi.restoreAllMocks();
  });
});

describe('loadConfig', () => {
  it('returns the config and derives the API base URL', () => {
    expect(loadConfig(env())).toEqual({
      url: 'https://gist.example.com',
      baseUrl: 'https://gist.example.com/api',
      token: 'og_secret',
      readOnly: false,
      elicitation: true,
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
      elicitation: true,
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

  it('does not echo the offending value of an invalid URL', () => {
    // Regression: this branch fires precisely when the variable does not hold a
    // URL — most often because the token was pasted into the wrong one. The
    // message used to quote the value, putting the token in the MCP host's log.
    mockExit();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() =>
      loadConfig(env({ OPENGIST_URL: 'og_token_in_the_wrong_variable' }))
    ).toThrow('process.exit');
    const output = error.mock.calls.flat().join(' ');
    expect(output).toMatch(/is not a valid URL/);
    expect(output).not.toContain('og_token_in_the_wrong_variable');
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
