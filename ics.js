// Minimal ICS (RFC 5545) parser tuned for Canvas calendar feeds.
(function (global) {
  function unfold(text) {
    return text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '');
  }
  function unescapeText(v) {
    return v.replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
  }
  function parseDate(value, params) {
    // 20260903 (all-day) | 20260903T235900Z (UTC) | 20260903T235900 (local/TZID)
    const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
    if (!m) return null;
    const [, y, mo, d, h, mi, s, z] = m;
    const allDay = !h || params.VALUE === 'DATE';
    if (allDay) return { date: new Date(+y, +mo - 1, +d), allDay: true };
    if (z) return { date: new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +(s || 0))), allDay: false };
    return { date: new Date(+y, +mo - 1, +d, +h, +mi, +(s || 0)), allDay: false };
  }
  function parse(text) {
    const lines = unfold(text).split('\n');
    const events = [];
    let cur = null;
    for (const line of lines) {
      if (line === 'BEGIN:VEVENT') { cur = {}; continue; }
      if (line === 'END:VEVENT') { if (cur) events.push(cur); cur = null; continue; }
      if (!cur) continue;
      const idx = line.indexOf(':');
      if (idx < 0) continue;
      const head = line.slice(0, idx);
      const value = line.slice(idx + 1);
      const [name, ...paramParts] = head.split(';');
      const params = {};
      for (const p of paramParts) { const [k, v] = p.split('='); params[k] = v; }
      switch (name) {
        case 'SUMMARY': cur.summary = unescapeText(value); break;
        case 'DESCRIPTION': cur.description = unescapeText(value); break;
        case 'URL': cur.url = value; break;
        case 'UID': cur.uid = value; break;
        case 'DTSTART': cur.start = parseDate(value, params); break;
        case 'DTEND': cur.end = parseDate(value, params); break;
        case 'RRULE': cur.rrule = parseRRule(value); break;
        case 'EXDATE':
          cur.exdates = cur.exdates || [];
          for (const v of value.split(',')) { const d = parseDate(v, params); if (d) cur.exdates.push(dayStamp(d.date)); }
          break;
        case 'RECURRENCE-ID': cur.recurrenceId = parseDate(value, params); break;
        default: break;
      }
    }
    return events;
  }

  function parseRRule(value) {
    const r = {};
    for (const part of value.split(';')) { const [k, v] = part.split('='); r[k] = v; }
    return r;
  }
  function dayStamp(d) { return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); }
  const DOW = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

  // Expand recurring events (DAILY / WEEKLY with BYDAY, INTERVAL, UNTIL, COUNT, EXDATE)
  // into concrete instances between rangeStart and rangeEnd. Good enough for Google Calendar class schedules.
  function expand(events, rangeStart, rangeEnd) {
    const out = [];
    // Instances that override a recurrence (edited single occurrences) replace the generated one.
    const overrides = new Set();
    for (const ev of events) if (ev.recurrenceId && ev.uid) overrides.add(ev.uid + '@' + dayStamp(ev.recurrenceId.date));

    for (const ev of events) {
      if (!ev.start) continue;
      const durMs = ev.end ? ev.end.date - ev.start.date : 0;
      if (!ev.rrule) {
        if (ev.start.date <= rangeEnd && (ev.start.date.getTime() + durMs) >= rangeStart) out.push({ ...ev, instance: ev.start.date });
        continue;
      }
      const r = ev.rrule;
      const freq = r.FREQ;
      if (freq !== 'DAILY' && freq !== 'WEEKLY') { out.push({ ...ev, instance: ev.start.date }); continue; }
      const interval = +(r.INTERVAL || 1);
      const until = r.UNTIL ? parseDate(r.UNTIL, {}) : null;
      const untilDate = until ? until.date : null;
      let count = r.COUNT ? +r.COUNT : Infinity;
      const byday = r.BYDAY ? r.BYDAY.split(',').map(s => DOW[s.replace(/^[-+]?\d+/, '')]) : null;
      const ex = new Set(ev.exdates || []);
      const first = ev.start.date;
      const hardEnd = new Date(Math.min(rangeEnd.getTime(), untilDate ? untilDate.getTime() : Infinity));

      // Walk day by day from the first occurrence; cheap enough for a school-year window.
      const cur = new Date(first);
      let produced = 0;
      const startDow = first.getDay();
      const weekStartOfFirst = new Date(first); weekStartOfFirst.setDate(first.getDate() - startDow); weekStartOfFirst.setHours(0, 0, 0, 0);
      while (cur <= hardEnd && produced < count) {
        let hit = false;
        if (freq === 'DAILY') {
          const days = Math.round((dayStart(cur) - dayStart(first)) / 86400000);
          hit = days % interval === 0;
        } else {
          const ws = new Date(cur); ws.setDate(cur.getDate() - cur.getDay()); ws.setHours(0, 0, 0, 0);
          const weeks = Math.round((ws - weekStartOfFirst) / (7 * 86400000));
          const dowOk = byday ? byday.includes(cur.getDay()) : cur.getDay() === startDow;
          hit = dowOk && weeks % interval === 0;
        }
        if (hit) {
          produced++;
          const stamp = dayStamp(cur);
          if (!ex.has(stamp) && !overrides.has(ev.uid + '@' + stamp) && cur >= rangeStart) {
            out.push({ ...ev, instance: new Date(cur), end: ev.end ? { ...ev.end, date: new Date(cur.getTime() + durMs) } : null });
          }
        }
        cur.setDate(cur.getDate() + 1);
      }
    }
    return out;
  }
  function dayStart(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
  // Canvas titles look like "Essay 2 [English 10]". Split into title + course.
  function toAssignment(ev) {
    const summary = ev.summary || '(untitled)';
    const m = summary.match(/^(.*?)\s*\[([^\]]+)\]\s*$/);
    const isAssignment = /assignment|quiz|discussion|planner/i.test(ev.uid || '') || /\/assignments\//.test(ev.url || '');
    return {
      uid: ev.uid,
      title: m ? m[1] : summary,
      course: m ? m[2] : '',
      due: ev.start ? ev.start.date : null,
      allDay: ev.start ? ev.start.allDay : true,
      url: ev.url || '',
      description: ev.description || '',
      isAssignment
    };
  }
  global.ICS = { parse, toAssignment, expand };
})(window);
