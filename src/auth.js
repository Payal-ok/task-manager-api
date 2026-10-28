'use strict';

const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const { HttpError } = require('./errors');

const KEY_LENGTH = 64;


function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, KEY_LENGTH);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}


function verifyPassword(password, stored) {
  const [scheme, saltHex, hashHex] = String(stored).split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}


const DUMMY_HASH = hashPassword('dummy-password-for-timing');

function signToken(user, secret, expiresIn = '1h') {
  return jwt.sign({ sub: String(user.id), email: user.email }, secret, { expiresIn });
}


function authenticate({ db, secret }) {
  const findUser = db.prepare('SELECT id, email FROM users WHERE id = ?');
  return (req, _res, next) => {
    const header = req.get('authorization') || '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) {
      throw new HttpError(401, 'Missing or malformed Authorization header');
    }
    let payload;
    try {
      payload = jwt.verify(token, secret);
    } catch {
      throw new HttpError(401, 'Invalid or expired token');
    }
    const user = findUser.get(Number(payload.sub));
    if (!user) throw new HttpError(401, 'User no longer exists');
    req.user = user;
    next();
  };
}

module.exports = { hashPassword, verifyPassword, signToken, authenticate, DUMMY_HASH };
