#!/usr/bin/env node
// Local-only submission review tool for JC AiPP Store.
//
// A public /review/ page cannot call the here.now owner API from the browser:
// GET https://here.now/api/v1/publishes/<slug>/data/<collection> does not send
// CORS headers (see https://here.now/docs#sitedata-owner-api; the browser API is
// same-origin and owner-only reads stay forbidden — https://here.now/docs#sitedata-browser-api).
// This tool runs on 127.0.0.1 only, keeps the API key on the server, writes
// decisions to ~/.aipp-store (never the repo), and publishes nothing.
//
//   npm run review                         # open http://127.0.0.1:8787/
//   node tools/review.mjs --list           # print submissions to the terminal
//   node tools/review.mjs --decide ID approve|reject
//
// Key and slug: HERENOW_API_KEY / HERENOW_SLUG, or ~/.aipp-store/config.json
// ({ "apiKey", "slug" }). The gitignored config.local.json is a fallback only.
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { COLLECTION, FIELDS, HONEYPOT } from './submission-schema.mjs';
import { RECORD_ID_RE, fieldsOf, loadApproved, validMeta } from './submissions-batch.mjs';

export const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DEFAULT_PORT = 8787;
const DEFAULT_BIND = '127.0.0.1';
const MAX_PAGES = 50;
const MAX_BODY = 16 * 1024;

const placeholder = (v) => typeof v !== 'string' || !v || /^(OPTIONAL|YOUR_|PUT |TBD$)/.test(v);
const normRepo = (u) => String(u || '').trim().toLowerCase().replace(/\.git$/, '').replace(/\/+$/, '');

export function defaultPaths(home = os.homedir()) {
  const dir = path.join(home, '.aipp-store');
  return {
    configFile: path.join(dir, 'config.json'),
    approvedAppsFile: path.join(dir, 'approved-apps.json'),
    decisionsFile: path.join(dir, 'decisions.json'),
  };
}

export function assertPrivateFile(file, repoRoot = root) {
  if (typeof file !== 'string' || !file || !path.isAbsolute(file)) {
    const e = new Error('approved-apps and decisions files must be an absolute path outside the repo');
    e.code = 'path-not-private';
    throw e;
  }
  const resolved = path.resolve(file);
  const base = path.resolve(repoRoot) + path.sep;
  if (resolved === path.resolve(repoRoot) || resolved.startsWith(base)) {
    const e = new Error('approved-apps and decisions files must be an absolute path outside the repo');
    e.code = 'path-not-private';
    throw e;
  }
  return resolved;
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function writePrivate(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = file + '.tmp-' + crypto.randomBytes(6).toString('hex');
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, file);
  fs.chmodSync(file, 0o600);
}

export function githubRepo(u) {
  const n = normRepo(u);
  if (!n) return '';
  try {
    const url = new URL(n);
    if (url.protocol !== 'https:') return '';
    if (url.hostname !== 'github.com') return '';
    if (url.username || url.password) return '';
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length < 2) return '';
    const repo = `https://github.com/${parts[0]}/${parts[1]}`;
    return /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/.test(repo) ? repo : '';
  } catch {
    return '';
  }
}

export function isHttpsUrl(v) {
  try {
    const u = new URL(String(v || ''));
    return u.protocol === 'https:' && !!u.hostname && u.hostname.includes('.') && !u.username && !u.password;
  } catch {
    return false;
  }
}

export function loadReviewConfig({
  home = os.homedir(),
  repoRoot = root,
  env = process.env,
  localConfigPath = path.join(repoRoot, 'config.local.json'),
} = {}) {
  const defaults = defaultPaths(home);
  const homeCfg = readJson(defaults.configFile) || {};
  let local = {};
  try {
    if (localConfigPath && fs.existsSync(localConfigPath)) local = JSON.parse(fs.readFileSync(localConfigPath, 'utf8')) || {};
  } catch { local = {}; }

  const envKey = env.HERENOW_API_KEY;
  const envSlug = env.HERENOW_SLUG;
  const apiKey = (!placeholder(envKey) && envKey)
    || (!placeholder(homeCfg.apiKey) && homeCfg.apiKey)
    || (!placeholder(local.herenow?.apiKey) && local.herenow.apiKey)
    || '';
  const slug = (!placeholder(envSlug) && envSlug)
    || (!placeholder(homeCfg.slug) && homeCfg.slug)
    || (!placeholder(local.herenow?.slug) && local.herenow.slug)
    || '';
  const approvedAppsFile = assertPrivateFile(
    env.AIPP_APPROVED_APPS || homeCfg.approvedAppsFile || defaults.approvedAppsFile,
    repoRoot,
  );
  const decisionsFile = assertPrivateFile(
    env.AIPP_DECISIONS || homeCfg.decisionsFile || defaults.decisionsFile,
    repoRoot,
  );
  return { apiKey, slug, approvedAppsFile, decisionsFile, configFile: defaults.configFile };
}

export function loadDecisions(file) {
  const j = readJson(file);
  const list = Array.isArray(j?.decisions) ? j.decisions : [];
  return list.filter((d) => d && RECORD_ID_RE.test(String(d.id || '')) && (d.decision === 'approve' || d.decision === 'reject'));
}

export function decisionsMap(list) {
  const out = {};
  for (const d of list) out[d.id] = { id: d.id, decision: d.decision, at: d.at || null, ...(d.repo ? { repo: d.repo } : {}) };
  return out;
}

export function recordDecision({ id, decision, at, repo }, { decisionsFile, approvedAppsFile, repoRoot = root } = {}) {
  if (!RECORD_ID_RE.test(String(id || ''))) {
    const e = new Error('Invalid record id');
    e.code = 'bad-id';
    throw e;
  }
  if (decision !== 'approve' && decision !== 'reject') {
    const e = new Error('decision must be approve or reject');
    e.code = 'bad-decision';
    throw e;
  }
  const decPath = assertPrivateFile(decisionsFile, repoRoot);
  const allowPath = assertPrivateFile(approvedAppsFile, repoRoot);
  const safeRepo = githubRepo(repo);
  const entry = { id: String(id), decision, at: at || new Date().toISOString() };
  if (safeRepo) entry.repo = safeRepo;
  const existing = loadDecisions(decPath).filter((d) => d.id !== entry.id);
  existing.push(entry);
  writePrivate(decPath, { decisions: existing });
  if (decision === 'approve' && safeRepo) {
    const repos = [...new Set([...loadApproved(allowPath), safeRepo])];
    writePrivate(allowPath, { repos });
  }
  return entry;
}

export async function fetchSubmissions(cfg, { fetchImpl = globalThis.fetch, maxPages = MAX_PAGES } = {}) {
  if (!cfg.apiKey || !cfg.slug) {
    const e = new Error('Review needs a here.now API key and site slug (HERENOW_API_KEY / HERENOW_SLUG or ~/.aipp-store/config.json).');
    e.code = 'missing-config';
    throw e;
  }
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/i.test(cfg.slug)) {
    const e = new Error('Site slug is not a valid here.now slug.');
    e.code = 'bad-slug';
    throw e;
  }
  const out = [];
  let cursor = '';
  let page = 0;
  for (; page < maxPages; page++) {
    const u = `https://here.now/api/v1/publishes/${encodeURIComponent(cfg.slug)}/data/${COLLECTION}?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const res = await fetchImpl(u, { headers: { authorization: `Bearer ${cfg.apiKey}` } });
    if (res.status === 404) throw new Error(`Site Data collection "${COLLECTION}" was not found (the manifest may not be published yet).`);
    if (!res.ok) throw new Error(`Site Data list failed: HTTP ${res.status}`);
    const j = await res.json();
    out.push(...(j.records || []));
    if (!j.nextCursor) break;
    cursor = j.nextCursor;
  }
  if (page >= maxPages) {
    const e = new Error(`fetch-cap: more than ${maxPages} pages of records; stopped.`);
    e.code = 'fetch-cap';
    throw e;
  }
  return out;
}

export function reviewView(record) {
  const f = fieldsOf(record) || {};
  const fields = {};
  for (const d of FIELDS) {
    if (d.name === HONEYPOT) continue;
    if (f[d.name] == null || f[d.name] === '') continue;
    fields[d.name] = f[d.name];
  }
  return {
    id: validMeta(record) ? record.id : (typeof record?.id === 'string' ? record.id : ''),
    created_at: typeof record?.created_at === 'string' ? record.created_at : '',
    fields,
    honeypot: !!f[HONEYPOT],
    repo: githubRepo(f.repo_url),
  };
}

// Public-safe projection: never includes contact_email (or any private field).
export function publicSafeView(record) {
  const v = reviewView(record);
  const fields = { ...v.fields };
  delete fields.contact_email;
  return { ...v, fields };
}

export const PAGE_JS = `(function () {
  function text(el, value) { el.textContent = value == null ? '' : String(value); }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }
  function isHttps(v) {
    try {
      var u = new URL(String(v || ''));
      return u.protocol === 'https:' && !!u.hostname && u.hostname.indexOf('.') > 0 && !u.username && !u.password;
    } catch (e) { return false; }
  }
  function addValue(parent, value) {
    var s = value == null ? '' : String(value);
    if (isHttps(s)) {
      var a = document.createElement('a');
      a.href = s;
      a.rel = 'noopener noreferrer';
      a.target = '_blank';
      a.textContent = s;
      parent.appendChild(a);
      return;
    }
    parent.appendChild(document.createTextNode(s));
  }
  var csrf = document.querySelector('meta[name="csrf-token"]').getAttribute('content');
  var status = document.getElementById('status');
  var list = document.getElementById('list');
  var empty = document.getElementById('empty');

  function render(data) {
    clear(list);
    var recs = data.submissions || [];
    var dec = data.decisions || {};
    empty.hidden = recs.length > 0;
    recs.forEach(function (rec) {
      var card = document.createElement('article');
      card.className = 'card';
      var h = document.createElement('h2');
      text(h, (rec.fields && rec.fields.app_name) || rec.id || 'Untitled');
      card.appendChild(h);
      var meta = document.createElement('p');
      meta.className = 'meta';
      var bits = [];
      if (rec.id) bits.push('ID ' + rec.id);
      if (rec.created_at) bits.push(rec.created_at);
      if (rec.honeypot) bits.push('honeypot filled');
      if (dec[rec.id]) bits.push('decision: ' + dec[rec.id].decision);
      text(meta, bits.join(' · '));
      card.appendChild(meta);
      var dl = document.createElement('dl');
      Object.keys(rec.fields || {}).forEach(function (name) {
        var dt = document.createElement('dt');
        text(dt, name);
        var dd = document.createElement('dd');
        addValue(dd, rec.fields[name]);
        dl.appendChild(dt);
        dl.appendChild(dd);
      });
      card.appendChild(dl);
      var actions = document.createElement('p');
      actions.className = 'actions';
      ['approve', 'reject'].forEach(function (kind) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.setAttribute('data-decision', kind);
        text(btn, kind === 'approve' ? 'Approve' : 'Reject');
        if (dec[rec.id] && dec[rec.id].decision === kind) btn.disabled = true;
        btn.addEventListener('click', function () { decide(rec.id, kind, btn); });
        actions.appendChild(btn);
      });
      card.appendChild(actions);
      var note = document.createElement('p');
      note.className = 'result';
      note.hidden = true;
      card.appendChild(note);
      list.appendChild(card);
    });
  }

  function decide(id, decision, btn) {
    var card = btn.closest('article');
    var note = card.querySelector('.result');
    note.hidden = false;
    text(note, 'Saving…');
    fetch('/api/decide', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
      body: JSON.stringify({ id: id, decision: decision, csrf: csrf })
    }).then(function (res) { return res.json().then(function (j) { return { ok: res.ok, j: j }; }); })
      .then(function (r) {
        if (!r.ok) { text(note, r.j && r.j.error ? r.j.error : 'Could not save that decision.'); return; }
        text(note, decision === 'approve' ? 'Approved. Recorded locally.' : 'Rejected. Recorded locally.');
        card.querySelectorAll('button[data-decision]').forEach(function (b) {
          b.disabled = b.getAttribute('data-decision') === decision;
        });
      })
      .catch(function () { text(note, 'Could not reach the local review server.'); });
  }

  text(status, 'Loading…');
  fetch('/api/submissions', { headers: { 'x-csrf-token': csrf } })
    .then(function (res) { return res.json().then(function (j) { return { ok: res.ok, status: res.status, j: j }; }); })
    .then(function (r) {
      if (!r.ok) {
        text(status, r.j && r.j.error ? r.j.error : 'Could not load submissions.');
        return;
      }
      text(status, (r.j.submissions || []).length ? '' : 'No submissions yet.');
      render(r.j);
    })
    .catch(function () { text(status, 'Could not reach the local review server.'); });
})();`;

export function pageHtml(csrf) {
  const token = String(csrf || '').replace(/[^A-Za-z0-9._-]/g, '');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta name="csrf-token" content="${token}">
<title>Review submissions (local only)</title>
<style>
  :root { color-scheme: dark light; --bg: #111; --fg: #f4f4f4; --muted: #b0b0b0; --card: #1c1c1c; --line: #333; --ok: #8bd48b; --no: #e8a0a0; }
  html, body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.5 system-ui, sans-serif; }
  main { max-width: 52rem; margin: 0 auto; padding: 1.5rem 1rem 3rem; }
  h1 { font-size: 1.4rem; margin: 0 0 .5rem; }
  .lead, .meta, .result { color: var(--muted); }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 1rem 1.1rem; margin: 1rem 0; }
  dl { display: grid; grid-template-columns: 11rem 1fr; gap: .3rem 1rem; margin: .8rem 0; }
  dt { color: var(--muted); overflow-wrap: anywhere; }
  dd { margin: 0; overflow-wrap: anywhere; }
  a { color: inherit; }
  .actions { display: flex; gap: .6rem; }
  button { font: inherit; padding: .4rem .8rem; border-radius: 8px; border: 1px solid var(--line); background: #2a2a2a; color: var(--fg); cursor: pointer; }
  button[data-decision="approve"] { border-color: var(--ok); }
  button[data-decision="reject"] { border-color: var(--no); }
  button:disabled { opacity: .5; cursor: default; }
  @media (max-width: 640px) { dl { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<main>
  <h1>Review submissions</h1>
  <p class="lead">This page runs only on this computer. Approve or reject stays in a local log and, for approved source repos, the local allowlist. Nothing is published, and the API key never leaves this machine.</p>
  <p id="status" role="status"></p>
  <p id="empty" hidden>No submissions to show.</p>
  <div id="list"></div>
</main>
<script>${PAGE_JS}</script>
</body>
</html>
`;
}

function isLocalHost(host) {
  const h = String(host || '').split(':')[0].toLowerCase();
  return h === '127.0.0.1' || h === 'localhost' || h === '::1' || h === '[::1]';
}

function requestLocal(req) {
  const host = req.headers.host || '';
  if (!isLocalHost(host)) return false;
  const origin = req.headers.origin;
  if (origin) {
    try {
      const u = new URL(origin);
      if (!isLocalHost(u.hostname)) return false;
    } catch { return false; }
  }
  return true;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let n = 0;
    req.on('data', (c) => {
      n += c.length;
      if (n > MAX_BODY) { reject(Object.assign(new Error('body too large'), { code: 'body-too-large' })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function send(res, status, body, headers = {}) {
  const data = typeof body === 'string' ? body : JSON.stringify(body);
  const type = typeof body === 'string' ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8';
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers });
  res.end(data);
}

export function createReviewServer(opts = {}) {
  const cfg = opts.config || loadReviewConfig(opts);
  const csrf = opts.csrfToken || crypto.randomBytes(16).toString('hex');
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const repoRoot = opts.repoRoot || root;
  const now = opts.now;

  const server = http.createServer(async (req, res) => {
    try {
      if (!requestLocal(req)) { send(res, 403, { error: 'This review tool only accepts requests from this computer.' }); return; }
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
        send(res, 200, pageHtml(csrf));
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/submissions') {
        if ((req.headers['x-csrf-token'] || '') !== csrf) { send(res, 403, { error: 'Missing or bad CSRF token.' }); return; }
        const records = await fetchSubmissions(cfg, { fetchImpl });
        const decisions = decisionsMap(loadDecisions(cfg.decisionsFile));
        send(res, 200, { submissions: records.map(reviewView), decisions });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/decide') {
        const raw = await readBody(req);
        let body = {};
        try { body = JSON.parse(raw); } catch { send(res, 400, { error: 'Expected JSON.' }); return; }
        const token = body.csrf || req.headers['x-csrf-token'] || '';
        if (token !== csrf) { send(res, 403, { error: 'Missing or bad CSRF token.' }); return; }
        const records = await fetchSubmissions(cfg, { fetchImpl });
        const rec = records.find((r) => r && r.id === body.id);
        if (!rec) { send(res, 404, { error: 'No submission with that id.' }); return; }
        const entry = recordDecision(
          { id: rec.id, decision: body.decision, at: now ? now() : undefined, repo: fieldsOf(rec).repo_url },
          { decisionsFile: cfg.decisionsFile, approvedAppsFile: cfg.approvedAppsFile, repoRoot },
        );
        send(res, 200, { ok: true, decision: entry });
        return;
      }
      send(res, 404, { error: 'Not found.' });
    } catch (err) {
      const msg = err && err.code === 'missing-config'
        ? err.message
        : (err && err.code === 'path-not-private' ? err.message : 'Something went wrong.');
      send(res, err && err.code === 'missing-config' ? 400 : 500, { error: msg });
    }
  });
  return { server, csrf, cfg };
}

export function listenReviewServer(server, { bind = DEFAULT_BIND, port = DEFAULT_PORT } = {}) {
  if (bind !== '127.0.0.1' && bind !== '::1') {
    const e = new Error('The review server only binds to 127.0.0.1 or ::1.');
    e.code = 'bad-bind';
    throw e;
  }
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, bind, () => {
      server.removeListener('error', reject);
      resolve(server.address());
    });
  });
}

function formatList(records, decisions) {
  const lines = [];
  for (const rec of records) {
    const v = reviewView(rec);
    const d = decisions[v.id];
    lines.push(`${v.id || '(no id)'}  ${v.fields.app_name || ''}  ${v.fields.dev_name || ''}  ${v.fields.contact_email || ''}  ${d ? d.decision : 'pending'}`);
  }
  return lines.join('\n');
}

async function main(argv = process.argv.slice(2), env = process.env) {
  const cfg = loadReviewConfig({ env });
  const list = argv.includes('--list');
  const decideIdx = argv.indexOf('--decide');
  if (list || decideIdx !== -1) {
    const records = await fetchSubmissions(cfg);
    const dec = decisionsMap(loadDecisions(cfg.decisionsFile));
    if (list) {
      const out = formatList(records, dec);
      if (out) console.log(out);
      else console.log('No submissions.');
      return;
    }
    const id = argv[decideIdx + 1];
    const decision = argv[decideIdx + 2];
    const rec = records.find((r) => r && r.id === id);
    if (!rec) throw new Error('No submission with that id.');
    const entry = recordDecision(
      { id, decision, repo: fieldsOf(rec).repo_url },
      { decisionsFile: cfg.decisionsFile, approvedAppsFile: cfg.approvedAppsFile },
    );
    console.log(`${entry.id} ${entry.decision}`);
    return;
  }
  const { server } = createReviewServer({ config: cfg, env });
  const addr = await listenReviewServer(server, {
    bind: env.AIPP_REVIEW_BIND || DEFAULT_BIND,
    port: +(env.AIPP_REVIEW_PORT || argv.find((a, i) => argv[i - 1] === '--port') || DEFAULT_PORT),
  });
  console.log(`Review server: http://127.0.0.1:${addr.port}/  (this computer only; nothing is published)`);
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  main().catch((err) => {
    const msg = err && err.message ? err.message : String(err);
    if (/\bhnk_[A-Za-z0-9]+/.test(msg) || /Bearer\s+\S+/.test(msg)) console.error('Review tool failed.');
    else console.error(msg);
    process.exit(1);
  });
}
