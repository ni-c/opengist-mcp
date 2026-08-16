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

/**
 * Ceiling on a single response body. The per-tool budgets in `shape.ts` and
 * `result.ts` all trim data that is already resident as a string, so without a
 * cap here a hostile or misconfigured instance could exhaust memory before any
 * of them is consulted — `get_gist_file` streams whatever the raw endpoint
 * returns. 8 MB is far above any legitimate gist and far below trouble.
 */
const MAX_BODY_BYTES = 8 * 1024 * 1024;

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
    // uses the (stubbable) global fetch. Only requests that actually go to the
    // configured instance may use the relaxed dispatcher — `redirect: 'error'`
    // already forbids cross-origin hops, this makes it independent of that.
    const useInsecure =
      this.insecureDispatcher !== undefined && this.isConfiguredOrigin(url);
    const response = useInsecure
      ? await undiciFetch(url, {
          ...init,
          dispatcher: this.insecureDispatcher,
        } as UndiciRequestInit)
      : await fetch(url, init);
    const text = await readBoundedBody(response, method, path);

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

  private isConfiguredOrigin(url: string): boolean {
    try {
      return new URL(url).origin === new URL(this.baseUrl).origin;
    } catch {
      return false;
    }
  }
}

/** Minimal shape of a response body we can read incrementally. */
interface StreamingBody {
  getReader(): {
    read(): Promise<{ done: boolean; value?: Uint8Array }>;
    cancel(): Promise<void>;
  };
}

function hasStreamingBody(body: unknown): body is StreamingBody {
  return (
    typeof body === 'object' &&
    body !== null &&
    typeof (body as StreamingBody).getReader === 'function'
  );
}

/**
 * Reads a response body, refusing anything past {@link MAX_BODY_BYTES}.
 *
 * A declared `content-length` is rejected before a single byte is read; a
 * chunked response is aborted as soon as the accumulated size crosses the
 * ceiling. Responses without a streamable body — which is what the test stubs
 * of global `fetch` return — fall back to `text()` and are checked afterwards.
 */
async function readBoundedBody(
  response: {
    headers: ResponseHeaders;
    body?: unknown;
    text(): Promise<string>;
  },
  method: string,
  path: string
): Promise<string> {
  const tooLarge = (): Error =>
    new Error(
      `Opengist API ${method} ${path} returned a response larger than ` +
        `${MAX_BODY_BYTES} bytes and was refused.`
    );

  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw tooLarge();

  const body = response.body;
  if (!hasStreamingBody(body)) {
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) throw tooLarge();
    return text;
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value === undefined) continue;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      throw tooLarge();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}
