/**
 * Consistent JSON envelope for every API route.
 *   { success: boolean, data: T | null, error: { code, message } | null }
 */
import { NextResponse } from 'next/server';
import { toPublicError, log } from '@/lib/logging';

export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}

export function ok<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json({ success: true as const, data, error: null }, init);
}

export function fail(
  message: string,
  status = 400,
  code = 'BAD_REQUEST',
  details?: unknown,
): NextResponse {
  return NextResponse.json(
    { success: false as const, data: null, error: { code, message, details } },
    { status },
  );
}

/** Translate any thrown value into a safe response. Never leaks stack traces. */
export function handleError(err: unknown, context: Record<string, unknown> = {}): NextResponse {
  const mapped = toPublicError(err);
  log.error('api.error', {
    ...context,
    status: mapped.status,
    error: mapped.publicMessage,
    detail: mapped.detail,
  });
  return fail(mapped.publicMessage, mapped.status, errorCode(mapped.status));
}

function errorCode(status: number): string {
  switch (status) {
    case 400: return 'BAD_REQUEST';
    case 401: return 'UNAUTHORIZED';
    case 402: return 'INSUFFICIENT_CREDITS';
    case 403: return 'FORBIDDEN';
    case 404: return 'NOT_FOUND';
    case 409: return 'CONFLICT';
    case 429: return 'RATE_LIMITED';
    default: return status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_FAILED';
  }
}

/** Wraps a handler so every thrown error becomes a consistent JSON response. */
export function route<Args extends unknown[]>(
  handler: (...args: Args) => Promise<Response>,
  context: Record<string, unknown> = {},
) {
  return async (...args: Args): Promise<Response> => {
    try {
      return await handler(...args);
    } catch (err) {
      return handleError(err, context);
    }
  };
}
