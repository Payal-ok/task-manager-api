'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { startServer, SECRET } = require('./helpers');
const { hashPassword, verifyPassword } = require('../src/auth');

describe('password hashing', () => {
  test('hashes are salted and verifiable', () => {
    const a = hashPassword('correct horse');
    const b = hashPassword('correct horse');
    assert.notEqual(a, b);
    assert.ok(verifyPassword('correct horse', a));
    assert.ok(!verifyPassword('wrong horse', a));
    assert.ok(!verifyPassword('anything', 'not-a-valid-hash'));
  });
});

describe('auth API', () => {
  let ctx;
  before(async () => { ctx = await startServer(); });
  after(async () => { await ctx.close(); });

  test('GET /api/health works without a token', async () => {
    const res = await ctx.request('GET', '/api/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'ok');
  });

  test('register returns 201, a token, and never the password', async () => {
    const res = await ctx.request('POST', '/api/auth/register', {
      body: { email: 'Ann@Example.com', password: 'password123' },
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.user.email, 'ann@example.com'); // normalised to lowercase
    assert.ok(res.body.token);
    assert.ok(!JSON.stringify(res.body).includes('password123'));
  });

  test('the stored password is a hash, not plain text', () => {
    const row = ctx.db.prepare('SELECT password_hash FROM users WHERE email = ?').get('ann@example.com');
    assert.match(row.password_hash, /^scrypt\$[0-9a-f]+\$[0-9a-f]+$/);
    assert.ok(!row.password_hash.includes('password123'));
  });

  test('duplicate email (any letter case) is rejected with 409', async () => {
    const res = await ctx.request('POST', '/api/auth/register', {
      body: { email: 'ANN@example.com', password: 'password123' },
    });
    assert.equal(res.status, 409);
  });

  test('register validates email and password', async () => {
    const bad = await ctx.request('POST', '/api/auth/register', { body: { email: 'nope', password: 'short' } });
    assert.equal(bad.status, 400);
    assert.ok(bad.body.details.email);
    assert.ok(bad.body.details.password);

    const notObject = await ctx.request('POST', '/api/auth/register', { raw: '[]' });
    assert.equal(notObject.status, 400);
  });

  test('login succeeds with the right password', async () => {
    const res = await ctx.request('POST', '/api/auth/login', {
      body: { email: 'ann@example.com', password: 'password123' },
    });
    assert.equal(res.status, 200);
    assert.ok(res.body.token);
  });

  test('login gives the same error for a wrong password and an unknown email', async () => {
    const wrongPw = await ctx.request('POST', '/api/auth/login', {
      body: { email: 'ann@example.com', password: 'WRONG-password' },
    });
    const unknown = await ctx.request('POST', '/api/auth/login', {
      body: { email: 'nobody@example.com', password: 'password123' },
    });
    assert.equal(wrongPw.status, 401);
    assert.equal(unknown.status, 401);
    assert.deepEqual(wrongPw.body, unknown.body);
  });

  test('GET /api/auth/me needs a valid token', async () => {
    const { token } = await ctx.register('me@example.com');
    const ok = await ctx.request('GET', '/api/auth/me', { token });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.user.email, 'me@example.com');

    assert.equal((await ctx.request('GET', '/api/auth/me')).status, 401);
    assert.equal((await ctx.request('GET', '/api/auth/me', { token: 'garbage' })).status, 401);
  });

  test('tokens signed with another secret or already expired are rejected', async () => {
    const forged = jwt.sign({ sub: '1', email: 'ann@example.com' }, 'some-other-secret');
    assert.equal((await ctx.request('GET', '/api/tasks', { token: forged })).status, 401);

    const expired = jwt.sign({ sub: '1', email: 'ann@example.com' }, SECRET, { expiresIn: -10 });
    assert.equal((await ctx.request('GET', '/api/tasks', { token: expired })).status, 401);
  });

  test('a token for a deleted user is rejected', async () => {
    const { token } = await ctx.register('temp@example.com');
    ctx.db.prepare('DELETE FROM users WHERE email = ?').run('temp@example.com');
    assert.equal((await ctx.request('GET', '/api/tasks', { token })).status, 401);
  });

  test('invalid JSON gets a clean 400, unknown routes a 404', async () => {
    const badJson = await ctx.request('POST', '/api/auth/login', { raw: '{not json' });
    assert.equal(badJson.status, 400);
    assert.match(badJson.body.error, /JSON/);

    const missing = await ctx.request('GET', '/api/nope');
    assert.equal(missing.status, 404);
  });
});

describe('rate limiting', () => {
  test('auth endpoints return 429 after too many requests', async () => {
    const ctx = await startServer({ rateLimitOptions: { max: 3, windowMs: 60_000 } });
    try {
      const statuses = [];
      for (let i = 0; i < 5; i++) {
        const res = await ctx.request('POST', '/api/auth/login', { body: { email: 'x@example.com', password: 'whatever1' } });
        statuses.push(res.status);
      }
      assert.deepEqual(statuses, [401, 401, 401, 429, 429]);

      const limited = await ctx.request('POST', '/api/auth/login', { body: { email: 'x@example.com', password: 'whatever1' } });
      assert.ok(limited.headers.get('retry-after'));
    } finally {
      await ctx.close();
    }
  });
});
