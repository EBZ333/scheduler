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
        default: break;
      }
    }
    return events;
  }
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
  global.ICS = { parse, toAssignment };
})(window);
