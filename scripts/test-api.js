#!/usr/bin/env node
'use strict';

/**
 * Script di test per verificare la connettività e l'autenticazione verso l'endpoint Amica.
 * 
 * Uso:
 *   node scripts/test-api.js <API_KEY> [URL]
 * 
 * Oppure leggendo da variabile d'ambiente:
 *   ROBOT_API_KEY="xxx" node scripts/test-api.js
 */

const apiKey = process.argv[2] || process.env.ROBOT_API_KEY;
const url = process.argv[3] || process.env.ROBOT_API_URL || 'http://159.8.215.146:8000/robot-events/';

if (!apiKey) {
  console.error('\nErrore: API Key mancante!');
  console.error('Uso: node scripts/test-api.js <CHIAVE_API> [URL]\n');
  process.exit(1);
}

// Rimuove l'eventuale prefisso "Bearer " se già presente per errore
const cleanKey = apiKey.trim().replace(/^Bearer\s+/i, '');

const samplePayload = {
  patient_id: 'robot_test_cli',
  timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
  type: 'ai_answer',
  payload: {
    entries: [
      {
        timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
        type: 'ai_question',
        content: 'Test connessione da script CLI'
      }
    ]
  }
};

async function testAuth(authHeader) {
  console.log(`\n--------------------------------------------------`);
  console.log(`Test con header: "${authHeader}"`);
  console.log(`Target URL:      ${url}`);
  console.log(`--------------------------------------------------`);

  try {
    const res = await fetch(url, {
      method: 'POST',
      redirect: 'manual', // Non seguire i redirect in automatico per vedere se ce ne sono
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(samplePayload)
    });

    console.log(`Status HTTP:     ${res.status} ${res.statusText}`);
    
    if (res.status >= 300 && res.status < 400) {
      console.log(`⚠️  REDIRECT RILEVATO! Location: ${res.headers.get('location')}`);
      console.log(`    (Attenzione: se manca lo slash finale '/' il server fa redirect e perde le credenziali)`);
    }

    const text = await res.text();
    try {
      const json = JSON.parse(text);
      console.log(`Risposta Body:  `, JSON.stringify(json, null, 2));
    } catch {
      console.log(`Risposta Body:  `, text);
    }

    return res.status;
  } catch (err) {
    console.error(`Errore di connessione:`, err.message);
    return null;
  }
}

(async () => {
  // 1. Prova con "Bearer <token>" (standard documentazione)
  const status1 = await testAuth(`Bearer ${cleanKey}`);
  
  // 2. Se dà 403, prova anche con "Token <token>" (formato tipico Django REST Framework)
  if (status1 === 403) {
    console.log('\nTentativo alternativo (formato Django Token)...');
    await testAuth(`Token ${cleanKey}`);
  }
})();
