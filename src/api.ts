import {
  Agent,
  fetch as undiciFetch,
  type RequestInit as UndiciRequestInit,
} from 'undici';

import {
  missingConfigKeys,
  missingConfigMessage,
  type Config,
} from './config.js';

const REQUEST_TIMEOUT_MS = 30_000;

/** Just enough of the Headers interface for what the pagination parser needs. */
export interface ResponseHeaders {
  get(name: string): string | null;
}

export interface ApiResponse {
  status: number;
  data: unknown;
  headers: ResponseHeaders;
}

export interface RawResponse {
  status: number;
  text: string;
  contentType: string;
}

export class OpengistApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
    method: string,
    path: string
  ) {
    super(`Opengist API ${method} ${path} failed with HTTP ${status}`);
    this.name = 'OpengistApiError';
  }
}

/**
 * Minimal client for the Opengist REST API (`/api`), authenticated with a
 * Personal Access Token via the `Bearer` scheme.
 */
export class OpengistApi {
  private readonly config: Config;
  private readonly baseUrl: string;
  private readonly authHeader: string;
  /**
   * Only set when `OPENGIST_INSECURE_TLS` is enabled. Scopes the relaxed
   * certificate validation to requests against the configured Opengist host
   * instead of disabling it process-wide via NODE_TLS_REJECT_UNAUTHORIZED.
   */
  private readonly insecureDispatcher?: Agent;

  constructor(config: Config) {
    this.config = config;
    this.baseUrl = config.baseUrl ?? '';
    this.authHeader = `Bearer ${config.token ?? ''}`;
    if (config.insecureTls) {
      this.insecureDispatcher = new Agent({
        connect: { rejectUnauthorized: false },
      });
    }
  }

  private async send(
    method: string,
    path: string,
    accept: string,
    body?: unknown
  ): Promise<{ status: number; text: string; headers: ResponseHeaders }> {
    // The credentials are only required here, not at startup, so that the
    // server can still be started and introspected without them.
    const missing = missingConfigKeys(this.config);
    if (missing.length > 0) {
      throw new Error(missingConfigMessage(missing));
    }
    const headers: Record<string, string> = {
      Authorization: this.authHeader,
      Accept: accept,
    };
    const init: RequestInit = {
      method,
      headers,
      // The API never redirects; refusing keeps the bearer token from being
      // replayed to an unexpected target.
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }

    const url = `${this.baseUrl}${path}`;
    // The insecure dispatcher requires undici's own fetch; the default path
    // uses the (stubbable) global fetch.
    const response = this.insecureDispatcher
      ? await undiciFetch(url, {
          ...init,
          dispatcher: this.insecureDispatcher,
        } as UndiciRequestInit)
      : await fetch(url, init);
    const text = await response.text();

    if (!response.ok) {
      throw new OpengistApiError(response.status, text, method, path);
    }
    return { status: response.status, text, headers: response.headers };
  }

  async request(
    method: string,
    path: string,
    body?: unknown
  ): Promise<ApiResponse> {
    const { status, text, headers } = await this.send(
      method,
      path,
      'application/json',
      body
    );

    // 204 No Content (delete, like) and empty bodies carry no data.
    if (status === 204 || text.trim() === '') {
      return { status, data: null, headers };
    }
    const contentType = headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      try {
        return { status, data: JSON.parse(text), headers };
      } catch {
        return { status, data: text, headers };
      }
    }
    return { status, data: text, headers };
  }

  /** Fetches a raw (possibly non-JSON) body, used for the raw file endpoint. */
  async getRaw(path: string): Promise<RawResponse> {
    const { status, text, headers } = await this.send('GET', path, '*/*');
    return {
      status,
      text,
      contentType: headers.get('content-type') ?? '',
    };
  }

  async get(path: string): Promise<unknown> {
    return (await this.request('GET', path)).data;
  }

  getWithHeaders(path: string): Promise<ApiResponse> {
    return this.request('GET', path);
  }

  post(path: string, body?: unknown): Promise<ApiResponse> {
    return this.request('POST', path, body);
  }

  patch(path: string, body?: unknown): Promise<ApiResponse> {
    return this.request('PATCH', path, body);
  }

  put(path: string, body?: unknown): Promise<ApiResponse> {
    return this.request('PUT', path, body);
  }

  delete(path: string): Promise<ApiResponse> {
    return this.request('DELETE', path);
  }
}
