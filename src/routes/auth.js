'use strict';

const express = require('express');
const { HttpError } = require('../errors');
const { hashPassword, verifyPassword, signToken, authenticate, DUMMY_HASH } = require('../auth');
const { validateCredentials } = require('../validate');
const { rateLimit } = require('../rateLimit');

function authRoutes({ db, jwtSecret, rateLimitOptions }) {
  const router = express.Router();
  const findByEmail = db.prepare('SELECT * FROM users WHERE email = ?');
  const insertUser = db.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)');

  router.use(rateLimit(rateLimitOptions));

  // POST /api/auth/register
  router.post('/register', (req, res) => {
    const { email, password } = validateCredentials(req.body, { checkStrength: true });
    if (findByEmail.get(email)) throw new HttpError(409, 'An account with this email already exists');

    const { lastInsertRowid } = insertUser.run(email, hashPassword(password));
    const user = { id: Number(lastInsertRowid), email };
    res.status(201).json({ user, token: signToken(user, jwtSecret) });
  });

  // POST /api/auth/login
  router.post('/login', (req, res) => {
    const { email, password } = validateCredentials(req.body, { checkStrength: false });
    const row = findByEmail.get(email);
    // Always run a hash check so response time does not reveal whether the email exists.
    const ok = verifyPassword(password, row ? row.password_hash : DUMMY_HASH);
    if (!row || !ok) throw new HttpError(401, 'Invalid email or password');

    const user = { id: row.id, email: row.email };
    res.json({ user, token: signToken(user, jwtSecret) });
  });

  // GET /api/auth/me
  router.get('/me', authenticate({ db, secret: jwtSecret }), (req, res) => {
    res.json({ user: req.user });
  });

  return router;
}

module.exports = { authRoutes };
