/** The object key identifies the source; each array lists its error causes. */
export const errorCodes = {
  user: ['INVALID_INPUT', 'INVALID_CREDENTIALS', 'UNAUTHENTICATED', 'FORBIDDEN', 'BOOTSTRAP_CLOSED', 'USERNAME_TAKEN'],
  validation: ['INVALID_INPUT'],
  rateLimit: ['RATE_LIMITED'],
  app: ['INVALID_ORIGIN', 'NOT_FOUND', 'INTERNAL_ERROR'],
  playlist: ['INVALID_SOURCE', 'FETCH_FAILED', 'PARSE_FAILED', 'EMPTY_PLAYLIST', 'TOO_LARGE'],
  epg: ['INVALID_SOURCE', 'FETCH_FAILED', 'PARSE_FAILED', 'EMPTY_GUIDE', 'TOO_LARGE'],
  streaming: ['UNAVAILABLE', 'UNSUPPORTED', 'INVALID', 'INVALID_RANGE', 'EXPIRED', 'TOO_LARGE'],
} as const;

type Source = keyof typeof errorCodes;
type Cause<S extends Source> = (typeof errorCodes)[S][number];

export type ErrorCode = {
  [S in Source]: { [C in Cause<S>]: { service: S; cause: C } }[Cause<S>];
}[Source];

function codesFor<S extends Source>(service: S): { [C in Cause<S>]: { service: S; cause: C } } {
  return Object.fromEntries(errorCodes[service].map((cause) => [cause, { service, cause }])) as
    { [C in Cause<S>]: { service: S; cause: C } };
}

export const user = codesFor('user');
export const validation = codesFor('validation');
export const rateLimit = codesFor('rateLimit');
export const app = codesFor('app');
export const playlist = codesFor('playlist');
export const epg = codesFor('epg');
export const streaming = codesFor('streaming');
