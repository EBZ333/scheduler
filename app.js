const $ = (s) => document.querySelector(s);
const STORE_KEY = 'scheduler.feedUrl';
const CACHE_KEY = 'scheduler.feedCache';

// Canvas doesn't send CORS headers on feeds, so try direct, then public proxies.
const PROXIES = [
  (u) => u,
  (u) => 'https://corsproxy.io/?' + encodeURIComponent(u),
  (u) => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u),
];

let assignments = [];

function setStatus(msg, isError = false) {
  const el = $('#status');
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

function load(text) {
  const events = ICS.parse(text);
  assignments = events.map(ICS.toAssignment).filter(a => a.due);
  assignments.sort((a, b) => a.due - b.due);
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ text, at: Date.now() })); } catch (_) {}
  populateCourses();
  render();
  $('#results').hidden = false;
  setStatus(`Loaded ${assignments.length} items.`);
}

function populateCourses() {
  const sel = $('#course-filter');
  const current = sel.value;
  const courses = [...new Set(assignments.map(a => a.course).filter(Boolean))].sort();
  sel.innerHTML = '<option value="">All courses</option>' +
    courses.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  sel.value = courses.includes(current) ? current : '';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function dayKey(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); }

function fmtDay(d) {
  const diff = Math.round((dayKey(d) - dayKey(new Date())) / 86400000);
  const label = d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
  if (diff === 0) return 'Today · ' + label;
  if (diff === 1) return 'Tomorrow · ' + label;
  return label;
}

function fmtTime(a) {
  if (a.allDay) return 'All day';
  return a.due.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
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

  if (!items.length) {
    list.innerHTML = '<p class="empty">Nothing here. Try "Show past" or another course.</p>';
    return;
  }

  const groups = new Map();
  for (const a of items) {
    const k = dayKey(a.due);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(a);
  }

  let html = '';
  for (const [k, arr] of groups) {
    const isToday = k === todayKey;
    html += `<div class="day"><h3 class="${isToday ? 'today' : ''}">${escapeHtml(fmtDay(new Date(k)))}</h3>`;
    for (const a of arr) {
      const past = a.due < now && !(a.allDay && k === todayKey);
      const soon = !past && (a.due - now) < 2 * 86400000;
      const cls = ['item', past ? 'past' : '', soon ? 'soon' : ''].join(' ');
      const title = a.url
        ? `<a href="${escapeHtml(a.url)}" target="_blank" rel="noopener">${escapeHtml(a.title)}</a>`
        : escapeHtml(a.title);
      html += `<div class="${cls}">
        <div><div class="title">${title}</div><div class="course">${escapeHtml(a.course)}</div></div>
        <div class="time">${escapeHtml(fmtTime(a))}</div>
      </div>`;
    }
    html += '</div>';
  }
  list.innerHTML = html;
}

async function loadFromUrl(url) {
  setStatus('Fetching feed…');
  try {
    const text = await fetchFeed(url);
    localStorage.setItem(STORE_KEY, url);
    load(text);
  } catch (e) {
    setStatus(`Couldn't fetch the feed (${e.message}). Use the upload/paste option below.`, true);
  }
}

$('#feed-form').addEventListener('submit', (e) => {
  e.preventDefault();
  loadFromUrl($('#feed-url').value.trim());
});
$('#feed-file').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (f) load(await f.text());
});
$('#parse-text').addEventListener('click', () => {
  const t = $('#feed-text').value;
  if (t.trim()) load(t);
});
$('#show-past').addEventListener('change', render);
$('#course-filter').addEventListener('change', render);
$('#refresh').addEventListener('click', () => {
  const url = localStorage.getItem(STORE_KEY);
  if (url) loadFromUrl(url); else setStatus('No saved feed URL.', true);
});
$('#forget').addEventListener('click', () => {
  localStorage.removeItem(STORE_KEY);
  localStorage.removeItem(CACHE_KEY);
  assignments = [];
  $('#results').hidden = true;
  $('#feed-url').value = '';
  setStatus('Forgot saved feed.');
});

// Boot: restore saved URL, show cached data instantly, then refresh.
(function boot() {
  const url = localStorage.getItem(STORE_KEY);
  const cache = localStorage.getItem(CACHE_KEY);
  if (url) $('#feed-url').value = url;
  if (cache) {
    try { load(JSON.parse(cache).text); } catch (_) {}
  }
  if (url) loadFromUrl(url);
})();
