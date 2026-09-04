const $ = (s) => document.querySelector(s);
const KEYS = {
  pass: 'scheduler.passphrase',
  feedCache: 'scheduler.feedCache', schedCache: 'scheduler.schedCache',
  mapping: 'scheduler.blockMap', nicknames: 'scheduler.nicknames', lunch: 'scheduler.lunch',
  custom: 'scheduler.custom', bg: 'scheduler.bg', clockSeconds: 'scheduler.clockSeconds',
};
const DAY = 86400000;

let assignments = [];   // from Canvas
let schedule = [];      // expanded schedule instances: {title, block, start, end, allDay}
let blockMap = loadJSON(KEYS.mapping) || {};   // { "Latin 4 (H) -  US-3": "Latin 4 (H) / Latin 5 (H)", ... }
let nicknames = loadJSON(KEYS.nicknames) || {};
// User-created events from the quick-add box: [{ id, title, start (ms), end (ms) }]
let customEvents = (loadJSON(KEYS.custom) || []).map(e => ({ ...e, start: new Date(e.start), end: new Date(e.end) }));
function saveCustom() { saveJSON(KEYS.custom, customEvents.map(e => ({ ...e, start: e.start.getTime(), end: e.end.getTime() }))); }
function customOn(k) { return customEvents.filter(e => dayKey(e.start) === k).sort((x, y) => x.start - y.start); } // { "Latin 4 (H) -  US-3": "latin", ... }

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
    const firstUnlock = !localStorage.getItem(KEYS.pass);
    localStorage.setItem(KEYS.pass, passphrase);
    setStatus('#status', 'Unlocked: ' + msgs.join(', ') + '.');
    if (firstUnlock) toggleSettings(false);
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
  updateEmptyState();
}

function courses() {
  return [...new Set(assignments.map(a => a.course).filter(Boolean))].sort();
}

function populateCourses() {}

/* ---------- Schedule ---------- */

const BLOCK_RE = /\bblock\s*(\d+)\b/i;

// Key that identifies "the same class" across schedule events: "Block 3" if the title has one,
// otherwise the title itself (e.g. "Latin 4 (H) -  US-3").
function classKey(summary) {
  const m = (summary || '').match(BLOCK_RE);
  return m ? 'Block ' + m[1] : (summary || '').trim();
}
// Shorter label: drop a trailing " - SECTION" code.
function classLabel(key) { return nicknames[key] || key.replace(/\s+-\s+[^-]*$/, '').trim(); }
// Display name for a Canvas course: the nickname of the schedule class mapped to it, else the course name.
function displayCourse(course) { const b = blockForCourse(course); return (b && nicknames[b]) || course; }

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
  computeSchoolHours();
  if (!planDayTouched) planDay = defaultDay();
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
    <div class="map-row">
      <span title="${escapeHtml(b)}">${escapeHtml(b.replace(/\s+-\s+[^-]*$/, '').trim())}</span>
      <select data-block="${escapeHtml(b)}">
        <option value="">— not a Canvas class —</option>
        ${cs.map(c => `<option value="${escapeHtml(c)}" ${blockMap[b] === c ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}
        ${blockMap[b] && !cs.includes(blockMap[b]) ? `<option value="${escapeHtml(blockMap[b])}" selected>${escapeHtml(blockMap[b])}</option>` : ''}
      </select>
      <input type="text" class="nick" data-block="${escapeHtml(b)}" value="${escapeHtml(nicknames[b] || '')}" placeholder="nickname">
    </div>`).join('');
  $('#mapping-rows').querySelectorAll('input.nick').forEach(inp => {
    inp.addEventListener('input', () => {
      const b = inp.dataset.block, v = inp.value.trim();
      if (v) nicknames[b] = v; else delete nicknames[b];
      saveJSON(KEYS.nicknames, nicknames);
      render();
    });
  });
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

/* ---------- Effective due time ---------- */

// If the assignment's class meets on the due day, the real deadline is the start of that class.
// Returns { due, meeting, moved } where moved = true when the time was adjusted.
function effectiveDue(a) {
  const block = blockForCourse(a.course);
  if (!block) return { due: a.due, meeting: null, moved: false };
  const meeting = scheduleForDay(dayKey(a.due)).find(s => s.block === block && !s.allDay);
  if (!meeting) return { due: a.due, meeting: null, moved: false };
  const moved = a.allDay || meeting.start.getTime() !== a.due.getTime();
  return { due: meeting.start, meeting, moved };
}

/* ---------- Rendering ---------- */

let view = localStorage.getItem('scheduler.view') || 'plan';
let weekStart = startOfWeek(new Date());
let planDay = new Date(dayKey(new Date()));
let planDayTouched = false;

// After the school day ends, "today" is done: default to the next school day.
function afterSchool(now = new Date()) { return now.getHours() * 60 + now.getMinutes() >= schoolHours.end; }
function isSchoolDay(k) { return schedule.some(s => dayKey(s.start) === k && !s.allDay); }
function defaultDay() {
  const now = new Date();
  let k = dayKey(now);
  if (!afterSchool(now)) return new Date(k);
  for (let i = 1; i <= 14; i++) { const n = k + i * DAY; if (!schedule.length || isSchoolDay(n)) return new Date(n); }
  return new Date(k + DAY);
}
// The day list/plan treat as "current": today, or tomorrow once school is over.
function cutoffKey() { const now = new Date(); return dayKey(now) + (afterSchool(now) ? DAY : 0); }

function startOfWeek(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); // Monday
  return x;
}

function fmtDay(d) {
  const diff = Math.round((dayKey(d) - dayKey(new Date())) / DAY);
  const label = d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
  if (diff === 0) return 'today · ' + label;
  if (diff === 1) return 'tomorrow · ' + label;
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
  document.querySelectorAll('.seg button').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  $('#list-view').hidden = view !== 'list';
  $('#calendar').hidden = view !== 'calendar';
  $('#plan').hidden = view !== 'plan';
  if (view === 'calendar') renderCalendar(); else if (view === 'plan') renderPlan(); else renderList();
}

function renderList() {
  const showPast = false;
  const course = '';
  const now = new Date();
  const todayKey = dayKey(now);
  const list = $('#list');

  const cutoff = cutoffKey();
  const items = assignments.filter(a =>
    (!course || a.course === course) &&
    (showPast || dayKey(a.due) >= cutoff)
  );
  $('#list-count').textContent = `${items.length} items`;

  const groups = new Map();
  for (const a of items) {
    const k = dayKey(a.due);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(a);
  }
  for (const c of customEvents) { const k = dayKey(c.start); if (k >= cutoff && !groups.has(k)) groups.set(k, []); }
  // Always show today's schedule, even with nothing due.
  if (schedule.length && !groups.has(cutoff) && !showPast) groups.set(cutoff, []);
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
    for (const c of customOn(k)) {
      html += `<div class="item custom"><div><div class="title">${escapeHtml(c.title)} <span class="tag">yours</span></div></div>
        <div class="time">${fmtClock(c.start)} <button type="button" class="text del" data-del="${c.id}" title="remove">×</button></div></div>`;
    }
    if (!arr.length && !customOn(k).length) html += '<p class="empty small">Nothing due.</p>';
    for (const a of arr) {
      const eff = effectiveDue(a);
      const past = eff.due < now && !(a.allDay && !eff.moved && k === todayKey);
      const soon = !past && (eff.due - now) < 2 * DAY;
      const cls = ['item', past ? 'past' : '', soon ? 'soon' : ''].join(' ');
      const title = a.url
        ? `<a href="${escapeHtml(a.url)}" target="_blank" rel="noopener">${escapeHtml(a.title)}</a>`
        : escapeHtml(a.title);

      // Block context: does this class meet on the due day? If not, when is the last class before it's due?
      let meta = '';
      const block = blockForCourse(a.course);
      if (block) {
        if (eff.meeting) {
          meta = `<span class="tag">due at start of class</span>`;
        } else {
          const prev = [...schedule].reverse().find(s => s.block === block && s.start < a.due);
          if (prev) meta = `<span class="tag muted">no class that day · last class ${escapeHtml(prev.start.toLocaleDateString(undefined, { weekday: 'short' }))}</span>`;
          else meta = `<span class="tag muted">no class that day</span>`;
        }
      }

      html += `<div class="${cls}">
        <div><div class="title">${title}</div><div class="course">${escapeHtml(displayCourse(a.course))} ${meta}</div></div>
        <div class="time">${eff.moved ? escapeHtml(fmtClock(eff.due)) + `<span class="moved" title="Canvas due time">${escapeHtml(fmtTime(a))}</span>` : escapeHtml(fmtTime(a))}</div>
      </div>`;
    }
    html += '</div>';
  }
  list.innerHTML = html;
}

/* ---------- Quick add ---------- */

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

// "calc test study saturday 4pm for 2h" -> { title, start, end }. Returns null if nothing usable.
function parseQuickAdd(text, now = new Date()) {
  let s = ' ' + text.trim().toLowerCase().replace(/\s+/g, ' ') + ' ';
  let day = null, time = null, dur = 60;

  const take = (re, fn) => { const m = s.match(re); if (m) { fn(m); s = s.replace(m[0], ' '); } };

  // duration: "for 2h", "for 90 min", "2 hours"
  take(/ (?:for )?(\d+(?:\.\d+)?) ?(h|hr|hrs|hour|hours|m|min|mins|minutes) /, m => { const n = +m[1]; dur = /^h/.test(m[2]) ? n * 60 : n; });
  // day words
  const today = dayKey(now);
  take(/ (today|tonight) /, () => { day = today; });
  take(/ (tomorrow|tmrw|tmr) /, () => { day = today + DAY; });
  take(/ (?:(next|this) )?(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)[a-z]* /, m => {
    const target = DAYS.findIndex(d => d.startsWith(m[2].slice(0, 3)));
    let diff = (target - now.getDay() + 7) % 7;
    if (diff === 0 && (m[1] === 'next' || afterSchool(now))) diff = 7;
    day = today + diff * DAY;
  });
  // dates: "9/12", "sep 12", "12 sep"
  take(/ (\d{1,2})\/(\d{1,2}) /, m => { const d = new Date(now.getFullYear(), +m[1] - 1, +m[2]); if (d < now - 30 * DAY) d.setFullYear(d.getFullYear() + 1); day = dayKey(d); });
  take(/ (jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]* (\d{1,2}) /, m => { day = dayKey(new Date(now.getFullYear(), MONTHS.indexOf(m[1].slice(0, 3)), +m[2])); });
  take(/ (\d{1,2}) (jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]* /, m => { day = dayKey(new Date(now.getFullYear(), MONTHS.indexOf(m[2].slice(0, 3)), +m[1])); });
  // time: "at 4", "4pm", "4:30 pm", "16:00"
  take(/ (?:at )?(\d{1,2})(?::(\d{2}))? ?(am|pm)?(?= )/, m => {
    let h = +m[1], mi = +(m[2] || 0);
    if (m[3] === 'pm' && h < 12) h += 12; if (m[3] === 'am' && h === 12) h = 0;
    if (!m[3] && !m[2] && h >= 1 && h <= 7) h += 12;       // bare "4" means 4 pm
    if (h > 23 || mi > 59) return;
    time = [h, mi];
  });

  const title = s.replace(/ (on|at|for|the) /g, ' ').trim() || (day !== null || time ? 'event' : '');
  if (!title) return null;
  if (day === null) day = today;
  if (!time) {
    // default: after school on a school day, midday otherwise
    const d = new Date(day);
    time = isSchoolDay(day) ? [Math.floor((schoolHours.end + 10) / 60), (schoolHours.end + 10) % 60] : [12, 0];
  }
  const start = new Date(day); start.setHours(time[0], time[1], 0, 0);
  const end = new Date(start.getTime() + dur * 60000);
  return { title: title.replace(/^./, c => c), start, end };
}

function quickAdd(text) {
  const ev = parseQuickAdd(text);
  if (!ev) return false;
  customEvents.push({ id: Date.now().toString(36), ...ev });
  saveCustom();
  // Jump the views to the new event's day.
  planDay = new Date(dayKey(ev.start)); planDayTouched = true;
  weekStart = startOfWeek(ev.start);
  render();
  return ev;
}
function removeCustom(id) { customEvents = customEvents.filter(e => e.id !== id); saveCustom(); render(); }

/* ---------- Free time ---------- */

const BUFFER_MIN = 5;
const LUNCH = Object.assign({ start: [11, 50], end: [12, 10] }, loadJSON(KEYS.lunch) || {});
LUNCH.title = 'Lunch';
function hhmm(arr) { return String(arr[0]).padStart(2, '0') + ':' + String(arr[1]).padStart(2, '0'); }
function setLunchFromInputs() {
  const s = $('#lunch-start').value, e = $('#lunch-end').value;
  if (!s || !e) return;
  LUNCH.start = s.split(':').map(Number); LUNCH.end = e.split(':').map(Number);
  if (LUNCH.end[0] * 60 + LUNCH.end[1] <= LUNCH.start[0] * 60 + LUNCH.start[1]) return;
  saveJSON(KEYS.lunch, { start: LUNCH.start, end: LUNCH.end });
  render();
}
const MIN_FREE_MIN = 10;

// Timed events for a school day, including lunch. Returns [] on days with no classes.
function dayEvents(k) {
  const evs = scheduleForDay(k).filter(s => !s.allDay).map(s => ({
    title: classLabel(s.title), start: s.start, end: s.end || new Date(s.start.getTime() + 45 * 60000), block: s.block, sched: s,
  }));
  if (evs.length) {
    const d = new Date(k);
    evs.push({ title: LUNCH.title, start: new Date(d.getFullYear(), d.getMonth(), d.getDate(), ...LUNCH.start), end: new Date(d.getFullYear(), d.getMonth(), d.getDate(), ...LUNCH.end), lunch: true });
  }
  for (const c of customOn(k)) evs.push({ title: c.title, start: c.start, end: c.end, custom: true, id: c.id });
  return evs.sort((x, y) => x.start - y.start);
}

// Usual school hours: the most common earliest start and latest end across all school days in the schedule,
// so a day whose first period is free still counts that period as free time.
let schoolHours = { start: 8 * 60 + 25, end: 15 * 60 + 20 };
function computeSchoolHours() {
  const byDay = new Map();
  for (const s of schedule) {
    if (s.allDay) continue;
    const k = dayKey(s.start), e = s.end || s.start;
    const d = byDay.get(k) || { start: Infinity, end: -Infinity };
    d.start = Math.min(d.start, s.start.getHours() * 60 + s.start.getMinutes());
    d.end = Math.max(d.end, e.getHours() * 60 + e.getMinutes());
    byDay.set(k, d);
  }
  const mode = (arr) => { const c = new Map(); for (const v of arr) c.set(v, (c.get(v) || 0) + 1); return [...c.entries()].sort((x, y) => y[1] - x[1])[0]?.[0]; };
  const days = [...byDay.values()];
  if (days.length) schoolHours = { start: mode(days.map(d => d.start)), end: mode(days.map(d => d.end)) };
}
function schoolBounds(k) {
  const d = new Date(k);
  return [new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, schoolHours.start), new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, schoolHours.end)];
}

// Free slots within school hours, with BUFFER_MIN trimmed off each side of every event.
function freeSlots(evs) {
  if (!evs.some(e => e.sched)) return [];   // no classes that day: no school free time to compute
  const buf = BUFFER_MIN * 60000;
  const classes = evs.filter(e => e.sched);
  const [b0, b1] = schoolBounds(dayKey(classes[0].start));
  // Bounds come from school hours and classes only; custom events can subtract free time but never extend the day.
  const dayStart = new Date(Math.min(b0.getTime(), classes[0].start.getTime()));
  const dayEnd = Math.max(b1.getTime(), ...classes.map(e => e.end.getTime()));
  const busy = evs.map(e => [e.start.getTime() - buf, e.end.getTime() + buf]);
  busy.push([dayStart.getTime() - 1, dayStart.getTime()], [dayEnd, dayEnd + 1]); // sentinels so leading/trailing gaps count
  busy.sort((x, y) => x[0] - y[0]);
  const merged = [];
  for (const b of busy) { const last = merged[merged.length - 1]; if (last && b[0] <= last[1]) last[1] = Math.max(last[1], b[1]); else merged.push([...b]); }
  const slots = [];
  for (let i = 0; i + 1 < merged.length; i++) {
    const s = merged[i][1], e = merged[i + 1][0];
    if (e - s >= MIN_FREE_MIN * 60000 && s >= dayStart.getTime() && e <= dayEnd) slots.push({ start: new Date(s), end: new Date(e), minutes: Math.round((e - s) / 60000) });
  }
  return slots;
}

function fmtMinutes(m) { return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60 ? (m % 60) + 'm' : ''}`.trim() : `${m}m`; }

// Assignments due on day k, with effective due times, sorted.
function dueOn(k) {
  const course = '';
  return assignments.filter(a => dayKey(a.due) === k && (!course || a.course === course))
    .map(a => ({ a, eff: effectiveDue(a) })).sort((x, y) => x.eff.due - y.eff.due);
}

// Short course names for the compact summaries: "Biology" -> "Bio", "History 11 (H)" -> "History".
const SHORT = { biology: 'Bio', chemistry: 'Chem', calculus: 'Calc', physics: 'Physics', precalculus: 'Precalc', engineering: 'Engineering', mathematics: 'Math', literature: 'Lit' };
function shortCourse(c) {
  const words = c.replace(/\(h\)|honors|\bhon\b/gi, '').replace(/[^a-z0-9 ]+/gi, ' ').trim().split(/\s+/).filter(w => w && !/^\d+$/.test(w));
  const key = words.find(w => SHORT[w.toLowerCase()]);
  if (key) return SHORT[key.toLowerCase()];
  const first = words.find(w => !['principles', 'of', 'intro', 'to', 'advanced', 'adv', 'ap'].includes(w.toLowerCase())) || words[0] || c;
  return first;
}
// "3 Bio, 1 History"
function countSummary(list) {
  const c = new Map();
  for (const x of list) { const b = blockForCourse(x.a.course); const s = (b && nicknames[b]) || shortCourse(x.a.course || 'other'); c.set(s, (c.get(s) || 0) + 1); }
  return [...c.entries()].sort((x, y) => y[1] - x[1]).map(([s, n]) => `${n} ${s}`).join(', ');
}

function renderPlan() {
  const k = dayKey(planDay);
  const now = new Date();
  const todayKey = dayKey(now);
  const evs = dayEvents(k);
  const slots = freeSlots(evs);
  const dues = dueOn(k);
  $('#plan-date').textContent = fmtDay(planDay);
  $('#count').textContent = `${dues.length} due`;

  const body = $('#plan-body');
  if (!evs.some(e => e.sched)) {
    body.innerHTML = `<p class="empty">no school this day.</p>` +
      (evs.length ? `<div class="tl">${evs.map(r => customRowHtml(r, k, now)).join('')}</div>` : '') +
      (dues.length ? dueListHtml(dues, now) : '');
    return;
  }
  const totalFree = slots.reduce((n, s) => n + s.minutes, 0);
  const firstFree = slots[0] ? slots[0].start : null;
  const beforeSchool = dues.filter(x => !firstFree || x.eff.due <= firstFree);
  const inSchool = dues.filter(x => firstFree && x.eff.due > firstFree);

  const detail = (summaryHtml, list, cls = '') => list.length
    ? `<details class="${cls}"><summary>${summaryHtml}</summary><ul class="work">${list.map(x => `<li>${dueLink(x)}<span class="due">${x.a.allDay && !x.eff.moved ? 'all day' : 'due ' + fmtClock(x.eff.due)}${x.eff.moved ? ` <span class="moved">${escapeHtml(fmtTime(x.a))}</span>` : ''}</span></li>`).join('')}</ul></details>`
    : `<div class="what">${summaryHtml}</div>`;

  let html = `<p class="hint">${fmtMinutes(totalFree)} free · ${dues.length} due</p><div class="tl">`;
  // Before-school row: what has to be finished before first period.
  html += `<div class="tl-row before ${beforeSchool.length ? 'warn' : ''} ${k === todayKey && evs[0].start <= now ? 'past' : ''}">
    <div class="when"><b>before</b>${fmtClock(evs[0].start)}</div>
    ${detail(`<span class="what">Before school</span><small class="sum">${beforeSchool.length ? countSummary(beforeSchool) : 'nothing due at first period'}</small>`, beforeSchool)}
  </div>`;

  const rows = [...evs.map(e => ({ ...e, kind: e.lunch ? 'lunch' : e.custom ? 'custom' : 'klass' })), ...slots.map(s => ({ ...s, kind: 'free', title: `Free · ${fmtMinutes(s.minutes)}` }))].sort((x, y) => x.start - y.start);
  for (const r of rows) {
    if (r.kind === 'custom') { html += customRowHtml(r, k, now); continue; }
    const past = k === todayKey && r.end <= now;
    const current = k === todayKey && r.start <= now && now < r.end;
    let list = [], sum = '';
    if (r.kind === 'klass') { list = dues.filter(x => x.eff.meeting === r.sched); sum = list.length ? `${list.length} due at start` : ''; }
    if (r.kind === 'free') { list = inSchool.filter(x => x.eff.due > r.start); sum = list.length ? `work on: ${countSummary(list)}` : 'nothing else due today'; }
    html += `<div class="tl-row ${r.kind} ${past ? 'past' : ''} ${current ? 'now' : ''}">
      <div class="when"><b>${fmtClock(r.start)}</b>${fmtClock(r.end)}</div>
      ${detail(`<span class="what">${escapeHtml(r.title)}${current ? '<small>now</small>' : ''}</span>${sum ? `<small class="sum">${escapeHtml(sum)}</small>` : ''}`, list)}
    </div>`;
  }
  html += `</div>`;
  body.innerHTML = html;
}

function customRowHtml(r, k, now) {
  const past = k === dayKey(now) && r.end <= now;
  return `<div class="tl-row custom ${past ? 'past' : ''}">
    <div class="when"><b>${fmtClock(r.start)}</b>${fmtClock(r.end)}</div>
    <div class="what">${escapeHtml(r.title)}<small>yours</small></div>
    <button type="button" class="text del" data-del="${r.id}" title="remove">×</button>
  </div>`;
}

function dueLink(x) {
  const { a } = x;
  const t = `${escapeHtml(a.title)} <small class="c">${escapeHtml(displayCourse(a.course))}</small>`;
  return a.url ? `<a href="${escapeHtml(a.url)}" target="_blank" rel="noopener">${t}</a>` : `<span>${t}</span>`;
}
function dueListHtml(list, now) {
  return `<ul class="due-list">${list.map(x => `<li class="${x.eff.due < now ? 'past' : ''}"><div>${dueLink(x)}</div><div class="c">${x.a.allDay && !x.eff.moved ? 'All day' : fmtClock(x.eff.due)}${x.eff.moved ? ` <span class="moved">${escapeHtml(fmtTime(x.a))}</span>` : ''}</div></li>`).join('')}</ul>`;
}

/* ---------- Calendar (week) view ---------- */

function renderCalendar() {
  const course = '';
  const now = new Date();
  const todayKey = dayKey(now);
  const weekEnd = new Date(weekStart.getTime() + 7 * DAY);

  const items = assignments
    .filter(a => !course || a.course === course)
    .filter(a => a.due >= weekStart && a.due < weekEnd)
    .map(a => ({ a, eff: effectiveDue(a) }));
  const sched = schedule.filter(s => s.start >= weekStart && s.start < weekEnd);
  $('#cal-count').textContent = `${items.length} due this week`;

  // Days: Mon–Fri, plus Sat/Sun only if something is on them.
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart.getTime() + i * DAY);
    const k = dayKey(d);
    const has = sched.some(s => dayKey(s.start) === k) || items.some(x => dayKey(x.eff.due) === k) || customOn(k).length;
    if (i < 5 || has) days.push({ d, k });
  }

  // Hour range from the timed content, defaulting to 8–16.
  const timed = [...sched.filter(s => !s.allDay).map(s => [s.start, s.end || s.start]), ...items.filter(x => !(x.a.allDay && !x.eff.moved)).map(x => [x.eff.due, x.eff.due]),
    ...customEvents.filter(c => c.start >= weekStart && c.start < weekEnd).map(c => [c.start, c.end])];
  let h0 = 8, h1 = 16;
  for (const [s, e] of timed) { h0 = Math.min(h0, s.getHours()); h1 = Math.max(h1, e.getHours() + (e.getMinutes() > 0 ? 1 : 0)); }
  const HOUR = 56; // px
  const top = (d) => ((d.getHours() + d.getMinutes() / 60) - h0) * HOUR;

  const fmtRange = `${weekStart.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${new Date(weekEnd - DAY).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
  $('#cal-range').textContent = fmtRange;

  let html = `<div class="cal-corner"></div>`;
  for (const { d, k } of days) {
    html += `<div class="cal-head ${k === todayKey ? 'today' : ''}">${d.toLocaleDateString(undefined, { weekday: 'short' })}<small>${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</small></div>`;
  }
  // All-day row: all-day schedule events + assignments that couldn't be attached to a class and have no time.
  html += `<div class="cal-corner"></div>`;
  for (const { k } of days) {
    html += `<div class="cal-allday">`;
    for (const s of sched.filter(s => s.allDay && dayKey(s.start) === k)) html += `<span class="chip">${escapeHtml(classLabel(s.title))}</span>`;
    for (const x of items.filter(x => dayKey(x.eff.due) === k && x.a.allDay && !x.eff.moved)) html += dueHtml(x, now);
    html += `</div>`;
  }
  // Time gutter
  html += `<div class="cal-times" style="height:${(h1 - h0) * HOUR}px">`;
  for (let h = h0; h <= h1; h++) html += `<div style="top:${(h - h0) * HOUR}px">${new Date(2000, 0, 1, h).toLocaleTimeString(undefined, { hour: 'numeric' })}</div>`;
  html += `</div>`;
  // Day columns
  for (const { k } of days) {
    html += `<div class="cal-col ${k === todayKey ? 'today' : ''}" style="height:${(h1 - h0) * HOUR}px">`;
    const evs = dayEvents(k);
    for (const f of freeSlots(evs)) html += `<div class="cal-free" style="top:${top(f.start)}px;height:${Math.max(14, top(f.end) - top(f.start) - 2)}px"><span>free ${fmtMinutes(f.minutes)}</span></div>`;
    for (const l of evs.filter(e => e.lunch)) html += `<div class="cal-ev klass unmapped" style="top:${top(l.start)}px;height:${Math.max(18, top(l.end) - top(l.start) - 2)}px"><div class="t">Lunch</div></div>`;
    for (const s of sched.filter(s => !s.allDay && dayKey(s.start) === k)) {
      const end = s.end || new Date(s.start.getTime() + 45 * 60000);
      const mapped = s.block && blockMap[s.block];
      const dues = items.filter(x => x.eff.meeting === s);
      html += `<div class="cal-ev klass ${mapped ? '' : 'unmapped'}" style="top:${top(s.start)}px;height:${Math.max(22, top(end) - top(s.start) - 2)}px" title="${escapeHtml(s.title)}">
        <div class="t">${escapeHtml(classLabel(s.title))}</div>
        <div class="tm">${fmtClock(s.start)}–${fmtClock(end)}</div>
        ${dues.map(x => dueHtml(x, now)).join('')}
      </div>`;
    }
    for (const c of customOn(k)) {
      html += `<div class="cal-ev custom" style="top:${top(c.start)}px;height:${Math.max(22, top(c.end) - top(c.start) - 2)}px" title="${escapeHtml(c.title)}">
        <div class="t">${escapeHtml(c.title)}</div><div class="tm">${fmtClock(c.start)}–${fmtClock(c.end)}</div>
        <button type="button" class="del" data-del="${c.id}" title="remove">×</button></div>`;
    }
    // Timed assignments not attached to a class meeting.
    for (const x of items.filter(x => dayKey(x.eff.due) === k && !x.eff.meeting && !x.a.allDay)) {
      html += dueHtml(x, now, `style="top:${top(x.eff.due)}px"`);
    }
    if (k === todayKey && now.getHours() >= h0 && now.getHours() < h1) html += `<div class="cal-now" style="top:${top(now)}px"></div>`;
    html += `</div>`;
  }
  const grid = $('#cal-grid');
  grid.style.setProperty('--days', days.length);
  grid.style.setProperty('--hour', HOUR + 'px');
  grid.innerHTML = html;
}

function dueHtml(x, now, extraAttr = '') {
  const { a, eff } = x;
  const past = eff.due < now && !(a.allDay && !eff.moved && dayKey(a.due) === dayKey(now));
  const loose = extraAttr ? ' loose' : '';
  const tip = `${a.title} · ${displayCourse(a.course)}` + (eff.moved ? ` · Canvas says ${fmtTime(a)}` : '');
  const inner = `${eff.meeting || a.allDay ? '' : fmtClock(eff.due) + ' '}${escapeHtml(a.title)}`;
  return a.url
    ? `<a class="cal-due${past ? ' past' : ''}${loose}" ${extraAttr} href="${escapeHtml(a.url)}" target="_blank" rel="noopener" title="${escapeHtml(tip)}">${inner}</a>`
    : `<span class="cal-due${past ? ' past' : ''}${loose}" ${extraAttr} title="${escapeHtml(tip)}">${inner}</span>`;
}

/* ---------- Wiring ---------- */

function updateEmptyState() {
  const has = assignments.length || schedule.length;
  $('#results').hidden = !has;
  $('#empty-state').hidden = !!has;
}
function toggleSettings(open) {
  const p = $('#settings');
  const willOpen = open === undefined ? p.hidden : open;
  p.hidden = !willOpen;
  $('#settings-toggle').setAttribute('aria-expanded', String(willOpen));
  if (willOpen && !localStorage.getItem(KEYS.pass)) $('#passphrase').focus();
}

// Tolerate a missing element (e.g. a stale cached index.html) instead of aborting all wiring.
function on(sel, evt, fn) { document.querySelectorAll(sel).forEach(el => el.addEventListener(evt, fn)); }

on('#settings-toggle', 'click', () => toggleSettings());
on('#quick', 'submit', (e) => {
  e.preventDefault();
  const inp = $('#quick-input');
  const ev = quickAdd(inp.value);
  if (ev) { inp.value = ''; inp.placeholder = `added · ${fmtDay(ev.start)} ${fmtClock(ev.start)}`.toLowerCase(); setTimeout(() => { inp.placeholder = 'add'; }, 4000); }
  else { inp.classList.add('shake'); setTimeout(() => inp.classList.remove('shake'), 400); }
});
document.addEventListener('click', (e) => { const b = e.target.closest('[data-del]'); if (b) { e.preventDefault(); removeCustom(b.dataset.del); } });
if (window.BG) {
  const bg = (localStorage.getItem(KEYS.bg) || 'none').replace('hair', 'grass');
  BG.set(bg);
  if ($('#bg-style')) $('#bg-style').value = bg;
  on('#bg-style', 'change', (e) => { localStorage.setItem(KEYS.bg, e.target.value); BG.set(e.target.value); });
}
if ($('#lunch-start')) { $('#lunch-start').value = hhmm(LUNCH.start); $('#lunch-end').value = hhmm(LUNCH.end); }
if ($('#clock-seconds')) $('#clock-seconds').checked = localStorage.getItem(KEYS.clockSeconds) === '1';
on('#clock-seconds', 'change', (e) => { localStorage.setItem(KEYS.clockSeconds, e.target.checked ? '1' : '0'); tickClock(); });
on('#lunch-start', 'change', setLunchFromInputs);
on('#lunch-end', 'change', setLunchFromInputs);
on('[data-open-settings]', 'click', () => toggleSettings(true));
on('.seg button', 'click', (e) => { view = e.currentTarget.dataset.view; localStorage.setItem('scheduler.view', view); render(); });
on('#cal-prev', 'click', () => { weekStart = new Date(weekStart.getTime() - 7 * DAY); render(); });
on('#cal-next', 'click', () => { weekStart = new Date(weekStart.getTime() + 7 * DAY); render(); });
on('#cal-range', 'click', () => { weekStart = startOfWeek(new Date()); render(); });
on('#plan-prev', 'click', () => { planDay = new Date(planDay.getTime() - DAY); planDayTouched = true; render(); });
on('#plan-next', 'click', () => { planDay = new Date(planDay.getTime() + DAY); planDayTouched = true; render(); });
on('#plan-date', 'click', () => { planDay = defaultDay(); planDayTouched = false; render(); });

// Clock in the top bar.
function tickClock() {
  const now = new Date();
  const t = $('#clock .t'), d = $('#clock .d');
  const secs = localStorage.getItem(KEYS.clockSeconds) === '1';
  if (t) t.textContent = now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', ...(secs ? { second: '2-digit' } : {}) }).toLowerCase();
  if (d) d.textContent = now.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).toLowerCase();
}
tickClock(); setInterval(tickClock, 1000);
// When the school day ends, roll the plan over to the next day (if the user hasn't navigated).
let wasAfter = afterSchool();
setInterval(() => { const a = afterSchool(); if (a !== wasAfter) { wasAfter = a; if (!planDayTouched) planDay = defaultDay(); render(); } }, 30 * 1000);

on('#unlock-form', 'submit', (e) => {
  e.preventDefault();
  unlock($('#passphrase').value);
});
on('#feed-file', 'change', async (e) => {
  const f = e.target.files[0];
  if (f) { loadAssignments(await f.text()); setStatus('#status', `Loaded ${assignments.length} Canvas items from file.`); }
});
on('#sched-file', 'change', async (e) => {
  const f = e.target.files[0];
  if (f) { loadSchedule(await f.text()); setStatus('#status', `Loaded ${schedule.length} schedule events from file.`); }
});
on('#refresh', 'click', () => {
  const p = localStorage.getItem(KEYS.pass);
  showMeta();
  if (p) unlock(p); else setStatus('#status', 'Enter your passphrase first.', true);
});
on('#forget', 'click', () => {
  Object.values(KEYS).forEach(k => localStorage.removeItem(k));
  assignments = []; schedule = []; blockMap = {}; nicknames = {};
  updateEmptyState();
  $('#mapping').hidden = true;
  $('#passphrase').value = '';
  setStatus('#status', 'Forgot passphrase and cached data.');
});

// Auto-refresh: re-pull the encrypted data every 30 minutes and whenever the tab becomes visible again
// (the GitHub Action refreshes the feeds hourly). Also re-render each minute so "now" markers move.
function autoRefresh() {
  const p = localStorage.getItem(KEYS.pass);
  if (p && !document.hidden) { showMeta(); unlock(p); }
}
setInterval(autoRefresh, 30 * 60 * 1000);
let lastRefresh = Date.now();
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && Date.now() - lastRefresh > 5 * 60 * 1000) { lastRefresh = Date.now(); autoRefresh(); }
});
setInterval(() => { if (!document.hidden && assignments.length) render(); }, 60 * 1000);

// Boot: show cached data instantly, then refresh from the repo if we have the passphrase.
(function boot() {
  const p = localStorage.getItem(KEYS.pass);
  const c1 = loadJSON(KEYS.feedCache);
  const c2 = loadJSON(KEYS.schedCache);
  if (c2) { try { loadSchedule(c2.text); } catch (_) {} }
  if (c1) { try { loadAssignments(c1.text); } catch (_) {} }
  showMeta();
  updateEmptyState();
  if (p) { $('#passphrase').value = p; unlock(p); }
  else if (!c1 && !c2) toggleSettings(true);
})();
