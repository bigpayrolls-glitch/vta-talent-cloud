import type { ApiErrorBody } from '@vta/shared';

type Code = ApiErrorBody['error']['code'];

const STATUS: Record<Code, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_FAILED: 400,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

export class ApiError extends Error {
  readonly statusCode: number;
  constructor(
    readonly code: Code,
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.statusCode = STATUS[code];
  }
}

export const notFound = (what = 'Record') => new ApiError('NOT_FOUND', `${what} not found`);
export const forbidden = (msg = 'You do not have access to this') => new ApiError('FORBIDDEN', msg);
export const conflict = (msg: string, fields?: Record<string, string>) => new ApiError('CONFLICT', msg, fields);
export const invalid = (msg: string, fields?: Record<string, string>) => new ApiError('VALIDATION_FAILED', msg, fields);
export const unauthenticated = (msg = 'Please sign in') => new ApiError('UNAUTHENTICATED', msg);
