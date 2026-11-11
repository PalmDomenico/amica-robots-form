'use strict';

const config = require('./config');

const ISO_8601_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:?\d{2})$/;

function isIsoDate(value) {
  return typeof value === 'string' && ISO_8601_RE.test(value) && !Number.isNaN(Date.parse(value));
}

/**
 * Valida il corpo secondo la documentazione dell'endpoint /robot-events/.
 * Restituisce un array di errori (vuoto se valido).
 */
function validateEvent(body) {
  const errors = [];
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return ['Il corpo della richiesta deve essere un oggetto JSON'];
  }
  const { patient_id, timestamp, type, payload } = body;

  if (typeof patient_id !== 'string' || !patient_id.trim()) errors.push('patient_id e\' obbligatorio (stringa)');
  if (!isIsoDate(timestamp)) errors.push('timestamp deve essere una data ISO 8601 (es. 2026-04-10T11:02:32Z)');
  if (typeof type !== 'string' || !type.trim()) errors.push('type e\' obbligatorio (stringa)');
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    errors.push('payload deve essere un oggetto JSON');
  } else if (payload.entries !== undefined) {
    if (!Array.isArray(payload.entries)) {
      errors.push('payload.entries deve essere un array');
    } else {
      payload.entries.forEach((e, i) => {
        if (!e || typeof e !== 'object') return errors.push(`entries[${i}] deve essere un oggetto`);
        if (!isIsoDate(e.timestamp)) errors.push(`entries[${i}].timestamp non valido`);
        if (typeof e.type !== 'string' || !e.type.trim()) errors.push(`entries[${i}].type obbligatorio`);
        if (typeof e.content !== 'string') errors.push(`entries[${i}].content deve essere una stringa`);
      });
    }
  }
  ['session_start', 'session_end'].forEach((k) => {
    if (payload && payload[k] !== undefined && !isIsoDate(payload[k])) errors.push(`payload.${k} non valido`);
  });
  return errors;
}

/**
 * Inoltra l'evento all'endpoint Amica con l'API key lato server.
 * Restituisce { status, body } con la risposta dell'API remota.
 */
async function sendEvent(event) {
  if (!config.robotApiKey) {
    const err = new Error('ROBOT_API_KEY non configurata sul server');
    err.status = 500;
    throw err;
  }

  const body = {
    patient_id: event.patient_id.trim(),
    timestamp: event.timestamp,
    type: event.type.trim(),
    payload: event.payload,
  };

  let response;
  try {
    response = await fetch(config.robotApiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.robotApiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(config.robotApiTimeoutMs),
    });
  } catch (cause) {
    const timeout = cause && (cause.name === 'TimeoutError' || cause.name === 'AbortError');
    const err = new Error(timeout ? 'Timeout nella chiamata all\'API robot-events' : `API robot-events non raggiungibile: ${cause.message}`);
    err.status = timeout ? 504 : 502;
    throw err;
  }

  const text = await response.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = { raw: text };
  }
  return { status: response.status, body: parsed, sent: body };
}

module.exports = { validateEvent, sendEvent };
