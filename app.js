const $ = (s) => document.querySelector(s);
const KEYS = {
  pass: 'scheduler.passphrase',
  feedCache: 'scheduler.feedCache', schedCache: 'scheduler.schedCache',
  mapping: 'scheduler.blockMap',
};
const DAY = 86400000;

let assignments = [];   // from Canvas
let schedule = [];      // expanded schedule instances: {title, block, start, end, allDay}
let blockMap = loadJSON(KEYS.mapping) || {};   // { "Block 1": "AP US History", ... }

function loadJSON(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (_) { return null; } }
function saveJSON(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} }

function setStatus(sel, msg, isError = false) {
  const el = $(sel);
  el.textContent = msg;
  el.classList.toggle('error', isError);
}

/* ---------- Encrypted data from the repo (written by .github/workflows/fetch.yml) ---------- */

const enc = new TextEncoder(), dec = new TextDecoder();
const b64 = (s) => Uint8Array.from(atob(s), c => c.charCodeAt(0));

async function decrypt(payload, passphrase) {
  const { salt, iv, ct, iter } = payload;
  const base = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: b64(salt), iterations: iter || 200000, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(iv) }, key, b64(ct));
  return dec.decode(plain);
}

async function fetchEncrypted(name) {
  const res = await fetch(`data/${name}.enc`, { cache: 'no-store' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function showMeta() {
  try {
    const res = await fetch('data/meta.json', { cache: 'no-store' });
    if (!res.ok) { $('#meta').textContent = 'No data has been fetched yet. Set the repo secrets and run the "Fetch calendar feeds" workflow.'; return; }
    const m = await res.json();
    const when = new Date(m.updated).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
    $('#meta').textContent = `Last fetched ${when} · Canvas: ${m.feeds.canvas || '?'} · Schedule: ${m.feeds.schedule || '?'}`;
  } catch (_) {}
}

async function unlock(passphrase) {
  setStatus('#status', 'Fetching and decrypting…');
  try {
    const [c, s] = await Promise.all([fetchEncrypted('canvas'), fetchEncrypted('schedule')]);
    if (!c && !s) { setStatus('#status', 'No encrypted data in the repo yet. Check the Actions tab.', true); return; }
    let msgs = [];
    if (s) { loadSchedule(await decrypt(s, passphrase)); msgs.push(`${schedule.length} schedule events`); }
    if (c) { loadAssignments(await decrypt(c, passphrase)); msgs.push(`${assignments.length} Canvas items`); }
    localStorage.setItem(KEYS.pass, passphrase);
    setStatus('#status', 'Unlocked: ' + msgs.join(', ') + '.');
  } catch (e) {
    const bad = e.name === 'OperationError';
    setStatus('#status', bad ? 'Wrong passphrase.' : `Couldn't load data (${e.message}).`, true);
    if (bad) localStorage.removeItem(KEYS.pass);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function dayKey(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); }

/* ---------- Canvas ---------- */

function loadAssignments(text) {
  const events = ICS.parse(text);
  assignments = events.map(ICS.toAssignment).filter(a => a.due);
  assignments.sort((a, b) => a.due - b.due);
  saveJSON(KEYS.feedCache, { text, at: Date.now() });
  populateCourses();
  renderMapping();
  render();
  $('#results').hidden = false;
}

function courses() {
  return [...new Set(assignments.map(a => a.course).filter(Boolean))].sort();
}

function populateCourses() {
  const sel = $('#course-filter');
  const current = sel.value;
  const cs = courses();
  sel.innerHTML = '<option value="">All courses</option>' +
    cs.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  sel.value = cs.includes(current) ? current : '';
}

/* ---------- Schedule ---------- */

const BLOCK_RE = /\bblock\s*(\d+)\b/i;

// Key that identifies "the same class" across schedule events: "Block 3" if the title has one,
// otherwise the title itself (e.g. "Latin 4 (H) -  US-3").
function classKey(summary) {
  const m = (summary || '').match(BLOCK_RE);
  return m ? 'Block ' + m[1] : (summary || '').trim();
}
// Shorter label: drop a trailing " - SECTION" code.
function classLabel(key) { return key.replace(/\s+-\s+[^-]*$/, '').trim(); }

// Guess which Canvas course a schedule class is, by word overlap.
function normTokens(s) {
  return new Set(s.toLowerCase().replace(/\(h\)/g, ' honors ').replace(/\bhon\b/g, 'honors')
    .replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(w => w && !['the', 'of', 'and', 'us', 'a'].includes(w)));
}
function guessCourse(key, cs) {
  const t = normTokens(classLabel(key));
  let best = null, bestScore = 0;
  for (const c of cs) {
    const u = normTokens(c);
    let inter = 0; for (const w of t) if (u.has(w)) inter++;
    const score = inter / Math.max(1, Math.min(t.size, u.size));
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return bestScore >= 0.5 ? best : null;
}

function loadSchedule(text) {
  const events = ICS.parse(text);
  const now = new Date();
  const rangeStart = new Date(now.getTime() - 60 * DAY);
  const rangeEnd = new Date(now.getTime() + 365 * DAY);
  schedule = ICS.expand(events, rangeStart, rangeEnd).map(ev => {
    return {
      title: ev.summary || '(untitled)',
      block: classKey(ev.summary),
      start: ev.instance,
      end: ev.end ? ev.end.date : null,
      allDay: ev.start.allDay,
    };
  }).sort((a, b) => a.start - b.start);
  saveJSON(KEYS.schedCache, { text, at: Date.now() });
  renderMapping();
  render();
}

function blockNames() {
  const counts = new Map();
  for (const s of schedule) if (s.block) counts.set(s.block, (counts.get(s.block) || 0) + 1);
  const num = (k) => { const m = k.match(BLOCK_RE); return m ? +m[1] : Infinity; };
  // Most frequent first (classes), then meetings/assemblies; Block N numerically.
  return [...counts.keys()].sort((a, b) => (num(a) - num(b)) || (counts.get(b) - counts.get(a)) || a.localeCompare(b));
}

// course -> block (inverse of blockMap)
function blockForCourse(course) {
  for (const [block, c] of Object.entries(blockMap)) if (c && c === course) return block;
  return null;
}

function renderMapping() {
  const blocks = blockNames();
  const box = $('#mapping');
  if (!blocks.length) { box.hidden = true; return; }
  box.hidden = false;
  const cs = courses();
  // Auto-guess unmapped classes once courses are known.
  let changed = false;
  for (const b of blocks) {
    if (!(b in blockMap) && cs.length) { const g = guessCourse(b, cs); blockMap[b] = g || ''; changed = true; }
  }
  if (changed) saveJSON(KEYS.mapping, blockMap);
  $('#mapping-rows').innerHTML = blocks.map(b => `
    <label class="map-row">
      <span title="${escapeHtml(b)}">${escapeHtml(classLabel(b))}</span>
      <select data-block="${escapeHtml(b)}">
        <option value="">— not a Canvas class —</option>
        ${cs.map(c => `<option value="${escapeHtml(c)}" ${blockMap[b] === c ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}
        ${blockMap[b] && !cs.includes(blockMap[b]) ? `<option value="${escapeHtml(blockMap[b])}" selected>${escapeHtml(blockMap[b])}</option>` : ''}
      </select>
    </label>`).join('');
  if (!cs.length) $('#mapping-rows').insertAdjacentHTML('afterbegin', '<p class="hint">Load Canvas first to get the list of courses.</p>');
  $('#mapping-rows').querySelectorAll('select').forEach(sel => {
    sel.addEventListener('change', () => {
      const b = sel.dataset.block;
      blockMap[b] = sel.value;
      saveJSON(KEYS.mapping, blockMap);
      render();
    });
  });
}

/* ---------- Rendering ---------- */

function fmtDay(d) {
  const diff = Math.round((dayKey(d) - dayKey(new Date())) / DAY);
  const label = d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
  if (diff === 0) return 'Today · ' + label;
  if (diff === 1) return 'Tomorrow · ' + label;
  return label;
}
function fmtClock(d) { return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); }
function fmtTime(a) { return a.allDay ? 'All day' : fmtClock(a.due); }

function scheduleForDay(k) {
  return schedule.filter(s => dayKey(s.start) === k);
}

// Next time the class in `block` meets, on or after `from`.
function nextMeeting(block, from) {
  return schedule.find(s => s.block === block && s.start >= from) || null;
}

function dayScheduleHtml(k) {
  const items = scheduleForDay(k);
  if (!items.length) return '';
  return `<div class="blocks">${items.map(s => {
    const cls = s.block ? 'chip block' : 'chip';
    const course = s.block && blockMap[s.block];
    const label = course ? classLabel(s.block) : classLabel(s.title);
    const time = s.allDay ? '' : `<small>${fmtClock(s.start)}</small>`;
    return `<span class="${cls}" title="${escapeHtml(s.title)}">${escapeHtml(label)} ${time}</span>`;
  }).join('')}</div>`;
}

function render() {
  const showPast = $('#show-past').checked;
  const course = $('#course-filter').value;
  const now = new Date();
  const todayKey = dayKey(now);
  const list = $('#list');

  const items = assignments.filter(a =>
    (!course || a.course === course) &&
    (showPast || dayKey(a.due) >= todayKey)
  );
  $('#count').textContent = `(${items.length})`;

  const groups = new Map();
  for (const a of items) {
    const k = dayKey(a.due);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(a);
  }
  // Always show today's schedule, even with nothing due.
  if (schedule.length && !groups.has(todayKey) && !showPast) groups.set(todayKey, []);
  const keys = [...groups.keys()].sort((a, b) => a - b);

  if (!keys.length) {
    list.innerHTML = '<p class="empty">Nothing here. Try "Show past" or another course.</p>';
    return;
  }

  let html = '';
  for (const k of keys) {
    const arr = groups.get(k);
    const isToday = k === todayKey;
    html += `<div class="day"><h3 class="${isToday ? 'today' : ''}">${escapeHtml(fmtDay(new Date(k)))}</h3>${dayScheduleHtml(k)}`;
    if (!arr.length) html += '<p class="empty small">Nothing due.</p>';
    for (const a of arr) {
      const past = a.due < now && !(a.allDay && k === todayKey);
      const soon = !past && (a.due - now) < 2 * DAY;
      const cls = ['item', past ? 'past' : '', soon ? 'soon' : ''].join(' ');
      const title = a.url
        ? `<a href="${escapeHtml(a.url)}" target="_blank" rel="noopener">${escapeHtml(a.title)}</a>`
        : escapeHtml(a.title);

      // Block context: does this class meet on the due day? If not, when is the last class before it's due?
      let meta = '';
      const block = blockForCourse(a.course);
      if (block) {
        const meetsThatDay = scheduleForDay(k).find(s => s.block === block);
        if (meetsThatDay) {
          meta = `<span class="tag">class${meetsThatDay.allDay ? '' : ' at ' + fmtClock(meetsThatDay.start)}</span>`;
        } else {
          const prev = [...schedule].reverse().find(s => s.block === block && s.start < a.due);
          if (prev) meta = `<span class="tag muted">no class that day · last class ${escapeHtml(prev.start.toLocaleDateString(undefined, { weekday: 'short' }))}</span>`;
          else meta = `<span class="tag muted">no class that day</span>`;
        }
      }

      html += `<div class="${cls}">
        <div><div class="title">${title}</div><div class="course">${escapeHtml(a.course)} ${meta}</div></div>
        <div class="time">${escapeHtml(fmtTime(a))}</div>
      </div>`;
    }
    html += '</div>';
  }
  list.innerHTML = html;
}

/* ---------- Wiring ---------- */

$('#unlock-form').addEventListener('submit', (e) => {
  e.preventDefault();
  unlock($('#passphrase').value);
});
$('#feed-file').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (f) { loadAssignments(await f.text()); setStatus('#status', `Loaded ${assignments.length} Canvas items from file.`); }
});
$('#sched-file').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (f) { loadSchedule(await f.text()); setStatus('#status', `Loaded ${schedule.length} schedule events from file.`); }
});
$('#show-past').addEventListener('change', render);
$('#course-filter').addEventListener('change', render);
$('#refresh').addEventListener('click', () => {
  const p = localStorage.getItem(KEYS.pass);
  showMeta();
  if (p) unlock(p); else setStatus('#status', 'Enter your passphrase first.', true);
});
$('#forget').addEventListener('click', () => {
  Object.values(KEYS).forEach(k => localStorage.removeItem(k));
  assignments = []; schedule = []; blockMap = {};
  $('#results').hidden = true;
  $('#mapping').hidden = true;
  $('#passphrase').value = '';
  setStatus('#status', 'Forgot passphrase and cached data.');
});

// Boot: show cached data instantly, then refresh from the repo if we have the passphrase.
(function boot() {
  const p = localStorage.getItem(KEYS.pass);
  const c1 = loadJSON(KEYS.feedCache);
  const c2 = loadJSON(KEYS.schedCache);
  if (c2) { try { loadSchedule(c2.text); } catch (_) {} }
  if (c1) { try { loadAssignments(c1.text); } catch (_) {} }
  showMeta();
  if (p) { $('#passphrase').value = p; unlock(p); }
})();
