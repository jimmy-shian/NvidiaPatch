const crypto = require('crypto');

function requestIdMiddleware(req, res, next) {
  const incomingId = req.headers['x-request-id'];
  const reqId = (incomingId && typeof incomingId === 'string' && incomingId.trim()) 
    ? incomingId.trim() 
    : crypto.randomUUID();

  req.id = reqId;
  req.requestId = reqId;
  res.setHeader('x-request-id', reqId);
  next();
}

module.exports = requestIdMiddleware;
