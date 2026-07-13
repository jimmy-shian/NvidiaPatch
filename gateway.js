const express = require('express');
const cors = require('cors');

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

  // Routers
  const adminRouter = require('./gateway/routes/adminRoutes');
  const chatRouter = require('./gateway/routes/chatRoutes');

  app.use(adminRouter);
  app.use(chatRouter);

  return app;
}

module.exports = {
  createGatewayApp
};