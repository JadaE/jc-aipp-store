#!/usr/bin/env node
// Data-repo CI check (Security Lead P1-2 item 6, P2-2). Re-scans every listings/*.json in aipp-store-data, so an edited
// PR or a human paste gets the same checks as the batch, and verifies repo ownership with `gh api`:
//   owner.login == author.github (case-insensitive), fork == false (else "fork-needs-review"; reject if its parent is listed),
//   and jc-aipp-store.txt on the default branch contains exactly the app ID.
// Usage (in the data repo's CI, with this store repo checked out at ./store):
//   node store/tools/check-listings.mjs listings [--no-network]
// Exit 1 on any failure. Output names files, app IDs and rule names only; never listing text.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { hiddenInstructionHits, secretHits, personalHits } from './scans.mjs';
import { linkProblems } from './submissions-batch.mjs';

const APP_ID = /^JCA-\d{4}$/;
const strings = (v, out = []) => { if (typeof v === 'string') out.push(v); else if (v && typeof v === 'object') Object.values(v).forEach((x) => strings(x, out)); return out; };
const ghDefault = (args) => JSON.parse(execFileSync('gh', ['api', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));

export async function checkListing(l, { file = '', listedRepos = new Set(), network = true, ghImpl = ghDefault } = {}) {
  const errs = [], flags = [];
  if (l?.schemaVersion !== 1) errs.push('schemaVersion must be 1');
  if (!APP_ID.test(String(l?.appId))) errs.push('appId must match JCA-0000');
  if (file && path.basename(file) !== `${l?.appId}.json`) errs.push('file name must be <appId>.json');
  const all = strings(l);
  for (const t of all) {
    for (const h of hiddenInstructionHits(t, { isUrl: /^https:\/\//.test(t) && !/\s/.test(t) })) errs.push(`hidden-instruction: ${h}`);
    for (const h of secretHits(t)) errs.push(`secret: ${h}`);
    for (const h of personalHits(t)) errs.push(`personal: ${h}`);
  }
  const urls = { repo_url: l?.repo?.url, icon_url: l?.icon?.url, download_page_url: l?.links?.devPage, open_web_url: l?.links?.openWeb, ios_app_store_url: l?.links?.iosAppStore };
  (l?.screenshots || []).forEach((s, i) => { urls[`shot${i + 1}_url`] = s?.url; });
  for (const [k, u] of Object.entries(urls)) if (u) errs.push(...linkProblems(k, u, { github_handle: l?.author?.github }).map((p) => `link: ${p}`));
  if (network && l?.repo?.owner && l?.repo?.name) {
    try {
      const r = ghImpl([`repos/${l.repo.owner}/${l.repo.name}`]);
      if (String(r.owner?.login).toLowerCase() !== String(l.author?.github).toLowerCase()) errs.push('ownership: repo owner does not match author.github');
      if (r.fork) {
        flags.push('fork-needs-review');
        const parent = String(r.parent?.html_url || '').toLowerCase();
        if (parent && listedRepos.has(parent)) errs.push('ownership: fork of an already-listed repo');
      }
      const c = ghImpl([`repos/${l.repo.owner}/${l.repo.name}/contents/jc-aipp-store.txt`]);
      const txt = Buffer.from(String(c.content || ''), 'base64').toString('utf8').trim();
      if (txt !== l.appId) errs.push('ownership: jc-aipp-store.txt must contain exactly the app ID');
    } catch { errs.push('ownership: repo or jc-aipp-store.txt not readable'); }
  }
  return { ok: !errs.length, errors: [...new Set(errs)], flags };
}

async function main(argv) {
  const dir = argv.find((a) => !a.startsWith('--')) || 'listings';
  const network = !argv.includes('--no-network');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')) : [];
  const listings = files.map((f) => { try { return [f, JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))]; } catch { return [f, null]; } });
  const listedRepos = new Set(listings.map(([, l]) => String(l?.repo?.url || '').toLowerCase()).filter(Boolean));
  let bad = 0;
  for (const [f, l] of listings) {
    if (!l) { bad++; console.log(`FAIL ${f}: not valid JSON`); continue; }
    const r = await checkListing(l, { file: f, listedRepos, network });
    if (!r.ok) bad++;
    console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${f}${r.errors.length ? `: ${r.errors.join('; ')}` : ''}${r.flags.length ? ` [${r.flags.join(', ')}]` : ''}`);
  }
  console.log(`${files.length} listing(s), ${bad} failed`);
  return bad ? 1 : 0;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main(process.argv.slice(2)).then((c) => process.exit(c));
