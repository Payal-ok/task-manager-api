'use strict';

const express = require('express');
const { HttpError } = require('./errors');
const { authRoutes } = require('./routes/auth');
const { taskRoutes } = require('./routes/tasks');


function createApp({ db, jwtSecret, rateLimitOptions }) {
  if (!db) throw new Error('createApp needs a database');
  if (!jwtSecret) throw new Error('createApp needs a jwtSecret');

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '10kb' }));

  app.get('/api/health', (_req, res) => res.json({ status: 'ok', uptime: process.uptime() }));
  app.use('/api/auth', authRoutes({ db, jwtSecret, rateLimitOptions }));
  app.use('/api/tasks', taskRoutes({ db, jwtSecret }));

  app.use((_req, _res, next) => next(new HttpError(404, 'Route not found')));

  app.use((err, _req, res, _next) => {
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: err.message, ...(err.details && { details: err.details }) });
    }
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Request body is not valid JSON' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request body too large' });
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

module.exports = { createApp };
