'use strict';

const { createDb } = require('../src/db');
const { createApp } = require('../src/app');

const SECRET = 'test-secret';


async function startServer(options = {}) {
  const db = createDb(':memory:');
  const app = createApp({ db, jwtSecret: SECRET, rateLimitOptions: { max: 1000 }, ...options });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  async function request(method, path, { body, token, raw } = {}) {
    const headers = {};
    if (body !== undefined || raw !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(baseUrl + path, {
      method,
      headers,
      body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null };
  }

  async function register(email, password = 'password123') {
    const res = await request('POST', '/api/auth/register', { body: { email, password } });
    return { ...res, token: res.body && res.body.token };
  }

  async function close() {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    db.close();
  }

  return { db, request, register, close };
}

module.exports = { startServer, SECRET };
