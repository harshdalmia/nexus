/* ------------------------------------------------------------------
   HTTP client for the NEXUS-AML API.

   The backend speaks exactly two shapes:
     success  { data, meta }
     failure  { error: { code, message, detail?, request_id? } }

   This module collapses both into one call signature: resolve with the
   unwrapped payload plus meta, or throw a typed ApiError. Nothing above
   this file touches fetch, status codes or the envelope.
   ------------------------------------------------------------------ */

const DEFAULT_BASE = 'http://127.0.0.1:8000';
const DEFAULT_TIMEOUT_MS = 120_000;

const configuredBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim();

/**
 * Configured at build time with VITE_API_BASE_URL; falls back to the local engine.
 *
 * A blank value is a deliberate "no engine configured" signal (see `lib/demoMode`),
 * but it still has to resolve to something parseable: `buildUrl` uses `new URL`, and
 * an empty base would throw a raw TypeError outside the ApiError contract every
 * caller catches. So it resolves to the default here and the demo switch — not a
 * broken request — is what actually keeps the app off the network.
 */
export const apiBaseUrl: string =
  configuredBase === undefined || configuredBase.length === 0
    ? DEFAULT_BASE
    : configuredBase.replace(/\/$/, '');

export const apiPrefix = '/api/v1';

export interface ApiMeta {
  readonly request_id: string;
  readonly generated_at: string;
  readonly source: 'pipeline' | 'dataset' | 'static' | 'cache';
  readonly variant: string | null;
  readonly run_id: string | null;
  readonly duration_ms: number | null;
  readonly notes: readonly string[];
  readonly page: {
    readonly page: number;
    readonly page_size: number;
    readonly total: number;
    readonly total_pages: number;
    readonly has_next: boolean;
    readonly has_previous: boolean;
    readonly sort: string | null;
    readonly filters: Record<string, string>;
    readonly truncated: boolean;
  } | null;
}

export interface ApiResponse<T> {
  readonly data: T;
  readonly meta: ApiMeta;
}

/** Every failure path — network, timeout, HTTP error — arrives as one of these. */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly detail: unknown;
  readonly requestId: string | null;

  constructor(init: {
    code: string;
    message: string;
    status: number;
    detail?: unknown;
    requestId?: string | null;
  }) {
    super(init.message);
    this.name = 'ApiError';
    this.code = init.code;
    this.status = init.status;
    this.detail = init.detail;
    this.requestId = init.requestId ?? null;
  }

  /** True when the engine is alive but not yet able to answer. */
  get isWarming(): boolean {
    return this.code === 'WARMING_UP';
  }

  /** True when the backend could not be reached at all. */
  get isOffline(): boolean {
    return this.status === 0;
  }
}

type QueryValue = string | number | boolean | null | undefined;

const buildUrl = (path: string, params?: Record<string, QueryValue>): string => {
  const url = new URL(`${apiBaseUrl}${apiPrefix}${path}`);

  for (const [key, value] of Object.entries(params ?? {})) {
    if (value === null || value === undefined || value === '' || value === false) {
      continue;
    }
    url.searchParams.set(key, String(value));
  }

  return url.toString();
};

interface RequestOptions {
  readonly params?: Record<string, QueryValue>;
  readonly body?: unknown;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

const errorFromBody = (body: unknown, status: number): ApiError => {
  const envelope = body as { error?: { code?: string; message?: string; detail?: unknown; request_id?: string } };
  const error = envelope?.error;

  return new ApiError({
    code: error?.code ?? 'HTTP_ERROR',
    message: error?.message ?? `Request failed with status ${String(status)}.`,
    status,
    detail: error?.detail,
    requestId: error?.request_id ?? null,
  });
};

const request = async <T>(
  method: 'GET' | 'POST',
  path: string,
  options: RequestOptions = {},
): Promise<ApiResponse<T>> => {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new DOMException('timeout', 'TimeoutError')),
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );

  /* A caller-supplied signal (component unmount, new query superseding an old
     one) cancels the same request as the timeout. */
  options.signal?.addEventListener('abort', () => controller.abort(options.signal?.reason), {
    once: true,
  });

  let response: Response;

  try {
    response = await fetch(buildUrl(path, options.params), {
      method,
      headers: options.body === undefined
        ? { Accept: 'application/json' }
        : { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    });
  } catch (cause) {
    const aborted = cause instanceof DOMException && cause.name === 'AbortError';
    const timedOut = cause instanceof DOMException && cause.name === 'TimeoutError';

    throw new ApiError({
      code: timedOut ? 'TIMEOUT' : aborted ? 'CANCELLED' : 'NETWORK_ERROR',
      message: timedOut
        ? 'The engine did not respond in time.'
        : aborted
          ? 'The request was cancelled.'
          : `Cannot reach the engine at ${apiBaseUrl}.`,
      status: 0,
      detail: { cause: String(cause) },
    });
  } finally {
    clearTimeout(timeout);
  }

  const text = await response.text();
  let parsed: unknown = null;

  if (text.length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new ApiError({
        code: 'MALFORMED_RESPONSE',
        message: 'The engine returned a response that was not JSON.',
        status: response.status,
        requestId: response.headers.get('X-Request-Id'),
      });
    }
  }

  if (!response.ok) {
    throw errorFromBody(parsed, response.status);
  }

  const envelope = parsed as ApiResponse<T> | null;

  if (envelope === null || !('data' in envelope)) {
    throw new ApiError({
      code: 'MALFORMED_RESPONSE',
      message: 'The engine response was missing its data envelope.',
      status: response.status,
      requestId: response.headers.get('X-Request-Id'),
    });
  }

  return envelope;
};

export const apiGet = <T>(path: string, options?: RequestOptions): Promise<ApiResponse<T>> =>
  request<T>('GET', path, options);

export const apiPost = <T>(
  path: string,
  body: unknown,
  options?: Omit<RequestOptions, 'body'>,
): Promise<ApiResponse<T>> => request<T>('POST', path, { ...options, body });
