(function () {
  'use strict';

  // ------------------------------------------------------------------
  // Costanti e utilita'
  // ------------------------------------------------------------------
  const STORAGE_DRAFT = 'amica_draft_v1';
  const STORAGE_HISTORY = 'amica_history_v1';
  const TAGS = ['', 'QUIZ', 'QUESTIONARIO', 'STORIA'];
  const TAG_RE = /^\[([A-Z0-9_]+)\]\s?/;

  const TYPE_HINTS = {
    dialog:
      'Sessione guidata o continuativa (storie, quiz, questionari). Calcola in automatico inizio/fine e supporta battute multiple.',
    ai_answer:
      'Domanda dell\'ospite e risposta elaborata dall\'intelligenza artificiale del robot (es. Aphelino o Genoveffa).',
    ai_question:
      'Singola domanda rivolta all\'assistente AI prima della risposta.',
    question:
      'Singolo intervento vocale o risposta secca dell\'ospite.',
    answer:
      'Singola battuta o messaggio di benvenuto pronunciato dal robot.',
    __custom:
      'Tipo evento personalizzato: struttura il payload liberamente con voci e campi aggiuntivi.',
  };

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const pad = (n) => String(n).padStart(2, '0');
  const uid = () => Math.random().toString(36).slice(2, 10);

  function dateToLocal(d) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }
  function localToDate(s) {
    if (!s) return null;
    const d = new Date(s.length === 16 ? s + ':00' : s);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  function localToIso(s) {
    const d = localToDate(s);
    return d ? d.toISOString().replace(/\.\d{3}Z$/, 'Z') : '';
  }
  function isoToLocal(iso) {
    if (!iso) return '';
    const d = new Date(typeof iso === 'object' && iso.$date ? iso.$date : iso);
    return Number.isNaN(d.getTime()) ? '' : dateToLocal(d);
  }
  function addSeconds(s, sec) {
    const d = localToDate(s);
    return d ? dateToLocal(new Date(d.getTime() + sec * 1000)) : '';
  }
  const nowLocal = () => dateToLocal(new Date());

  function roleOf(type) {
    switch ((type || '').trim()) {
      case 'answer': return { text: 'Robot', cls: 'role-robot' };
      case 'question': return { text: 'Utente', cls: 'role-user' };
      case 'ai_question': return { text: 'Utente → AI', cls: 'role-user' };
      case 'ai_answer': return { text: 'AI', cls: 'role-ai' };
      case 'video':
      case 'dance': return { text: 'Azione robot', cls: 'role-action' };
      default: return { text: 'Voce', cls: '' };
    }
  }

  // ------------------------------------------------------------------
  // Stato
  // ------------------------------------------------------------------
  function emptyState() {
    const tsBase = nowLocal();
    return {
      patientMode: 'patient',
      patientId: '1234',
      type: 'dialog',
      customType: '',
      timestamp: tsBase,
      sessionAuto: true,
      sessionStart: '',
      sessionEnd: '',
      blocks: [
        makeBlock('pair', {
          timestamp: tsBase,
          typeA: 'answer',
          contentA: 'Ciao! Vuoi fare una storia o un gioco insieme?',
          typeB: 'question',
          contentB: 'Sì, volentieri!'
        })
      ],
      extraJson: '',
    };
  }

  let state = loadDraft() || emptyState();

  function loadDraft() {
    try {
      const raw = localStorage.getItem(STORAGE_DRAFT);
      if (!raw) return null;
      const s = Object.assign(emptyState(), JSON.parse(raw));
      if (!Array.isArray(s.blocks)) s.blocks = [];
      return s;
    } catch {
      return null;
    }
  }
  let saveTimer;
  function saveDraft() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { localStorage.setItem(STORAGE_DRAFT, JSON.stringify(state)); } catch { /* quota */ }
    }, 250);
  }

  const effectiveType = () => (state.type === '__custom' ? state.customType.trim() : state.type);
  const effectivePatientId = () => {
    const id = state.patientId.trim();
    if (!id) return '';
    return state.patientMode === 'robot' && !id.startsWith('robot_') ? 'robot_' + id : id;
  };

  // Tipi predefiniti delle voci in base al tipo evento.
  function defaultTypes(kind) {
    const t = effectiveType();
    if (t === 'ai_question' || t === 'ai_answer') {
      return kind === 'single' ? { a: t } : { a: 'ai_question', b: 'ai_answer' };
    }
    if (kind === 'single') {
      if (t === 'question' || t === 'answer') return { a: t };
      return { a: 'answer' };
    }
    return { a: 'answer', b: 'question' };
  }

  function lastEntryTimestamp() {
    let last = '';
    state.blocks.forEach((b) => {
      [b.a, b.b].forEach((p) => {
        if (p && p.timestamp && (!last || localToDate(p.timestamp) > localToDate(last))) last = p.timestamp;
      });
    });
    return last;
  }
  function stepSeconds() {
    const v = parseInt($('#auto-step').value, 10);
    return Number.isFinite(v) && v >= 0 ? v : 5;
  }
  function baseTimestamp() {
    if (effectiveType() === 'dialog' && !state.sessionAuto && state.sessionStart) return state.sessionStart;
    return state.timestamp || nowLocal();
  }
  function nextTimestamp() {
    const last = lastEntryTimestamp();
    return last ? addSeconds(last, stepSeconds()) : baseTimestamp();
  }

  function makeBlock(kind, opts) {
    opts = opts || {};
    const types = defaultTypes(kind === 'single' ? 'single' : 'pair');
    const ts = opts.timestamp || nextTimestamp();
    const block = {
      id: uid(),
      kind,
      tag: opts.tag !== undefined ? opts.tag : '',
      a: { type: opts.typeA || types.a, timestamp: ts, content: opts.contentA || '' },
    };
    if (kind !== 'single') {
      block.b = {
        type: opts.typeB || types.b,
        timestamp: opts.timestampB || addSeconds(ts, stepSeconds()),
        content: opts.contentB || '',
      };
    }
    return block;
  }

  // ------------------------------------------------------------------
  // Costruzione del corpo della richiesta
  // ------------------------------------------------------------------
  function applyTag(tag, content) {
    const c = content || '';
    if (!tag) return c;
    const m = c.match(TAG_RE);
    if (m && m[1] === tag) return c;
    return `[${tag}] ${c}`;
  }

  function parseExtra() {
    const txt = state.extraJson.trim();
    if (!txt) return { value: {}, error: null };
    try {
      const v = JSON.parse(txt);
      if (!v || typeof v !== 'object' || Array.isArray(v)) return { value: {}, error: 'Deve essere un oggetto JSON { ... }' };
      return { value: v, error: null };
    } catch (e) {
      return { value: {}, error: 'JSON non valido: ' + e.message };
    }
  }

  function buildBody() {
    const entries = [];
    state.blocks.forEach((b) => {
      [b.a, b.b].forEach((p) => {
        if (!p) return;
        entries.push({ timestamp: localToIso(p.timestamp), type: (p.type || '').trim(), content: applyTag(b.tag, p.content) });
      });
    });

    const generated = {};
    if (effectiveType() === 'dialog') {
      const s = sessionBounds(entries);
      generated.session_start = s.start;
      generated.session_end = s.end;
    }
    generated.entries = entries;

    const extra = parseExtra().value;
    const payload = Object.assign({}, generated);
    Object.keys(extra).forEach((k) => { if (!(k in generated)) payload[k] = extra[k]; });

    return {
      patient_id: effectivePatientId(),
      timestamp: localToIso(state.timestamp),
      type: effectiveType(),
      payload,
    };
  }

  function sessionBounds(entries) {
    if (!state.sessionAuto) return { start: localToIso(state.sessionStart), end: localToIso(state.sessionEnd) };
    const times = entries.map((e) => e.timestamp).filter(Boolean).sort();
    const fallback = localToIso(state.timestamp);
    return { start: times[0] || fallback, end: times[times.length - 1] || fallback };
  }

  function validate(body) {
    const issues = [];
    const err = (m) => issues.push({ level: 'error', msg: m });
    const warn = (m) => issues.push({ level: 'warn', msg: m });

    if (!body.patient_id) err('patient_id obbligatorio');
    if (!body.timestamp) err('timestamp evento obbligatorio');
    if (!body.type) err('type obbligatorio');
    if (body.type === 'dialog') {
      if (!body.payload.session_start || !body.payload.session_end) err('session_start e session_end obbligatori per dialog');
      else if (body.payload.session_start > body.payload.session_end) warn('session_start successivo a session_end');
    }
    const entries = body.payload.entries || [];
    if (!entries.length) warn('Nessuna voce in payload.entries');
    entries.forEach((e, i) => {
      if (!e.type) err(`Voce ${i + 1}: type mancante`);
      if (!e.timestamp) err(`Voce ${i + 1}: timestamp mancante`);
      if (!e.content.replace(TAG_RE, '').trim()) warn(`Voce ${i + 1}: content vuoto`);
    });
    const ex = parseExtra();
    if (ex.error) err('Campi aggiuntivi: ' + ex.error);
    return issues;
  }

  // ------------------------------------------------------------------
  // Rendering
  // ------------------------------------------------------------------
  function renderHeader() {
    $('#patient-mode').value = state.patientMode;
    $('#patient-prefix').hidden = state.patientMode !== 'robot';
    $('#patient-id').value = state.patientMode === 'robot' ? state.patientId.replace(/^robot_/, '') : state.patientId;
    $('#patient-id').placeholder = state.patientMode === 'robot' ? 'es. EAA007UBT10000011' : 'es. PAT000001';
    $('#event-type').value = state.type;
    $('#custom-type-field').hidden = state.type !== '__custom';
    $('#custom-type').value = state.customType;
    $('#event-ts').value = state.timestamp;
    $('#type-hint').textContent = TYPE_HINTS[state.type] || '';

    const isDialog = effectiveType() === 'dialog';
    const isCustom = state.type === '__custom';
    $('#session-card').hidden = !isDialog;
    $('#entries-step').textContent = isDialog ? '3' : '2';
    $$('.card-details .step')[0].textContent = isDialog ? '4' : '3';

    // Gestione visibilita' selettiva dei pulsanti di aggiunta in base al tipo
    const btnPair = $('[data-add="pair"]');
    const btnRating = $('[data-add="rating"]');
    const btnSingle = $('[data-add="single"]');
    const retimeBtn = $('#retime-btn');
    const autoStepField = $('#auto-step')?.closest('.field-inline');

    if (btnPair) btnPair.hidden = !isDialog && !isCustom;
    if (btnRating) btnRating.hidden = !isDialog && !isCustom;
    if (btnSingle) {
      if (state.type === 'ai_answer') {
        btnSingle.hidden = true; // per ai_answer c'e' solo la coppia
      } else {
        btnSingle.hidden = false;
      }
    }
    if (retimeBtn) retimeBtn.hidden = !isDialog;
    if (autoStepField) autoStepField.hidden = !isDialog;

    $('#session-auto').checked = state.sessionAuto;
    ['session-start', 'session-end'].forEach((id) => {
      const el = $('#' + id);
      el.disabled = state.sessionAuto;
      $(`[data-now="${id}"]`).disabled = state.sessionAuto;
    });
    $('#extra-json').value = state.extraJson;
  }

  function syncSessionInputs(body) {
    if (effectiveType() !== 'dialog') return;
    if (state.sessionAuto) {
      $('#session-start').value = isoToLocal(body.payload.session_start);
      $('#session-end').value = isoToLocal(body.payload.session_end);
    } else {
      $('#session-start').value = state.sessionStart;
      $('#session-end').value = state.sessionEnd;
    }
  }

  function buildTagSelect(select, value) {
    select.textContent = '';
    TAGS.forEach((t) => {
      const o = document.createElement('option');
      o.value = t;
      o.textContent = t ? `[${t}]` : 'Nessuna categoria';
      select.appendChild(o);
    });
    select.value = TAGS.includes(value) ? value : '';
  }

  function toolButton(label, title, action, disabled) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'icon-btn' + (action === 'delete' ? ' icon-danger' : '');
    b.textContent = label;
    b.title = title;
    b.setAttribute('aria-label', title);
    b.dataset.action = action;
    b.disabled = !!disabled;
    return b;
  }

  function renderPart(container, block, key, label) {
    const part = block[key];
    container.appendChild($('#tpl-part').content.cloneNode(true));
    const role = roleOf(part.type);
    const lab = $('.part-label', container);
    lab.textContent = '';
    const roleSpan = document.createElement('span');
    roleSpan.className = 'role ' + role.cls;
    roleSpan.textContent = label || role.text;
    lab.append('type ', roleSpan);

    $$('[data-f]', container).forEach((el) => {
      const f = el.dataset.f;
      el.value = part[f] || '';
      el.addEventListener('input', () => {
        part[f] = el.value;
        if (f === 'type') {
          const r = roleOf(el.value);
          roleSpan.className = 'role ' + r.cls;
          roleSpan.textContent = label || r.text;
        }
        if (f === 'content') refreshRating(container, part);
        changed();
      });
    });

    if (block.kind === 'rating' && key === 'b') {
      const rating = $('.rating', container);
      rating.hidden = false;
      for (let i = 1; i <= 5; i++) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'chip';
        chip.textContent = String(i);
        chip.dataset.value = String(i);
        chip.addEventListener('click', () => {
          part.content = String(i);
          $('[data-f="content"]', container).value = part.content;
          refreshRating(container, part);
          changed();
        });
        rating.appendChild(chip);
      }
      refreshRating(container, part);
    }
  }

  function refreshRating(container, part) {
    $$('.chip', container).forEach((c) => c.classList.toggle('active', c.dataset.value === (part.content || '').trim()));
  }

  function renderBlocks() {
    const root = $('#blocks');
    root.textContent = '';
    let entryIdx = 0;

    state.blocks.forEach((block, i) => {
      const tpl = block.kind === 'single' ? '#tpl-single' : '#tpl-pair';
      const node = $(tpl).content.firstElementChild.cloneNode(true);
      node.dataset.id = block.id;

      const from = entryIdx + 1;
      entryIdx += block.kind === 'single' ? 1 : 2;
      const range = from === entryIdx ? `#${from}` : `#${from}–${entryIdx}`;
      const title = block.kind === 'single' ? 'Voce' : block.kind === 'rating' ? 'Valutazione 1-5' : 'Domanda / risposta';
      $('.block-title', node).textContent = `${title} · ${range}`;
      if (block.kind === 'rating') node.classList.add('block-rating');

      const tagSel = $('[data-f="tag"]', node);
      buildTagSelect(tagSel, block.tag);
      tagSel.addEventListener('change', () => { block.tag = tagSel.value; changed(); });

      const tools = $('.block-tools', node);
      tools.append(
        toolButton('↑', 'Sposta su', 'up', i === 0),
        toolButton('↓', 'Sposta giu\'', 'down', i === state.blocks.length - 1),
        toolButton('⧉', 'Duplica', 'dup'),
        toolButton('✕', 'Elimina', 'delete')
      );
      tools.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-action]');
        if (btn) blockAction(block.id, btn.dataset.action);
      });

      renderPart($('[data-part="a"]', node), block, 'a', block.kind === 'single' ? null : null);
      if (block.b) renderPart($('[data-part="b"]', node), block, 'b', null);

      setupDrag(node, $('.block-handle', node));
      root.appendChild(node);
    });

    $('#blocks-empty').hidden = state.blocks.length > 0;
    $('#entries-count').textContent = String(entryIdx);
  }

  function blockAction(id, action) {
    const i = state.blocks.findIndex((b) => b.id === id);
    if (i < 0) return;
    if (action === 'up' && i > 0) [state.blocks[i - 1], state.blocks[i]] = [state.blocks[i], state.blocks[i - 1]];
    if (action === 'down' && i < state.blocks.length - 1) [state.blocks[i + 1], state.blocks[i]] = [state.blocks[i], state.blocks[i + 1]];
    if (action === 'dup') {
      const copy = JSON.parse(JSON.stringify(state.blocks[i]));
      copy.id = uid();
      state.blocks.splice(i + 1, 0, copy);
    }
    if (action === 'delete') state.blocks.splice(i, 1);
    renderBlocks();
    changed();
  }

  // Drag & drop dei blocchi tramite la maniglia.
  let dragId = null;
  function setupDrag(node, handle) {
    handle.addEventListener('mousedown', () => { node.draggable = true; });
    handle.addEventListener('mouseup', () => { node.draggable = false; });
    node.addEventListener('dragstart', (e) => {
      dragId = node.dataset.id;
      node.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', dragId);
    });
    node.addEventListener('dragend', () => {
      node.draggable = false;
      node.classList.remove('dragging');
      $$('.block.drop-before, .block.drop-after').forEach((n) => n.classList.remove('drop-before', 'drop-after'));
      dragId = null;
    });
    node.addEventListener('dragover', (e) => {
      if (!dragId || dragId === node.dataset.id) return;
      e.preventDefault();
      const r = node.getBoundingClientRect();
      const after = e.clientY > r.top + r.height / 2;
      node.classList.toggle('drop-after', after);
      node.classList.toggle('drop-before', !after);
    });
    node.addEventListener('dragleave', () => node.classList.remove('drop-before', 'drop-after'));
    node.addEventListener('drop', (e) => {
      e.preventDefault();
      if (!dragId || dragId === node.dataset.id) return;
      const after = node.classList.contains('drop-after');
      const from = state.blocks.findIndex((b) => b.id === dragId);
      const moved = state.blocks.splice(from, 1)[0];
      let to = state.blocks.findIndex((b) => b.id === node.dataset.id);
      if (after) to += 1;
      state.blocks.splice(to, 0, moved);
      renderBlocks();
      changed();
    });
  }

  function renderPreview() {
    const body = buildBody();
    $('#preview').textContent = JSON.stringify(body, null, 2);
    syncSessionInputs(body);

    const issues = validate(body);
    const list = $('#issues');
    list.textContent = '';
    issues.forEach((it) => {
      const li = document.createElement('li');
      li.className = 'issue issue-' + it.level;
      li.textContent = it.msg;
      list.appendChild(li);
    });
    $('#send-btn').disabled = issues.some((i) => i.level === 'error') || sending;

    const ex = parseExtra();
    $('#extra-json-error').hidden = !ex.error;
    $('#extra-json-error').textContent = ex.error || '';
    return { body, issues };
  }

  function changed() {
    renderPreview();
    saveDraft();
  }

  function renderAll() {
    $('#result').hidden = true;
    renderHeader();
    renderBlocks();
    renderPreview();
  }

  // ------------------------------------------------------------------
  // Modelli
  // ------------------------------------------------------------------
  const QUESTIONARIO = [
    'Durante l\'attività con il robot, ti sei sentito allegro e di buon umore?',
    'Durante l\'attività con il robot, ti sei sentito calmo e rilassato?',
    'Durante l\'attività con il robot, hai fatto cose che ti piacciono?',
    'Durante l\'attività con il robot, ti sei sentito attivo e pieno di energia?',
    'Durante l\'attività con il robot, hai sentito interesse per ciò che stavi facendo?',
    'È stato piacevole interagire con il robot durante questa attività?',
    'È stato facile e intuitivo interagire con il robot durante questa attività?',
    'Ti piacerebbe ripetere questa attività con il robot?',
  ];

  function loadTemplate(name) {
    if (state.blocks.length && !window.confirm('Il modello sostituira\' le voci attuali. Continuare?')) return false;
    state.blocks = [];
    const tsBase = state.timestamp || nowLocal();
    const add = (kind, opts) => state.blocks.push(makeBlock(kind, Object.assign({ timestamp: state.blocks.length ? undefined : tsBase }, opts)));

    switch (name) {
      case 'questionario':
        state.type = 'dialog';
        add('pair', { tag: 'QUESTIONARIO', contentA: 'Ciao, mi ricordi, come ti chiami?', contentB: 'Mario' });
        QUESTIONARIO.forEach((q) => add('rating', { tag: 'QUESTIONARIO', contentA: q, contentB: '5' }));
        break;
      case 'quiz':
        state.type = 'dialog';
        add('pair', { tag: 'QUIZ', contentA: 'Qual è la capitale d\'Italia?', contentB: 'Roma' });
        add('pair', { tag: 'QUIZ', contentA: 'Quanti giorni ha una settimana?', contentB: 'Sette' });
        break;
      case 'storia':
        state.type = 'dialog';
        add('single', { tag: 'STORIA', typeA: 'answer', contentA: 'Vuoi ascoltare la storia di Cappuccetto Rosso?' });
        add('single', { tag: 'STORIA', typeA: 'question', contentA: 'Sì' });
        add('single', { tag: 'STORIA', typeA: 'answer', contentA: 'C\'era una volta una bambina che andava dalla nonna...' });
        break;
      case 'ai':
        state.type = 'ai_answer';
        state.patientMode = 'robot';
        if (!state.patientId) state.patientId = 'EAA007UBT10000011';
        add('pair', {
          tag: '',
          typeA: 'ai_question',
          contentA: 'Come ti chiami e cosa puoi fare?',
          typeB: 'ai_answer',
          contentB: 'Certo, mi chiamo Aphelino! Sono qui per farti compagnia, chiacchierare e farti fare esercizi stimolanti.'
        });
        break;
      case 'ai_question_sample':
        state.type = 'ai_question';
        state.patientMode = 'robot';
        if (!state.patientId) state.patientId = 'EAA007UBT10000011';
        add('single', { tag: '', typeA: 'ai_question', contentA: 'Quali sono gli orari di apertura del museo?' });
        break;
      case 'answer_sample':
        state.type = 'answer';
        state.patientMode = 'robot';
        if (!state.patientId) state.patientId = 'EAA007UBT10000011';
        add('single', { tag: '', typeA: 'answer', contentA: 'Ciao, benvenuto! Io sono qui per te.' });
        break;
      default:
        return false;
    }
    state.sessionAuto = true;
    renderAll();
    saveDraft();
    return true;
  }

  // ------------------------------------------------------------------
  // Import JSON
  // ------------------------------------------------------------------
  function importJson(text) {
    let data = JSON.parse(text);
    if (Array.isArray(data)) data = data[0];
    if (!data || typeof data !== 'object') throw new Error('Oggetto JSON atteso');

    let body;
    if (data.raw_body && typeof data.raw_body === 'object') body = data.raw_body;
    else if (data.source_id !== undefined && data.data) {
      body = { patient_id: data.source_id, type: data.type, timestamp: (data.occurred_at && data.occurred_at.$date) || data.occurred_at, payload: data.data };
    } else body = data;

    if (body.patient_id === undefined && body.type === undefined && body.payload === undefined) {
      throw new Error('Struttura non riconosciuta: servono patient_id, timestamp, type, payload');
    }

    const s = emptyState();
    const pid = String(body.patient_id || '');
    s.patientMode = pid.startsWith('robot_') ? 'robot' : 'patient';
    s.patientId = pid;
    const known = ['dialog', 'question', 'answer', 'ai_question', 'ai_answer'];
    if (known.includes(body.type)) s.type = body.type;
    else { s.type = '__custom'; s.customType = String(body.type || ''); }
    s.timestamp = isoToLocal(body.timestamp) || nowLocal();

    const payload = body.payload && typeof body.payload === 'object' ? body.payload : {};
    if (payload.session_start || payload.session_end) {
      s.sessionAuto = false;
      s.sessionStart = isoToLocal(payload.session_start);
      s.sessionEnd = isoToLocal(payload.session_end);
    }
    (Array.isArray(payload.entries) ? payload.entries : []).forEach((e) => {
      const content = String((e && e.content) || '');
      const m = content.match(TAG_RE);
      const tag = m && TAGS.includes(m[1]) ? m[1] : '';
      s.blocks.push({
        id: uid(),
        kind: 'single',
        tag,
        a: { type: String((e && e.type) || ''), timestamp: isoToLocal(e && e.timestamp), content: tag ? content.replace(TAG_RE, '') : content },
      });
    });
    const extra = {};
    Object.keys(payload).forEach((k) => { if (!['entries', 'session_start', 'session_end'].includes(k)) extra[k] = payload[k]; });
    s.extraJson = Object.keys(extra).length ? JSON.stringify(extra, null, 2) : '';
    state = s;
  }

  // ------------------------------------------------------------------
  // Storico invii (solo browser)
  // ------------------------------------------------------------------
  function getHistory() {
    try { return JSON.parse(localStorage.getItem(STORAGE_HISTORY)) || []; } catch { return []; }
  }
  function pushHistory(item) {
    const h = getHistory();
    h.unshift(item);
    localStorage.setItem(STORAGE_HISTORY, JSON.stringify(h.slice(0, 20)));
    renderHistory();
  }
  function renderHistory() {
    const h = getHistory();
    const ul = $('#history');
    ul.textContent = '';
    h.forEach((it) => {
      const li = document.createElement('li');
      li.className = it.ok ? 'ok' : 'ko';
      const top = document.createElement('div');
      top.className = 'history-top';
      const strong = document.createElement('strong');
      strong.textContent = it.patient_id;
      const badge = document.createElement('span');
      badge.className = 'badge ' + (it.ok ? 'badge-ok' : 'badge-err');
      badge.textContent = it.ok ? 'OK' : String(it.status || 'ERR');
      top.append(strong, badge);
      const meta = document.createElement('div');
      meta.className = 'muted small';
      meta.textContent = `${it.type} · ${it.entries} voci · ${new Date(it.at).toLocaleString('it-IT')}`;
      li.append(top, meta);
      ul.appendChild(li);
    });
    $('#history-empty').hidden = h.length > 0;

    const dl = $('#patient-history');
    dl.textContent = '';
    [...new Set(h.map((x) => x.patient_id))].slice(0, 10).forEach((p) => {
      const o = document.createElement('option');
      o.value = p;
      dl.appendChild(o);
    });
  }

  // ------------------------------------------------------------------
  // Invio
  // ------------------------------------------------------------------
  let sending = false;

  function showResult(kind, title, detail) {
    const box = $('#result');
    box.hidden = false;
    box.className = 'result result-' + kind;
    box.textContent = '';
    const h = document.createElement('strong');
    h.textContent = title;
    box.appendChild(h);
    if (detail !== undefined) {
      const det = document.createElement('details');
      const sum = document.createElement('summary');
      sum.textContent = 'Dettagli risposta';
      const pre = document.createElement('pre');
      pre.className = 'code';
      pre.textContent = typeof detail === 'string' ? detail : JSON.stringify(detail, null, 2);
      det.append(sum, pre);
      box.appendChild(det);
    }
  }

  async function send() {
    const { body, issues } = renderPreview();
    if (issues.some((i) => i.level === 'error')) return;

    const dlg = $('#confirm-dialog');
    $('#confirm-text').textContent =
      `Evento "${body.type}" per ${body.patient_id} con ${body.payload.entries.length} voci verra' scritto sulla piattaforma Amica.`;
    dlg.returnValue = '';
    dlg.showModal();
    const choice = await new Promise((resolve) => dlg.addEventListener('close', () => resolve(dlg.returnValue), { once: true }));
    if (choice !== 'ok') return;

    sending = true;
    const btn = $('#send-btn');
    btn.disabled = true;
    btn.textContent = 'Invio in corso...';
    try {
      const res = await fetch('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(body),
      });
      if (res.status === 401) {
        window.location.replace('/login');
        return;
      }
      const data = await res.json().catch(() => ({}));
      const ok = res.ok && data.ok;
      pushHistory({
        at: Date.now(), ok, status: data.upstreamStatus || res.status,
        patient_id: body.patient_id, type: body.type, entries: body.payload.entries.length,
      });
      if (ok) {
        showResult('ok', 'Evento inviato correttamente ✓', data.response);
      } else if (data.details) {
        showResult('err', data.error || 'Dati non validi', data.details.join('\n'));
      } else if (data.upstreamStatus) {
        const msg = data.upstreamStatus === 403 ? 'API key rifiutata dall\'endpoint (403)' : `L'API ha risposto con errore ${data.upstreamStatus}`;
        showResult('err', msg, data.response);
      } else {
        showResult('err', data.error || `Errore ${res.status}`);
      }
    } catch (err) {
      showResult('err', 'Errore di rete: ' + err.message);
    } finally {
      sending = false;
      btn.textContent = 'Invia evento';
      renderPreview();
    }
  }

  // ------------------------------------------------------------------
  // Event binding
  // ------------------------------------------------------------------
  function bind() {
    $('#patient-mode').addEventListener('change', (e) => {
      state.patientMode = e.target.value;
      const raw = $('#patient-id').value.trim();
      state.patientId = state.patientMode === 'robot' && raw ? 'robot_' + raw.replace(/^robot_/, '') : raw;
      renderHeader();
      changed();
    });
    $('#patient-id').addEventListener('input', (e) => {
      let v = e.target.value;
      if (state.patientMode === 'robot') {
        v = v.replace(/^robot_/, '');
        state.patientId = v ? 'robot_' + v : '';
      } else state.patientId = v;
      changed();
    });
    $('#event-type').addEventListener('change', (e) => {
      state.type = e.target.value;
      const tsBase = state.timestamp || nowLocal();
      // Sempre svuota e ricrea il blocco iniziale coerente con il tipo selezionato
      state.blocks = [];
      if (state.type === 'ai_answer') {
        state.patientMode = 'robot';
        if (!state.patientId) state.patientId = 'EAA007UBT10000011';
        state.blocks.push(makeBlock('pair', {
          timestamp: tsBase,
          typeA: 'ai_question',
          contentA: 'Come ti chiami e cosa puoi fare?',
          typeB: 'ai_answer',
          contentB: 'Certo, mi chiamo Aphelino! Sono qui per farti compagnia e chiacchierare.',
          tag: ''
        }));
      } else if (state.type === 'ai_question') {
        state.patientMode = 'robot';
        if (!state.patientId) state.patientId = 'EAA007UBT10000011';
        state.blocks.push(makeBlock('single', {
          timestamp: tsBase,
          typeA: 'ai_question',
          contentA: 'Quali sono gli orari di apertura del museo?',
          tag: ''
        }));
      } else if (state.type === 'answer') {
        state.patientMode = 'robot';
        if (!state.patientId) state.patientId = 'EAA007UBT10000011';
        state.blocks.push(makeBlock('single', {
          timestamp: tsBase,
          typeA: 'answer',
          contentA: 'Ciao, benvenuto! Io sono qui per te.',
          tag: ''
        }));
      } else if (state.type === 'question') {
        if (state.patientMode === 'robot') state.patientMode = 'patient';
        if (!state.patientId || state.patientId.startsWith('robot_')) state.patientId = '1234';
        state.blocks.push(makeBlock('single', {
          timestamp: tsBase,
          typeA: 'question',
          contentA: 'Vieni qui',
          tag: ''
        }));
      } else if (state.type === 'dialog') {
        // Dialogo: predispone coppia iniziale di dialogo
        state.blocks.push(makeBlock('pair', {
          timestamp: tsBase,
          typeA: 'answer',
          contentA: 'Ciao! Vuoi fare una storia o un gioco insieme?',
          typeB: 'question',
          contentB: 'Sì, volentieri!'
        }));
      }
      renderAll();
      changed();
    });
    $('#custom-type').addEventListener('input', (e) => { state.customType = e.target.value; changed(); });
    $('#event-ts').addEventListener('input', (e) => { state.timestamp = e.target.value; changed(); });

    $('#session-auto').addEventListener('change', (e) => {
      state.sessionAuto = e.target.checked;
      if (!state.sessionAuto) {
        // Parte dai valori calcolati per comodita'.
        state.sessionStart = $('#session-start').value || state.timestamp;
        state.sessionEnd = $('#session-end').value || state.timestamp;
      }
      renderHeader();
      changed();
    });
    $('#session-start').addEventListener('input', (e) => { state.sessionStart = e.target.value; changed(); });
    $('#session-end').addEventListener('input', (e) => { state.sessionEnd = e.target.value; changed(); });

    // Gestione bottoni "Adesso"
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-now]');
      if (!btn) return;
      e.preventDefault();
      const id = btn.dataset.now;
      const v = nowLocal();
      if (id === 'event-ts') state.timestamp = v;
      if (id === 'session-start') state.sessionStart = v;
      if (id === 'session-end') state.sessionEnd = v;
      const input = document.getElementById(id);
      if (input) input.value = v;
      changed();
    });

    $$('[data-add]').forEach((b) => b.addEventListener('click', () => {
      state.blocks.push(makeBlock(b.dataset.add));
      renderBlocks();
      changed();
      const last = $('#blocks').lastElementChild;
      if (last) {
        last.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const ta = $('textarea', last);
        if (ta) ta.focus({ preventScroll: true });
      }
    }));

    $('#retime-btn').addEventListener('click', () => {
      let ts = baseTimestamp();
      const step = stepSeconds();
      state.blocks.forEach((b) => {
        [b.a, b.b].forEach((p) => {
          if (!p) return;
          p.timestamp = ts;
          ts = addSeconds(ts, step);
        });
      });
      renderBlocks();
      changed();
    });

    $('#template-select').addEventListener('change', (e) => {
      if (e.target.value) loadTemplate(e.target.value);
      e.target.value = '';
    });

    $('#extra-json').addEventListener('input', (e) => { state.extraJson = e.target.value; changed(); });

    $('#reset-btn').addEventListener('click', () => {
      if (!window.confirm('Svuotare il form?')) return;
      const keep = { patientMode: state.patientMode, patientId: state.patientId };
      state = Object.assign(emptyState(), keep);
      $('#result').hidden = true;
      renderAll();
      saveDraft();
    });

    $('#copy-btn').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText($('#preview').textContent);
        $('#copy-btn').textContent = 'Copiato!';
      } catch {
        $('#copy-btn').textContent = 'Errore';
      }
      setTimeout(() => { $('#copy-btn').textContent = 'Copia'; }, 1500);
    });

    $('#send-btn').addEventListener('click', send);

    const importDlg = $('#import-dialog');
    $('#import-btn').addEventListener('click', () => {
      $('#import-text').value = '';
      $('#import-error').hidden = true;
      importDlg.showModal();
    });
    $('#import-confirm').addEventListener('click', (e) => {
      e.preventDefault();
      try {
        importJson($('#import-text').value);
        importDlg.close();
        renderAll();
        saveDraft();
      } catch (err) {
        $('#import-error').textContent = err.message;
        $('#import-error').hidden = false;
      }
    });

    $('#clear-history').addEventListener('click', () => {
      localStorage.removeItem(STORAGE_HISTORY);
      renderHistory();
    });

    $('#logout-btn').addEventListener('click', async () => {
      await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
      window.location.replace('/login');
    });
  }

  async function loadMe() {
    try {
      const res = await fetch('/api/me', { credentials: 'same-origin' });
      if (res.status === 401) return window.location.replace('/login');
      const me = await res.json();
      $('#api-warning').hidden = !!me.apiConfigured;
    } catch { /* offline */ }
  }

  bind();
  renderAll();
  renderHistory();
  loadMe();
})();
