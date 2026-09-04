// Runs in GitHub Actions. Fetches the Canvas and Google Calendar ICS feeds (URLs from repo secrets),
// encrypts each with a passphrase (AES-256-GCM, PBKDF2-SHA256), and writes data/*.enc for the page to decrypt.
const crypto = require('crypto');
const fs = require('fs');

const PBKDF2_ITER = 200000;
const pass = process.env.DATA_PASSPHRASE;
if (!pass) { console.error('DATA_PASSPHRASE secret is not set'); process.exit(1); }

const feeds = {
  canvas: process.env.CANVAS_FEED_URL,
  schedule: process.env.SCHEDULE_FEED_URL,
};

function encrypt(text) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.pbkdf2Sync(pass, salt, PBKDF2_ITER, 32, 'sha256');
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(text, 'utf8'), c.final(), c.getAuthTag()]);
  return JSON.stringify({ v: 1, iter: PBKDF2_ITER, salt: salt.toString('base64'), iv: iv.toString('base64'), ct: ct.toString('base64') });
}

function decrypt(json) {
  const { salt, iv, ct, iter } = JSON.parse(json);
  const key = crypto.pbkdf2Sync(pass, Buffer.from(salt, 'base64'), iter || PBKDF2_ITER, 32, 'sha256');
  const buf = Buffer.from(ct, 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  d.setAuthTag(buf.subarray(buf.length - 16));
  return d.update(buf.subarray(0, buf.length - 16)) + d.final('utf8');
}

async function main() {
  fs.mkdirSync('data', { recursive: true });
  const meta = { updated: new Date().toISOString(), feeds: {} };
  let failed = false;

  for (const [name, url] of Object.entries(feeds)) {
    const file = `data/${name}.enc`;
    if (!url) { meta.feeds[name] = 'secret not set'; console.warn(`${name}: no URL secret set, skipping`); continue; }
    try {
      const res = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'scheduler-fetch' } });
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (!text.includes('BEGIN:VCALENDAR')) throw new Error('response is not an ICS calendar (is the calendar shared / URL correct?)');

      // Only rewrite when the content changed, so the repo isn't committed to every hour.
      let unchanged = false;
      if (fs.existsSync(file)) {
        try { unchanged = decrypt(fs.readFileSync(file, 'utf8')) === text; } catch (_) { /* passphrase changed; rewrite */ }
      }
      if (!unchanged) fs.writeFileSync(file, encrypt(text));
      const events = (text.match(/BEGIN:VEVENT/g) || []).length;
      meta.feeds[name] = `ok (${events} events)`;
      console.log(`${name}: ${events} events${unchanged ? ', unchanged' : ''}`);
    } catch (e) {
      failed = true;
      meta.feeds[name] = `error: ${e.message}`;
      console.error(`${name}: ${e.message}`);
    }
  }
  fs.writeFileSync('data/meta.json', JSON.stringify(meta, null, 1) + '\n');
  if (failed) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
