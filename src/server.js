'use strict';

const { createDb } = require('./db');
const { createApp } = require('./app');

const PORT = Number(process.env.PORT) || 3000;
const DB_PATH = process.env.DB_PATH || './data/tasks.db';
const isProduction = process.env.NODE_ENV === 'production';

let jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) {
  if (isProduction) {
    console.error('JWT_SECRET must be set when NODE_ENV=production');
    process.exit(1);
  }
  jwtSecret = 'dev-only-secret-change-me';
  console.warn('Warning: using the default development JWT secret. Set JWT_SECRET for real use.');
}

const db = createDb(DB_PATH);
const app = createApp({ db, jwtSecret });

const server = app.listen(PORT, () => {
  console.log(`Task Manager API running at http://localhost:${PORT}  (database: ${DB_PATH})`);
});

function shutdown(signal) {
  console.log(`\n${signal} received, shutting down...`);
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
