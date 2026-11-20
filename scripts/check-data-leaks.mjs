#!/usr/bin/env node
// Validate data/apps.json and data/site.json, and scan them for private values
// or forbidden terms using the same leak rules as test.mjs. Never prints matched values.
import fs from 'node:fs';
import path from 'node:path';
import { SECRET_PATTERNS, hereNowAllowed, OWNER_NAME } from '../tools/scans.mjs';

const root = path.resolve(process.argv[2] || '.');
const rels = ['data/apps.json', 'data/site.json'];
let failed = 0;
const fail = (m) => { failed++; console.error(`  FAIL ${m}`); };

const parsed = {};
for (const rel of rels) {
  const fp = path.join(root, rel);
  if (!fs.existsSync(fp)) { fail(`${rel}: missing`); continue; }
  if (fs.lstatSync(fp).isSymbolicLink()) { fail(`${rel}: must not be a symlink`); continue; }
  let raw;
  try { raw = fs.readFileSync(fp, 'utf8'); } catch { fail(`${rel}: cannot read`); continue; }
  let data;
  try { data = JSON.parse(raw); } catch { fail(`${rel}: invalid JSON`); continue; }
  if (rel === 'data/apps.json' && !Array.isArray(data?.apps)) fail(`${rel}: must contain an "apps" array`);
  parsed[rel] = { raw, data };
}

const githubOwner = parsed['data/site.json']?.data?.githubOwner || '';

const localValues = [];
let privateTerms = [];
const localCfg = path.join(root, 'config.local.json');
if (fs.existsSync(localCfg) && !fs.lstatSync(localCfg).isSymbolicLink()) {
  try {
    const lc = JSON.parse(fs.readFileSync(localCfg, 'utf8'));
    if (lc.submissions) {
      delete lc.submissions.frontOfficeEmail; // public mailto target by design
      if (Array.isArray(lc.submissions.privateTerms)) privateTerms = lc.submissions.privateTerms;
    }
    const collect = (v) => typeof v === 'string' ? (v.length >= 6 && localValues.push(v)) : v && typeof v === 'object' && Object.values(v).forEach(collect);
    collect(lc);
  } catch { fail('config.local.json does not parse'); }
}

for (const rel of rels) {
  const item = parsed[rel];
  if (!item) continue;
  const { raw } = item;
  if (/\/workspace|\/home\//.test(raw)) fail(`${rel}: contains a local path (/workspace or /home/)`);

  const stripped = raw.replace(/https:\/\/gleaming-tangle-8ek4\.here\.now\/[^\s"'<>)]*/g, (m) => hereNowAllowed(m) ? '' : m);
  for (const [re, name] of SECRET_PATTERNS) {
    if (re.test(stripped)) fail(`${rel}: looks like a ${name}`);
  }
  for (const v of localValues) {
    if (v && stripped.includes(v)) fail(`${rel}: contains a config.local.json value`);
  }

  const withoutHandle = githubOwner ? raw.split(githubOwner).join('') : raw;
  if (new RegExp(OWNER_NAME, 'i').test(withoutHandle)) fail(`${rel}: mentions the owner's name`);
  if (/\((?:personal|private|family)\)/i.test(raw)) fail(`${rel}: personal label`);
  for (const term of privateTerms) {
    if (!term || String(term).length < 3) continue;
    const escaped = String(term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`\\b${escaped}\\b`, 'i').test(raw)) { fail(`${rel}: contains a private term`); break; }
  }
  if (/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(raw) && !/@example\./i.test(raw)) {
    fail(`${rel}: email address in public data`);
  }
}

if (failed) {
  console.error(`data leak check: ${failed} finding(s). Public data must not contain private values or forbidden terms.`);
  process.exit(1);
}
console.log('data leak check: data/apps.json and data/site.json are valid JSON and clean of private values.');
