/**
 * Typed client for the JSON API envelope.
 * Centralises error handling so no component has to parse responses by hand.
 */
export class ApiClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

async function request<T>(
  path: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const { json, ...rest } = init;

  const response = await fetch(path, {
    ...rest,
    headers: {
      ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(rest.headers ?? {}),
    },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
    credentials: 'same-origin',
  });

  let payload: { success?: boolean; data?: T; error?: { code?: string; message?: string; details?: unknown } };
  try {
    payload = await response.json();
  } catch {
    throw new ApiClientError(
      `Unexpected non-JSON response (${response.status}).`,
      response.status,
      'INVALID_RESPONSE',
    );
  }

  if (!response.ok || payload.success === false) {
    throw new ApiClientError(
      payload.error?.message ?? `Request failed with status ${response.status}.`,
      response.status,
      payload.error?.code ?? 'REQUEST_FAILED',
      payload.error?.details,
    );
  }

  return payload.data as T;
}

export const api = {
  get: <T,>(path: string) => request<T>(path),
  post: <T,>(path: string, json?: unknown) => request<T>(path, { method: 'POST', json }),
  patch: <T,>(path: string, json?: unknown) => request<T>(path, { method: 'PATCH', json }),
  put: <T,>(path: string, json?: unknown) => request<T>(path, { method: 'PUT', json }),
  delete: <T,>(path: string) => request<T>(path, { method: 'DELETE' }),
};

export type Api = typeof api;
