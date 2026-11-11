#!/usr/bin/env node
// Retention cleanup (Security Lead P1-3 item 4, P2-5). NOT part of the daily routine.
//   Plan (default, deletes nothing):  node tools/submissions-cleanup.mjs
//   Apply:                            node tools/submissions-cleanup.mjs --apply
// --apply works only when the owner switch submissions.cleanupDeletesApproved is true (default OFF), and each run needs the
// owner's OK until they pre-approve it. Deletes:
//   - Site Data records processed as honeypot / rate-limit / duplicate / banned / rejected / bad-metadata, older than cleanupJunkDays (7)
//   - any processed Site Data record older than retentionDays (90)
//   - local confirmation drafts older than draftRetentionDays (30)
// Output: counts and record IDs only.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { COLLECTION } from './submission-schema.mjs';
import { loadConfig, loadState, RECORD_ID_RE } from './submissions-batch.mjs';

const JUNK = new Set(['honeypot', 'rate-limit', 'duplicate', 'banned', 'rejected', 'bad-metadata', 'duplicate-of-pending']);
const DAY = 864e5;

export function planCleanup(state, { now = new Date(), cfg }) {
  const del = [];
  for (const [id, p] of Object.entries(state.processed || {})) {
    if (!RECORD_ID_RE.test(id)) continue;
    const age = (now - Date.parse(p.at)) / DAY;
    if ((JUNK.has(p.result) && age > cfg.cleanupJunkDays) || age > cfg.retentionDays) del.push(id);
  }
  return del;
}
export function planDraftCleanup(dir, { now = new Date(), cfg }) {
  if (!dir || !fs.existsSync(dir)) return [];
  const out = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(eml|json)$/.test(e.name) && (now - fs.statSync(p).mtimeMs) / DAY > cfg.draftRetentionDays) out.push(p); } };
  walk(dir); return out;
}
export async function applyCleanup(ids, { cfg, fetchImpl = globalThis.fetch }) {
  if (cfg.cleanupDeletesApproved !== true) throw new Error('Cleanup deletes are OFF (submissions.cleanupDeletesApproved). Nothing was deleted.');
  if (!cfg.apiKey || !cfg.slug) throw new Error('Needs HERENOW_API_KEY and the site slug.');
  const done = [];
  for (const id of ids) {
    const res = await fetchImpl(`https://here.now/api/v1/publishes/${encodeURIComponent(cfg.slug)}/data/${COLLECTION}/${encodeURIComponent(id)}`, { method: 'DELETE', headers: { authorization: `Bearer ${cfg.apiKey}` } });
    if (res.ok || res.status === 404) done.push(id);
  }
  return done;
}

async function main(argv) {
  const cfg = loadConfig();
  const stateFile = argv.includes('--state') ? argv[argv.indexOf('--state') + 1] : cfg.stateFile;
  const state = loadState(stateFile);
  const now = new Date();
  const ids = planCleanup(state, { now, cfg });
  const drafts = planDraftCleanup(cfg.draftsDir, { now, cfg });
  if (!argv.includes('--apply')) { console.log(JSON.stringify({ mode: 'plan', records: ids.length, sample: ids.slice(0, 20), drafts: drafts.length, switch: cfg.cleanupDeletesApproved ? 'ON' : 'OFF' }, null, 2)); return 0; }
  const done = await applyCleanup(ids, { cfg });
  for (const f of drafts) fs.rmSync(f, { force: true });
  console.log(JSON.stringify({ mode: 'apply', deletedRecords: done.length, deletedDrafts: drafts.length }, null, 2));
  return 0;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main(process.argv.slice(2)).then((c) => process.exit(c), (e) => { console.error(`cleanup error: ${e.message}`); process.exit(1); });
