'use strict';

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cookieSession = require('cookie-session');
const rateLimit = require('express-rate-limit');

const config = require('./config');
const { verifyCredentials, requireAuthApi, requireAuthPage } = require('./auth');
const { validateEvent, sendEvent } = require('./robotApi');

const app = express();
const VIEWS = path.join(__dirname, '..', 'views');
const PUBLIC = path.join(__dirname, '..', 'public');

if (config.trustProxy) app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        // Il server puo' girare in HTTP semplice: niente upgrade forzato a HTTPS.
        'upgrade-insecure-requests': null,
      },
    },
    hsts: config.cookieSecure,
    crossOriginOpenerPolicy: config.cookieSecure,
    originAgentCluster: config.cookieSecure,
  })
);

app.use(express.json({ limit: '1mb' }));
app.use(
  cookieSession({
    name: 'amica_sess',
    keys: [config.sessionSecret],
    maxAge: config.sessionMaxAgeHours * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: 'strict',
    secure: config.cookieSecure,
  })
);

// Protezione CSRF semplice: le API che modificano stato accettano solo JSON
// (non inviabile cross-site senza preflight CORS) e cookie SameSite=strict.
function requireJson(req, res, next) {
  if (!req.is('application/json')) return res.status(415).json({ error: 'Content-Type deve essere application/json' });
  next();
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: 'Troppi tentativi di accesso. Riprova tra qualche minuto.' },
});

const sendLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Troppe richieste, rallenta.' },
});

// ---- Static assets (CSS/JS, nessun dato sensibile) ----
app.use('/static', express.static(PUBLIC, { maxAge: '1h', index: false }));

app.get('/healthz', (_req, res) => res.json({ status: 'ok' }));

// ---- Pagine ----
app.get('/login', (req, res) => {
  if (req.session && req.session.user) return res.redirect('/');
  res.sendFile(path.join(VIEWS, 'login.html'));
});

app.get('/', requireAuthPage, (_req, res) => {
  res.sendFile(path.join(VIEWS, 'app.html'));
});

// ---- API autenticazione ----
app.post('/api/login', loginLimiter, requireJson, async (req, res) => {
  const { username, password } = req.body || {};
  const ok = await verifyCredentials(username, password);
  if (!ok) return res.status(401).json({ error: 'Credenziali non valide' });
  req.session.user = username;
  req.session.loginAt = Date.now();
  res.json({ user: username });
});

app.post('/api/logout', (req, res) => {
  req.session = null;
  res.json({ ok: true });
});

app.get('/api/me', requireAuthApi, (req, res) => {
  res.json({ user: req.session.user, apiConfigured: Boolean(config.robotApiKey) });
});

// ---- API eventi robot (proxy verso Amica) ----
app.post('/api/events', requireAuthApi, sendLimiter, requireJson, async (req, res) => {
  const errors = validateEvent(req.body);
  if (errors.length) return res.status(400).json({ error: 'Dati non validi', details: errors });

  try {
    const result = await sendEvent(req.body);
    console.log(
      `[events] user=${req.session.user} patient_id=${result.sent.patient_id} type=${result.sent.type} -> ${result.status}`
    );
    res.status(result.status >= 200 && result.status < 300 ? 200 : 502).json({
      ok: result.status >= 200 && result.status < 300,
      upstreamStatus: result.status,
      response: result.body,
      sent: result.sent,
    });
  } catch (err) {
    console.error(`[events] errore: ${err.message}`);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ---- 404 / errori ----
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));
app.use((_req, res) => res.redirect('/'));

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON non valido' });
  console.error(err);
  res.status(500).json({ error: 'Errore interno' });
});

const server = app.listen(config.port, () => {
  console.log(`[server] in ascolto sulla porta ${config.port}`);
  console.log(`[server] endpoint robot-events: ${config.robotApiUrl}`);
  if (!config.robotApiKey) console.warn('[server] ATTENZIONE: ROBOT_API_KEY non impostata, gli invii falliranno.');
  if (config.users.size === 0) console.warn('[server] ATTENZIONE: nessun utente configurato (AUTH_USERS / AUTH_USERS_FILE).');
  else console.log(`[server] utenti configurati: ${config.users.size}`);
});

function shutdown(signal) {
  console.log(`[server] ricevuto ${signal}, chiusura...`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
