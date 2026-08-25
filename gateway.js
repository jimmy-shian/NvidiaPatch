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

function closeGatewayResources() {
  try {
    const adminRouter = require('./gateway/routes/adminRoutes');
    if (typeof adminRouter.stopHealthBroadcast === 'function') {
      adminRouter.stopHealthBroadcast();
    }
  } catch (_) {}
  try {
    const eventManager = require('./gateway/sse/eventManager');
    if (typeof eventManager.closeAll === 'function') {
      eventManager.closeAll();
    }
  } catch (_) {}
}

function startGatewayResources() {
  try {
    const adminRouter = require('./gateway/routes/adminRoutes');
    if (typeof adminRouter.startHealthBroadcast === 'function') {
      adminRouter.startHealthBroadcast();
    }
  } catch (_) {}
}

module.exports = {
  createGatewayApp,
  closeGatewayResources,
  startGatewayResources
};