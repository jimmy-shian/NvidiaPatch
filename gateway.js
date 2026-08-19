const express = require('express');
const cors = require('cors');
const requestIdMiddleware = require('./gateway/middleware/requestId');
const errorHandler = require('./gateway/middleware/errorHandler');

try {
  process.stdout.setDefaultEncoding('utf8');
  process.stderr.setDefaultEncoding('utf8');
} catch (err) {
  // ignore
}

function createGatewayApp() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '1gb' }));
  app.use(requestIdMiddleware);

  // Routers
  const adminRouter = require('./gateway/routes/adminRoutes');
  const chatRouter = require('./gateway/routes/chatRoutes');

  app.use(adminRouter);
  app.use(chatRouter);

  // Global Error Handler
  app.use(errorHandler);

  return app;
}

module.exports = {
  createGatewayApp
};