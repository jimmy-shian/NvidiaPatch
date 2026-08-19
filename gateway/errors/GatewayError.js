/**
 * 統一 Gateway 錯誤分類體系
 */

class GatewayError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = options.statusCode || 500;
    this.code = options.code || 'gateway_error';
    this.type = options.type || 'api_error';
    this.requestId = options.requestId || null;
    this.details = options.details || null;
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    return {
      error: {
        message: this.message,
        type: this.type,
        code: this.code,
        ...(this.requestId ? { requestId: this.requestId } : {}),
        ...(this.details ? { details: this.details } : {})
      }
    };
  }
}

class UpstreamError extends GatewayError {
  constructor(message, options = {}) {
    super(message, {
      statusCode: options.statusCode || 502,
      code: options.code || 'upstream_error',
      type: options.type || 'upstream_error',
      ...options
    });
  }
}

class ValidationError extends GatewayError {
  constructor(message, options = {}) {
    super(message, {
      statusCode: options.statusCode || 400,
      code: options.code || 'validation_error',
      type: options.type || 'invalid_request_error',
      ...options
    });
  }
}

class RateLimitError extends GatewayError {
  constructor(message, options = {}) {
    super(message, {
      statusCode: options.statusCode || 429,
      code: options.code || 'rate_limit_exceeded',
      type: options.type || 'rate_limit_error',
      ...options
    });
  }
}

class AuthenticationError extends GatewayError {
  constructor(message, options = {}) {
    super(message, {
      statusCode: options.statusCode || 401,
      code: options.code || 'invalid_api_key',
      type: options.type || 'authentication_error',
      ...options
    });
  }
}

class AuthorizationError extends GatewayError {
  constructor(message, options = {}) {
    super(message, {
      statusCode: options.statusCode || 403,
      code: options.code || 'forbidden',
      type: options.type || 'permission_error',
      ...options
    });
  }
}

class NotFoundError extends GatewayError {
  constructor(message, options = {}) {
    super(message, {
      statusCode: options.statusCode || 404,
      code: options.code || 'not_found',
      type: options.type || 'invalid_request_error',
      ...options
    });
  }
}

module.exports = {
  GatewayError,
  UpstreamError,
  ValidationError,
  RateLimitError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError
};
