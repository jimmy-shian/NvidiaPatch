import { describe, it, expect } from 'vitest';
const {
  GatewayError,
  UpstreamError,
  ValidationError,
  RateLimitError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError
} = require('../../gateway/errors/GatewayError');

describe('Gateway Error Classification Hierarchy', () => {
  it('should instantiate base GatewayError with default attributes', () => {
    const err = new GatewayError('General error');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(GatewayError);
    expect(err.statusCode).toBe(500);
    expect(err.code).toBe('gateway_error');
    expect(err.type).toBe('api_error');
    expect(err.toJSON()).toEqual({
      error: {
        message: 'General error',
        type: 'api_error',
        code: 'gateway_error'
      }
    });
  });

  it('should format ValidationError correctly with details and requestId', () => {
    const err = new ValidationError('Invalid parameters provided', {
      requestId: 'req-test-123',
      details: ['PORT must be integer', 'ROUND_DELAY_MS must be >= 1']
    });
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe('validation_error');
    expect(err.type).toBe('invalid_request_error');
    expect(err.requestId).toBe('req-test-123');
    expect(err.toJSON()).toEqual({
      error: {
        message: 'Invalid parameters provided',
        type: 'invalid_request_error',
        code: 'validation_error',
        requestId: 'req-test-123',
        details: ['PORT must be integer', 'ROUND_DELAY_MS must be >= 1']
      }
    });
  });

  it('should instantiate UpstreamError with 502 status', () => {
    const err = new UpstreamError('NVIDIA API unreachable', { requestId: 'req-999' });
    expect(err.statusCode).toBe(502);
    expect(err.code).toBe('upstream_error');
    expect(err.type).toBe('upstream_error');
    expect(err.toJSON().error.requestId).toBe('req-999');
  });

  it('should instantiate RateLimitError with 429 status', () => {
    const err = new RateLimitError('Too many requests');
    expect(err.statusCode).toBe(429);
    expect(err.code).toBe('rate_limit_exceeded');
    expect(err.type).toBe('rate_limit_error');
  });

  it('should instantiate AuthenticationError and AuthorizationError correctly', () => {
    const authErr = new AuthenticationError('Invalid API token');
    expect(authErr.statusCode).toBe(401);
    expect(authErr.code).toBe('invalid_api_key');

    const permErr = new AuthorizationError('Access forbidden');
    expect(permErr.statusCode).toBe(403);
    expect(permErr.code).toBe('forbidden');
  });

  it('should instantiate NotFoundError with 404 status', () => {
    const notFound = new NotFoundError('Model not found');
    expect(notFound.statusCode).toBe(404);
    expect(notFound.code).toBe('not_found');
  });
});
