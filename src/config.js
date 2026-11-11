'use strict';

/**
 * Configurazione applicativa letta da variabili d'ambiente.
 * Vedi .env.example per l'elenco completo.
 */

const fs = require('fs');
const crypto = require('crypto');

function bool(value, fallback = false) {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

/**
 * Formato AUTH_USERS: "utente1:password1,utente2:password2"
 * La password puo' essere in chiaro oppure un hash bcrypt ($2a$/$2b$/$2y$...).
 * Formato AUTH_USERS_FILE: file JSON [{ "username": "...", "password": "..." }]
 * oppure { "utente": "password", ... }.
 */
function parseUsers() {
  const users = new Map();

  const raw = process.env.AUTH_USERS || '';
  raw
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .forEach((pair) => {
      const idx = pair.indexOf(':');
      if (idx <= 0) {
        console.warn(`[config] voce AUTH_USERS ignorata (formato atteso utente:password): "${pair.slice(0, 20)}..."`);
        return;
      }
      users.set(pair.slice(0, idx).trim(), pair.slice(idx + 1));
    });

  const file = process.env.AUTH_USERS_FILE;
  if (file) {
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (Array.isArray(data)) {
        data.forEach((u) => u && u.username && u.password && users.set(String(u.username), String(u.password)));
      } else if (data && typeof data === 'object') {
        Object.entries(data).forEach(([u, p]) => users.set(u, String(p)));
      }
    } catch (err) {
      console.error(`[config] impossibile leggere AUTH_USERS_FILE (${file}): ${err.message}`);
    }
  }

  return users;
}

const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  console.warn('[config] SESSION_SECRET non impostato: generato un segreto casuale (le sessioni non sopravvivono al riavvio).');
}

const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  robotApiUrl: process.env.ROBOT_API_URL || 'http://159.8.215.146:8000/robot-events/',
  robotApiKey: process.env.ROBOT_API_KEY || '',
  robotApiTimeoutMs: parseInt(process.env.ROBOT_API_TIMEOUT_MS || '15000', 10),
  sessionSecret: sessionSecret || crypto.randomBytes(32).toString('hex'),
  sessionMaxAgeHours: parseFloat(process.env.SESSION_MAX_AGE_HOURS || '8'),
  cookieSecure: bool(process.env.COOKIE_SECURE, false),
  trustProxy: bool(process.env.TRUST_PROXY, false),
  users: parseUsers(),
};

module.exports = config;
