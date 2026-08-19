const { GatewayError } = require('../errors/GatewayError');
const { logger } = require('../logs/logger');

function errorHandler(err, req, res, next) {
  const requestId = req?.id || err?.requestId || null;

  if (res.headersSent) {
    logger.error('Error occurred after headers were already sent', {
      requestId,
      error: err.message,
      stack: err.stack
    });
    return next(err);
  }

  let statusCode = 500;
  let errorResponse = {
    message: err.message || 'Internal Server Error',
    type: 'api_error',
    code: 'internal_error'
  };

  if (err instanceof GatewayError) {
    statusCode = err.statusCode;
    errorResponse = {
      message: err.message,
      type: err.type,
      code: err.code
    };
    if (err.details) {
      errorResponse.details = err.details;
    }
  } else if (err.status || err.statusCode) {
    statusCode = err.status || err.statusCode;
    errorResponse.message = err.message;
  }

  if (requestId) {
    errorResponse.requestId = requestId;
  }

  logger.error(`[HTTP ${statusCode}] ${errorResponse.message}`, {
    requestId,
    statusCode,
    type: errorResponse.type,
    code: errorResponse.code,
    path: req.originalUrl || req.url,
    method: req.method,
    stack: statusCode >= 500 ? err.stack : undefined
  });

  return res.status(statusCode).json({ error: errorResponse });
}

module.exports = errorHandler;
