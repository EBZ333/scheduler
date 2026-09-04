const $ = (s) => document.querySelector(s);
const KEYS = {
  feedUrl: 'scheduler.feedUrl', feedCache: 'scheduler.feedCache',
  schedUrl: 'scheduler.schedUrl', schedCache: 'scheduler.schedCache',
  mapping: 'scheduler.blockMap',
};
const DAY = 86400000;

// Canvas and Google don't send CORS headers on feeds, so try direct, then public proxies.
const PROXIES = [
  (u) => u,
  (u) => 'https://corsproxy.io/?' + encodeURIComponent(u),
  (u) => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u),
];

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

async function fetchFeed(url) {
  let lastErr;
  for (const wrap of PROXIES) {
    try {
      const res = await fetch(wrap(url), { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const text = await res.text();
      if (!/BEGIN:VCALENDAR/.test(text)) throw new Error('Response was not an ICS calendar');
      return text;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('Could not fetch feed');
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
  setStatus('#status', `Loaded ${assignments.length} items.`);
}

async function loadAssignmentsFromUrl(url) {
  setStatus('#status', 'Fetching feed…');
  try {
    const text = await fetchFeed(url);
    localStorage.setItem(KEYS.feedUrl, url);
    loadAssignments(text);
  } catch (e) {
    setStatus('#status', `Couldn't fetch the feed (${e.message}). Use the upload/paste option below.`, true);
  }
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

function loadSchedule(text) {
  const events = ICS.parse(text);
  const now = new Date();
  const rangeStart = new Date(now.getTime() - 60 * DAY);
  const rangeEnd = new Date(now.getTime() + 365 * DAY);
  schedule = ICS.expand(events, rangeStart, rangeEnd).map(ev => {
    const m = (ev.summary || '').match(BLOCK_RE);
    return {
      title: ev.summary || '(untitled)',
      block: m ? 'Block ' + m[1] : null,
      start: ev.instance,
      end: ev.end ? ev.end.date : null,
      allDay: ev.start.allDay,
    };
  }).sort((a, b) => a.start - b.start);
  saveJSON(KEYS.schedCache, { text, at: Date.now() });
  renderMapping();
  render();
  const blocks = blockNames();
  setStatus('#sched-status', `Loaded ${schedule.length} schedule events, ${blocks.length} distinct blocks.`);
}

async function loadScheduleFromUrl(url) {
  setStatus('#sched-status', 'Fetching schedule…');
  try {
    const text = await fetchFeed(url);
    localStorage.setItem(KEYS.schedUrl, url);
    loadSchedule(text);
  } catch (e) {
    setStatus('#sched-status', `Couldn't fetch the schedule (${e.message}). Try the upload option.`, true);
  }
}

function blockNames() {
  const set = new Set(schedule.map(s => s.block).filter(Boolean));
  return [...set].sort((a, b) => +a.split(' ')[1] - +b.split(' ')[1]);
}

// course -> block (inverse of blockMap)
function blockForCourse(course) {
  for (const [block, c] of Object.entries(blockMap)) if (c === course) return block;
  return null;
}

function renderMapping() {
  const blocks = blockNames();
  const box = $('#mapping');
  if (!blocks.length) { box.hidden = true; return; }
  box.hidden = false;
  const cs = courses();
  $('#mapping-rows').innerHTML = blocks.map(b => `
    <label class="map-row">
      <span>${escapeHtml(b)}</span>
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
      if (sel.value) blockMap[b] = sel.value; else delete blockMap[b];
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
    const label = course ? `${s.block} · ${course}` : s.title;
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
          meta = `<span class="tag">${escapeHtml(block)}${meetsThatDay.allDay ? '' : ' at ' + fmtClock(meetsThatDay.start)}</span>`;
        } else {
          const prev = [...schedule].reverse().find(s => s.block === block && s.start < a.due);
          if (prev) meta = `<span class="tag muted">no ${escapeHtml(block)} that day · last class ${escapeHtml(prev.start.toLocaleDateString(undefined, { weekday: 'short' }))}</span>`;
          else meta = `<span class="tag muted">no ${escapeHtml(block)} that day</span>`;
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

$('#feed-form').addEventListener('submit', (e) => {
  e.preventDefault();
  loadAssignmentsFromUrl($('#feed-url').value.trim());
});
$('#feed-file').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (f) loadAssignments(await f.text());
});
$('#parse-text').addEventListener('click', () => {
  const t = $('#feed-text').value;
  if (t.trim()) loadAssignments(t);
});
$('#sched-form').addEventListener('submit', (e) => {
  e.preventDefault();
  loadScheduleFromUrl($('#sched-url').value.trim());
});
$('#sched-file').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (f) loadSchedule(await f.text());
});
$('#show-past').addEventListener('change', render);
$('#course-filter').addEventListener('change', render);
$('#refresh').addEventListener('click', () => {
  const u1 = localStorage.getItem(KEYS.feedUrl);
  const u2 = localStorage.getItem(KEYS.schedUrl);
  if (u1) loadAssignmentsFromUrl(u1);
  if (u2) loadScheduleFromUrl(u2);
  if (!u1 && !u2) setStatus('#status', 'No saved feed URLs.', true);
});
$('#forget').addEventListener('click', () => {
  Object.values(KEYS).forEach(k => localStorage.removeItem(k));
  assignments = []; schedule = []; blockMap = {};
  $('#results').hidden = true;
  $('#mapping').hidden = true;
  $('#feed-url').value = '';
  $('#sched-url').value = '';
  setStatus('#status', 'Forgot saved feeds.');
  setStatus('#sched-status', '');
});

// Boot: restore saved URLs, show cached data instantly, then refresh.
(function boot() {
  const u1 = localStorage.getItem(KEYS.feedUrl);
  const u2 = localStorage.getItem(KEYS.schedUrl);
  const c1 = loadJSON(KEYS.feedCache);
  const c2 = loadJSON(KEYS.schedCache);
  if (u1) $('#feed-url').value = u1;
  if (u2) $('#sched-url').value = u2;
  if (c2) { try { loadSchedule(c2.text); } catch (_) {} }
  if (c1) { try { loadAssignments(c1.text); } catch (_) {} }
  if (u1) loadAssignmentsFromUrl(u1);
  if (u2) loadScheduleFromUrl(u2);
})();
