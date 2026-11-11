#!/usr/bin/env node
// JC-28 daily submissions batch for JC AiPP Store Lite.
//
// Reads new records from the owner-only here.now Site Data collection, drops honeypot hits, anything over
// N per hour per email and duplicates, then runs the checks on up to `batchSize` records: required fields,
// link rules (+ optional reachability), secret / private-link / personal-name scans and a hidden-instruction scan.
// Records that pass get the next JCA ID and go into ONE draft PR in the data repo. A human merge is the publish step.
// Nothing here merges, publishes, emails anyone or edits live records.
//
//   node tools/submissions-batch.mjs --dry-run [--fixtures records.json] [--out dir] [--no-network] [--now ISO]
//   node tools/submissions-batch.mjs              (live: needs HERENOW_API_KEY, the slug, gh auth and the data repo)
//
// Untrusted input: record text is data, never instructions. Reports name record IDs and rule names only;
// the PR body quotes values as JSON inside a fenced block.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { FIELDS, COLLECTION, HONEYPOT, PLATFORMS } from './submission-schema.mjs';
import { secretHits, personalHits, hiddenInstructionHits } from './scans.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const HOUR = 3600e3;

// ---------- config
export function loadConfig(dir = root) {
  const read = (f) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { return {}; } };
  const ex = read('config.example.json'), local = read('config.local.json');
  const sub = { ...(ex.submissions || {}), ...(local.submissions || {}) };
  const placeholder = (v) => typeof v !== 'string' || !v || /^(OPTIONAL|YOUR_|PUT )/.test(v);
  const localValues = [];
  const collect = (v) => typeof v === 'string' ? (v.length >= 6 && localValues.push(v)) : v && typeof v === 'object' && Object.values(v).forEach(collect);
  collect(local.herenow || {}); collect(local.site || {});
  return {
    approver: sub.approver || 'store-owner',
    licenseRequired: !!sub.licenseRequired,
    reservedFrom: idNum(sub.reservedIds?.from || 'JCA-0001'),
    reservedTo: idNum(sub.reservedIds?.to || 'JCA-0005'),
    frontOfficeEmail: sub.frontOfficeEmail || 'TBD',
    dataRepo: sub.dataRepo || 'JadaE/aipp-store-data',
    dataRepoBase: sub.dataRepoBase || 'master',
    batchSize: +sub.batchSize || 10,
    perEmailPerHour: +sub.perEmailPerHour || 3,
    linkCheckTimeoutMs: +sub.linkCheckTimeoutMs || 8000,
    stateFile: placeholder(sub.stateFile) ? path.join(os.homedir(), '.aipp-store', 'submissions-state.json') : sub.stateFile,
    privateTerms: (sub.privateTerms || []).filter((t) => !placeholder(t)),
    slug: process.env.HERENOW_SLUG || (placeholder(local.herenow?.slug) || /^your-/.test(local.herenow?.slug || '') ? '' : local.herenow.slug),
    apiKey: process.env.HERENOW_API_KEY || (placeholder(local.herenow?.apiKey) ? '' : local.herenow.apiKey),
    ownerHandle: (() => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'data/site.json'), 'utf8')).githubOwner; } catch { return ''; } })(),
    localValues,
  };
}

export const idNum = (id) => +String(id).replace(/^JCA-/i, '') || 0;
export const fmtId = (n) => `JCA-${String(n).padStart(4, '0')}`;
const normEmail = (e) => String(e || '').trim().toLowerCase();
const normRepo = (u) => String(u || '').trim().toLowerCase().replace(/\.git$/, '').replace(/\/+$/, '');
const ts = (r) => Date.parse(r.created_at || r.createdAt || 0) || 0;
// here.now returns either flat records or { id, data: {...}, created_at }.
export const fieldsOf = (r) => (r && typeof r.data === 'object' && r.data) ? r.data : r;

// ---------- state (outside the repo; never committed)
export function loadState(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return { processed: {}, lastId: 0 }; } }
function saveState(file, state) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(state, null, 2)); }

// ---------- stage 1: cheap filters over every new record (no network)
export function triage(records, { state = { processed: {} }, perEmailPerHour = 3, batchSize = 10, existingRepos = [] } = {}) {
  const all = [...records].sort((a, b) => ts(a) - ts(b) || String(a.id).localeCompare(String(b.id)));
  const fresh = all.filter((r) => !state.processed?.[r.id]);
  const dropped = [], kept = [];
  const seenRepos = new Set(existingRepos.map(normRepo));
  const seenNameEmail = new Set();
  for (const r of fresh) {
    const f = fieldsOf(r);
    if (f[HONEYPOT]) { dropped.push({ id: r.id, reason: 'honeypot' }); continue; }
    // Over the per-email limit: count every earlier record (any state) from the same email in the hour before this one.
    const email = normEmail(f.contact_email);
    if (email) {
      const prior = all.filter((o) => o !== r && normEmail(fieldsOf(o).contact_email) === email && ts(o) <= ts(r) && ts(r) - ts(o) < HOUR && (ts(o) < ts(r) || String(o.id) < String(r.id))).length;
      if (prior >= perEmailPerHour) { dropped.push({ id: r.id, reason: 'rate-limit' }); continue; }
    }
    const repo = normRepo(f.repo_url), ne = `${email}|${String(f.app_name || '').trim().toLowerCase()}`;
    if ((repo && seenRepos.has(repo)) || seenNameEmail.has(ne)) { dropped.push({ id: r.id, reason: 'duplicate' }); continue; }
    if (repo) seenRepos.add(repo); seenNameEmail.add(ne);
    kept.push(r);
  }
  return { dropped, toCheck: kept.slice(0, batchSize), deferred: kept.slice(batchSize).map((r) => r.id) };
}

// ---------- stage 2: checks on one record
const SHORTENERS = /^(?:bit\.ly|t\.co|tinyurl\.com|goo\.gl|ow\.ly|is\.gd|buff\.ly|rebrand\.ly|cutt\.ly|shorturl\.at|rb\.gy|t\.ly|tiny\.cc|lnkd\.in)$/i;
const URL_FIELDS = FIELDS.filter((f) => f.kind === 'url').map((f) => f.name);

export function linkProblems(name, value, f) {
  const out = [];
  let u; try { u = new URL(value); } catch { return [`${name}: not a valid URL`]; }
  if (u.protocol !== 'https:') out.push(`${name}: must be https`);
  if (u.username || u.password) out.push(`${name}: must not contain a login`);
  const h = u.hostname.toLowerCase();
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(':') || h === 'localhost' || !h.includes('.')) out.push(`${name}: must use a public domain, not an IP or local host`);
  if (SHORTENERS.test(h)) out.push(`${name}: link shorteners are not allowed`);
  if (/(^|\.)here\.now$/.test(h)) out.push(`${name}: here.now links need owner approval`);
  if (u.port && u.port !== '443') out.push(`${name}: no custom ports`);
  if (name !== 'icon_url' && !/^shot\d_url$/.test(name) && /\.apk$/i.test(u.pathname)) out.push(`${name}: link to the release page, never a direct .apk`);
  if (name === 'repo_url') {
    const m = u.pathname.match(/^\/([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)\/?$/);
    if (h !== 'github.com' || !m) out.push('repo_url: must be https://github.com/<handle>/<repo>');
    else if (f.github_handle && m[1].toLowerCase() !== String(f.github_handle).toLowerCase()) out.push('repo_url: GitHub owner must match github_handle');
  }
  if (name === 'ios_app_store_url' && h !== 'apps.apple.com') out.push('ios_app_store_url: must be an apps.apple.com link');
  if ((name === 'icon_url' || /^shot\d_url$/.test(name)) && !/\.(png|svg|webp|jpe?g)$/i.test(u.pathname)) out.push(`${name}: must be a PNG, SVG, WebP or JPEG file`);
  return out;
}

export function checkRecord(r, cfg) {
  const f = fieldsOf(r);
  const problems = [], scans = [], hidden = [];
  for (const d of FIELDS) {
    if (d.kind === 'honeypot') continue;
    const v = f[d.name];
    if (d.kind === 'checkbox') { if (d.required && v !== true) problems.push(`${d.name}: must be ticked`); continue; }
    if (v != null && typeof v !== 'string') { problems.push(`${d.name}: must be text`); continue; }
    const s = (v || '').trim();
    if (!s) { if (d.required) problems.push(`${d.name}: required`); continue; }
    if (s.length > d.maxLength) problems.push(`${d.name}: over ${d.maxLength} characters`);
    if (d.minLength && s.length < d.minLength) problems.push(`${d.name}: under ${d.minLength} characters`);
    if (d.pattern && !new RegExp(d.pattern).test(s)) problems.push(`${d.name}: wrong format`);
    if (d.kind === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s)) problems.push(`${d.name}: not an email address`);
    if (d.kind === 'select' && !d.options.some(([o]) => o === s)) problems.push(`${d.name}: not one of the listed options`);
    if (URL_FIELDS.includes(d.name)) problems.push(...linkProblems(d.name, s, f));
    if (d.pairsWith && !String(f[d.pairsWith] || '').trim()) problems.push(`${d.name}: alt text without a screenshot URL`);
    if (/^shot\d_url$/.test(d.name) && !String(f[d.name.replace('_url', '_alt')] || '').trim()) problems.push(`${d.name.replace('_url', '_alt')}: required with a screenshot`);
    // Scans: every field for secrets and hidden instructions; public fields also for personal names and emails.
    for (const hit of secretHits(s, { localValues: cfg.localValues })) scans.push(`${d.name}: ${hit}`);
    if (!d.private) for (const hit of personalHits(s, { privateTerms: cfg.privateTerms })) scans.push(`${d.name}: ${hit}`);
    for (const hit of hiddenInstructionHits(s, { isUrl: d.kind === 'url' })) hidden.push(`${d.name}: ${hit}`);
  }
  // Unknown keys are ignored for the listing, but are scanned so nothing hides in them.
  for (const [k, v] of Object.entries(f)) if (!FIELDS.some((d) => d.name === k) && !['id', 'created_at', 'updated_at', 'form_version', 'site_slug', 'collection', 'status', 'created_by_account_id', 'data'].includes(k) && typeof v === 'string') {
    for (const hit of hiddenInstructionHits(v)) hidden.push(`(extra field): ${hit}`);
  }
  const plats = String(f.platforms || '').split(',').map((p) => p.trim()).filter(Boolean);
  if (!plats.length || plats.some((p) => !PLATFORMS.some(([v]) => v === p))) problems.push('platforms: choose from android, web, ios');
  if (plats.includes('android') && !f.download_page_url) problems.push('download_page_url: required for Android apps');
  if (f.open_web_url && !plats.includes('web')) problems.push('open_web_url: only for apps with a web version');
  if (String(f.about || '').split(/\n\s*\n/).filter((p) => p.trim()).length > 3) problems.push('about: more than 3 paragraphs');
  const bullets = String(f.whats_new || '').split('\n').map((l) => l.replace(/^\s*[-*•]\s*/, '').trim()).filter(Boolean);
  if (bullets.length > 5) problems.push('whats_new: more than 5 bullets');
  if (cfg.licenseRequired && !f.license) problems.push('license: required');
  const shots = [1, 2, 3, 4, 5, 6].filter((n) => f[`shot${n}_url`]).length;
  if (shots < 2) problems.push('screenshots: at least 2 needed');
  return { problems: [...new Set(problems)], scans: [...new Set(scans)], hidden: [...new Set(hidden)] };
}

// Optional reachability check (HEAD, then GET). Off with --no-network.
export async function reachability(f, { fetchImpl = globalThis.fetch, timeoutMs = 8000 } = {}) {
  const out = [];
  for (const k of URL_FIELDS) {
    if (!f[k]) continue;
    try {
      const go = (method) => fetchImpl(f[k], { method, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs), headers: { 'user-agent': 'jc-aipp-store-batch' } });
      let res = await go('HEAD');
      if (res.status === 405 || res.status === 403) res = await go('GET');
      if (res.status >= 400) out.push(`${k}: returned HTTP ${res.status}`);
      else if (res.url && /\.apk$/i.test(new URL(res.url).pathname) && k === 'download_page_url') out.push(`${k}: redirects to a direct .apk`);
    } catch { out.push(`${k}: could not be reached`); }
  }
  return out;
}

// ---------- listing (public fields only; no email, no honeypot)
export function toListing(r, appId, cfg, now) {
  const f = fieldsOf(r);
  const repo = new URL(f.repo_url).pathname.replace(/^\/|\/$/g, '').split('/');
  const slug = String(f.app_name).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || appId.toLowerCase();
  const plats = String(f.platforms).split(',').map((p) => p.trim()).filter(Boolean);
  const notes = Object.fromEntries([['android', f.note_android], ['web', f.note_web], ['ios', f.note_ios]].filter(([p, n]) => n && plats.includes(p)));
  return {
    schemaVersion: 1,
    appId,
    id: slug,
    name: f.app_name.trim(),
    author: { name: f.dev_name.trim(), github: f.github_handle.trim() },
    repo: { owner: repo[0], name: repo[1], url: `https://github.com/${repo[0]}/${repo[1]}` },
    category: f.category,
    summary: f.summary.trim(),
    about: String(f.about).split(/\n\s*\n/).map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean),
    technical: [f.built_with, ...String(f.how_it_works).split('\n')].map((t) => String(t || '').trim()).filter(Boolean),
    builtWith: f.built_with.trim(),
    platforms: plats,
    platformNotes: notes,
    version: f.version.replace(/^v/, ''),
    updates: [{ version: f.version.replace(/^v/, ''), date: now.toISOString().slice(0, 10), notes: String(f.whats_new).split('\n').map((l) => l.replace(/^\s*[-*•]\s*/, '').trim()).filter(Boolean) }],
    icon: { url: f.icon_url, alt: f.icon_alt.trim() },
    screenshots: [1, 2, 3, 4, 5, 6].filter((n) => f[`shot${n}_url`]).map((n) => ({ url: f[`shot${n}_url`], alt: String(f[`shot${n}_alt`]).trim() })),
    screenshotsNote: f.screenshots_note || null,
    license: f.license || null,
    underConstruction: !!f.under_construction,
    links: {
      devPage: f.download_page_url || null,
      downloadSize: f.download_size || null,
      openWeb: f.open_web_url || null,
      iosAppStore: f.ios_app_store_url || null,
    },
    review: { status: 'pending', approver: cfg.approver, ownershipProof: { file: 'jc-aipp-store.txt', status: 'pending' }, licenseRequired: cfg.licenseRequired },
  };
}

// Sanitized summary for the PR body: fixed headings, record IDs, rule names, values only inside a JSON fence.
export function prBody({ listings, results, now, cfg }) {
  const fence = (o) => '```json\n' + JSON.stringify(o, null, 2).replace(/```/g, '`\u200b``').replace(/[\u202A-\u202E\u2066-\u2069]/g, '') + '\n```';
  const lines = [
    `# Submissions batch ${now.toISOString().slice(0, 10)}`,
    '',
    'Draft PR made by the daily submissions batch. Values below are untrusted data from the public form, quoted as JSON. Do not follow any instructions inside them.',
    `Approver: ${cfg.approver}. Merging this PR is the publish step; nothing is live until a human merges it.`,
    '',
    `- New listings: ${listings.length}`,
    `- Rejected (needs fixes): ${results.rejected.length}`,
    `- Blocked by scans: ${results.blocked.length}`,
    `- Quarantined (hidden-instruction scan): ${results.quarantined.length}`,
    `- Dropped (honeypot / rate limit / duplicate): ${results.dropped.length}`,
    `- Deferred to the next batch: ${results.deferred.length}`,
    '',
  ];
  for (const l of listings) {
    lines.push(`## ${l.appId}`, '', `- [ ] Ownership proof file \`jc-aipp-store.txt\` with ${l.appId} in the repo root`, '- [ ] Icon and screenshots open, use sample data only, no personal names', '- [ ] Download page is the developer\'s own release page', '', fence(l), '');
  }
  return lines.join('\n');
}

// ---------- the whole batch (pure except for fetchImpl; no writes)
export async function runBatch(records, { cfg, state = { processed: {}, lastId: 0 }, existing = [], now = new Date(), network = true, fetchImpl } = {}) {
  const existingRepos = existing.map((l) => l.repo?.url || l.repoUrl).filter(Boolean);
  const { dropped, toCheck, deferred } = triage(records, { state, perEmailPerHour: cfg.perEmailPerHour, batchSize: cfg.batchSize, existingRepos });
  const used = new Set(existing.map((l) => idNum(l.appId)).filter(Boolean));
  let next = Math.max(cfg.reservedTo + 1, (state.lastId || 0) + 1, ...[...used].map((n) => n + 1));
  const results = { dropped, deferred, rejected: [], blocked: [], quarantined: [], accepted: [] };
  const listings = [];
  for (const r of toCheck) {
    const c = checkRecord(r, cfg);
    if (c.hidden.length) { results.quarantined.push({ id: r.id, rules: [...new Set(c.hidden.map((h) => h.split(': ').pop()))] }); continue; }
    if (c.scans.length) { results.blocked.push({ id: r.id, reasons: c.scans }); continue; }
    if (!c.problems.length && network) c.problems.push(...await reachability(fieldsOf(r), { fetchImpl, timeoutMs: cfg.linkCheckTimeoutMs }));
    if (c.problems.length) { results.rejected.push({ id: r.id, reasons: c.problems }); continue; }
    while (used.has(next) || (next >= cfg.reservedFrom && next <= cfg.reservedTo)) next++;
    const appId = fmtId(next); used.add(next); next++;
    listings.push(toListing(r, appId, cfg, now));
    results.accepted.push({ id: r.id, appId });
  }
  const newState = { ...state, processed: { ...(state.processed || {}) }, lastId: Math.max(state.lastId || 0, ...results.accepted.map((a) => idNum(a.appId))) };
  for (const d of dropped) newState.processed[d.id] = { result: d.reason, at: now.toISOString() };
  for (const k of ['rejected', 'blocked', 'quarantined']) for (const x of results[k]) newState.processed[x.id] = { result: k, at: now.toISOString() };
  for (const a of results.accepted) newState.processed[a.id] = { result: 'accepted', appId: a.appId, at: now.toISOString() };
  // App ID -> Site Data record ID (state file only), so JC-8/JC-9 can look up the email on file in Site Data. No emails stored here.
  newState.records = { ...(state.records || {}) };
  for (const a of results.accepted) newState.records[a.appId] = a.id;
  return { results, listings, body: prBody({ listings, results, now, cfg }), newState };
}

// ---------- I/O for the CLI
async function fetchRecords(cfg) {
  if (!cfg.apiKey || !cfg.slug) throw new Error('Live mode needs HERENOW_API_KEY and the site slug (env or config.local.json).');
  const out = []; let cursor = '';
  for (let page = 0; page < 50; page++) {
    const u = `https://here.now/api/v1/publishes/${encodeURIComponent(cfg.slug)}/data/${COLLECTION}?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const res = await fetch(u, { headers: { authorization: `Bearer ${cfg.apiKey}` } });
    if (res.status === 404) throw new Error(`Site Data collection "${COLLECTION}" not found on the site (its manifest has not been published yet). Nothing was changed.`);
    if (!res.ok) throw new Error(`Site Data list failed: HTTP ${res.status}`);
    const j = await res.json(); out.push(...(j.records || [])); cursor = j.nextCursor; if (!cursor) break;
  }
  return out;
}

function gh(args, opts = {}) { return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }); }

function existingFromRepo(dir) {
  const d = path.join(dir, 'listings');
  if (!fs.existsSync(d)) return [];
  return fs.readdirSync(d).filter((n) => /^JCA-\d{4}\.json$/.test(n)).map((n) => { try { return JSON.parse(fs.readFileSync(path.join(d, n), 'utf8')); } catch { return { appId: n.slice(0, 8) }; } });
}

function writeOut(dir, listings, body, summary) {
  fs.mkdirSync(path.join(dir, 'listings'), { recursive: true });
  for (const l of listings) fs.writeFileSync(path.join(dir, 'listings', `${l.appId}.json`), JSON.stringify(l, null, 2) + '\n');
  fs.writeFileSync(path.join(dir, 'PR_BODY.md'), body);
  fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
}

async function main(argv) {
  const has = (f) => argv.includes(f);
  const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
  const dry = has('--dry-run') || has('-n');
  const cfg = loadConfig();
  const now = val('--now') ? new Date(val('--now')) : new Date();
  const state = val('--state') ? loadState(val('--state')) : loadState(cfg.stateFile);
  const records = val('--fixtures') ? JSON.parse(fs.readFileSync(val('--fixtures'), 'utf8')).records : await fetchRecords(cfg);

  let repoDir = null, existing = [];
  if (!dry) {
    try { gh(['repo', 'view', cfg.dataRepo, '--json', 'name']); }
    catch { throw new Error(`Data repo ${cfg.dataRepo} not found or not accessible. Nothing was changed. (It must be created and approved first.)`); }
    repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aipp-store-data-'));
    gh(['repo', 'clone', cfg.dataRepo, repoDir, '--', '--depth=1', '--branch', cfg.dataRepoBase]);
    existing = existingFromRepo(repoDir);
  } else if (val('--existing')) existing = JSON.parse(fs.readFileSync(val('--existing'), 'utf8'));
  // The store's own apps count as existing listings, so their repos can't be submitted again.
  try { const own = JSON.parse(fs.readFileSync(path.join(root, 'data/apps.json'), 'utf8')).apps; existing = [...existing, ...own.map((a) => ({ repo: { url: `https://github.com/${cfg.ownerHandle}/${a.repo}` } }))]; } catch {}

  const { results, listings, body, newState } = await runBatch(records, { cfg, state, existing, now, network: !has('--no-network') });
  const summary = {
    mode: dry ? 'dry-run' : 'live', at: now.toISOString(), read: records.length,
    accepted: results.accepted, rejected: results.rejected.map((x) => ({ id: x.id, count: x.reasons.length, reasons: x.reasons })),
    blocked: results.blocked.map((x) => ({ id: x.id, reasons: x.reasons })),
    quarantined: results.quarantined, // P0 alert: record ID + rule names only
    dropped: results.dropped, deferred: results.deferred,
  };
  const outDir = val('--out') || (dry ? fs.mkdtempSync(path.join(os.tmpdir(), 'aipp-batch-dry-')) : null);

  if (dry) {
    writeOut(outDir, listings, body, summary);
    summary.wouldOpenDraftPr = listings.length ? { repo: cfg.dataRepo, base: cfg.dataRepoBase, branch: `submissions/${now.toISOString().slice(0, 10)}`, files: listings.map((l) => `listings/${l.appId}.json`) } : null;
    summary.outDir = outDir;
    console.log(JSON.stringify(summary, null, 2));
    return 0;
  }

  if (listings.length) {
    const branch = `submissions/${now.toISOString().slice(0, 10)}-${now.getTime().toString(36)}`;
    const git = (...a) => execFileSync('git', a, { cwd: repoDir, stdio: ['ignore', 'pipe', 'pipe'] });
    git('checkout', '-b', branch);
    writeOut(repoDir, listings, body, {});
    fs.rmSync(path.join(repoDir, 'PR_BODY.md')); fs.rmSync(path.join(repoDir, 'summary.json'));
    git('add', 'listings');
    git('-c', 'user.name=JC AiPP Store batch', '-c', 'user.email=noreply@users.noreply.github.com', 'commit', '-m', `Submissions batch ${now.toISOString().slice(0, 10)}: ${listings.map((l) => l.appId).join(', ')}`);
    git('push', '-u', 'origin', branch);
    const bodyFile = path.join(os.tmpdir(), `aipp-pr-body-${process.pid}.md`); fs.writeFileSync(bodyFile, body);
    summary.pr = gh(['pr', 'create', '--draft', '--repo', cfg.dataRepo, '--base', cfg.dataRepoBase, '--head', branch, '--title', `Submissions batch ${now.toISOString().slice(0, 10)} (${listings.length})`, '--body-file', bodyFile]).trim();
    fs.rmSync(bodyFile);
  }
  saveState(cfg.stateFile, newState);
  console.log(JSON.stringify(summary, null, 2));
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then((c) => process.exit(c), (e) => { console.error(`batch error: ${e.message}`); process.exit(1); });
}
