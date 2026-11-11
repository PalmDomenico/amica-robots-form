'use strict';

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const config = require('./config');

const BCRYPT_RE = /^\$2[aby]\$\d{2}\$/;

// Hash fittizio per uniformare i tempi di risposta quando l'utente non esiste.
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', 10);

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

async function verifyCredentials(username, password) {
  if (typeof username !== 'string' || typeof password !== 'string') return false;
  const stored = config.users.get(username);

  if (stored === undefined) {
    await bcrypt.compare(password, DUMMY_HASH);
    return false;
  }
  if (BCRYPT_RE.test(stored)) {
    return bcrypt.compare(password, stored);
  }
  return safeEqual(password, stored);
}

/** Middleware per le API JSON: 401 se non autenticato. */
function requireAuthApi(req, res, next) {
  if (req.session && req.session.user) return next();
  return res.status(401).json({ error: 'Non autenticato' });
}

/** Middleware per le pagine HTML: redirect a /login se non autenticato. */
function requireAuthPage(req, res, next) {
  if (req.session && req.session.user) return next();
  return res.redirect('/login');
}

module.exports = { verifyCredentials, requireAuthApi, requireAuthPage };
