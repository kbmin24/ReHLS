export type Account = {
  id: string;
  username: string;
  role: 'admin' | 'user';
  session_version: number;
  disabled_at: string | null;
};

type ErrorCode = { service: string; cause: string };

export class ApiError extends Error {
  constructor(public readonly status: number, public readonly code?: ErrorCode) {
    super(code?.cause ?? 'REQUEST_FAILED');
  }
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...options,
    credentials: 'same-origin',
    headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...options.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { code?: ErrorCode } | null;
    throw new ApiError(response.status, body?.code);
  }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}

export function errorText(error: unknown): string {
  if (!(error instanceof ApiError)) return 'Could not connect. Please try again.';
  switch (error.code?.cause) {
    case 'INVALID_CREDENTIALS': return 'Check your username and password.';
    case 'UNAUTHENTICATED': return 'Your session has ended. Sign in again.';
    case 'FORBIDDEN': return 'You do not have access to this action.';
    case 'USERNAME_TAKEN': return 'That username is already in use.';
    case 'INVALID_INPUT': return 'Check the fields and try again.';
    case 'INVALID_ORIGIN': return 'Reload this page and try again.';
    case 'RATE_LIMITED': return 'Too many attempts. Try again later.';
    case 'NOT_FOUND': return 'That account could not be found.';
    case 'INVALID_SOURCE': return 'Enter a public HTTP(S) playlist URL.';
    case 'FETCH_FAILED': return 'The playlist could not be fetched.';
    case 'EMPTY_PLAYLIST': return 'The playlist contains no supported channels.';
    case 'TOO_LARGE': return error.code?.service === 'streaming' ? 'The media response is too large.' : 'The playlist is too large.';
    case 'UNAVAILABLE': return 'The channel is unavailable right now.';
    case 'UNSUPPORTED': return 'This stream format is not supported.';
    case 'EXPIRED': return 'Playback expired. Select the channel again.';
    case 'INVALID': return 'The stream manifest is invalid.';
    case 'INVALID_RANGE': return 'The requested media range is invalid.';
    default: return 'The request failed. Please try again.';
  }
}
