// JC-9: confirmation email DRAFTS for the submissions batch. Drafts only: this module builds text and writes local files.
// It never sends mail, calls a mail API, or creates mailbox drafts. A person (or the parent bot, through an approval card)
// sends a draft later. The recipient address appears ONLY inside the draft files, which live in a private folder
// outside the repo (or a gitignored one); never in the PR, public data, summaries or logs.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { FIELDS, PLATFORMS } from './submission-schema.mjs';
import { EMAIL_RE, frontOfficeReady } from './edit-requests.mjs';

const STORE = 'JC AiPP Store';
const clean = (s, max = 200) => String(s ?? '').replace(/[\u0000-\u0008\u000B-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
const oneLine = (s) => String(s).replace(/[\r\n]+/g, ' ').trim();
const label = (name) => (FIELDS.find((f) => f.name === name)?.label || name).replace(/\s*\(optional\)$/, '');
const platformNames = (p) => String(p || '').split(',').map((x) => PLATFORMS.find(([v]) => v === x.trim())?.[1]).filter(Boolean).join(', ');

// Scan hits are summarised as categories only, so a draft never repeats a secret or private value back.
const SCAN_CATEGORY = (hit) => /owner name|personal label|private term/.test(hit) ? 'a personal name or label'
  : /email address/.test(hit) ? 'an email address in a public field'
  : /here\.now|config|local file path|credential in URL/.test(hit) ? 'a private link or file path'
  : 'something that looks like a key, token or password';

// Same line whether or not the front-office address is set; while it is TBD the draft is marked hold (no Reply-To).
const REPLY_NOTE = 'Replies to this email thread are how changes and status updates are handled.';

/**
 * Build one draft. kind: accepted | rejected | blocked. Quarantined, honeypot, rate-limited and duplicate records get no draft.
 * Returns { kind, recordId, appId, to, replyTo, replyToStatus, subject, body } or { skipped: reason }.
 */
export function buildDraft(kind, { record, appId = null, reasons = [], frontOffice }) {
  const f = (record && typeof record.data === 'object' && record.data) ? record.data : (record || {});
  const to = oneLine(f.contact_email || '').toLowerCase();
  if (!EMAIL_RE.test(to)) return { skipped: 'no-valid-recipient', recordId: record?.id, kind };
  const ready = frontOfficeReady(frontOffice);
  const name = clean(f.dev_name, 60) || 'there';
  const app = clean(f.app_name, 40) || 'your app';
  const lines = [`Hi ${name},`, ''];
  let subject;
  if (kind === 'accepted') {
    subject = `${STORE}: we received ${app} (${appId})`;
    lines.push(
      `Thanks for submitting ${app} to ${STORE} Lite. Your app ID is ${appId}.`, '',
      'Summary of your listing:',
      `- App: ${app}`,
      `- Summary: ${clean(f.summary, 120)}`,
      `- Category: ${clean(f.category, 40)}`,
      `- Version: ${clean(f.version, 20)}`,
      `- Platforms: ${platformNames(f.platforms)}`,
      `- Source: ${clean(f.repo_url, 200)}`,
      ...(f.download_page_url ? [`- Download page: ${clean(f.download_page_url, 300)}`] : []),
      ...(f.open_web_url ? [`- Website: ${clean(f.open_web_url, 300)}`] : []),
      `- Under construction: ${f.under_construction ? 'yes' : 'no'}`, '',
      'Next steps:',
      `1. Add a file named jc-aipp-store.txt to the root of your repo containing your app ID: ${appId}`,
      '2. A person then reviews your listing. Nothing goes live until it is approved, and we will let you know in this thread.', '',
    );
  } else if (kind === 'rejected') {
    const fields = [...new Set(reasons.map((r) => r.split(':')[0].trim()))].map(label);
    subject = `${STORE}: your submission needs a few fixes (${app})`;
    lines.push(
      `Thanks for submitting ${app} to ${STORE} Lite. We couldn't accept it yet; please check these fields:`,
      ...fields.slice(0, 15).map((x) => `- ${x}`), '',
      'Next steps:',
      '1. Fix the fields above and submit the form again. You will get an app ID once the submission passes the checks.',
      '2. A person then reviews your listing before anything goes live.', '',
    );
  } else if (kind === 'blocked') {
    const cats = [...new Set(reasons.map((r) => SCAN_CATEGORY(r.split(': ').slice(1).join(': ') || r)))];
    subject = `${STORE}: we couldn't accept your submission (${app})`;
    lines.push(
      `Thanks for submitting ${app} to ${STORE} Lite. Our automatic checks found:`,
      ...cats.map((c) => `- ${c}`), '',
      'For your safety we have not repeated the details here.', '',
      'Next steps:',
      '1. Remove it from the listing (and from the app, if it is there too), then submit the form again.',
      '2. If you think this is a mistake, reply to this email and a person will take a look.', '',
    );
  } else return { skipped: 'no-draft-for-kind', recordId: record?.id, kind };
  lines.push(REPLY_NOTE);
  if (appId) lines.push(`Please keep ${appId} in the subject and write from this address (the email on file); edits from other addresses aren't accepted.`);
  lines.push('', `${STORE}`);
  return {
    kind, recordId: record?.id ?? null, appId, to,
    replyTo: ready ? frontOffice : null,
    replyToStatus: ready ? 'set' : 'hold: frontOfficeEmail is TBD; set it before sending so replies reach the front office',
    subject: oneLine(subject), body: lines.join('\n'),
  };
}

const encWord = (s) => (/^[\x20-\x7E]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`);
export function toEml(d) {
  const h = [`To: ${oneLine(d.to)}`];
  if (d.replyTo) h.push(`Reply-To: ${oneLine(d.replyTo)}`);
  h.push(`Subject: ${encWord(oneLine(d.subject))}`, 'X-JC-Draft: true (not sent; send only after approval)', `X-JC-Draft-Kind: ${d.kind}`);
  if (d.appId) h.push(`X-JC-App-ID: ${d.appId}`);
  if (!d.replyTo) h.push('X-JC-Draft-Status: hold-front-office-email-tbd');
  h.push('MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: 8bit');
  return `${h.join('\r\n')}\r\n\r\n${d.body.replace(/\r?\n/g, '\r\n')}\r\n`;
}

// Refuse to write drafts inside the repo unless that folder is gitignored.
export function assertPrivateDir(dir, repoRoot) {
  const abs = path.resolve(dir), rootAbs = path.resolve(repoRoot);
  if (abs !== rootAbs && !abs.startsWith(rootAbs + path.sep)) return; // outside the repo: fine
  let ignored = false;
  try { execFileSync('git', ['check-ignore', '-q', '--no-index', path.join(abs, 'probe.eml')], { cwd: rootAbs, stdio: 'ignore' }); ignored = true; } catch { ignored = false; }
  if (!ignored) throw new Error('Drafts folder is inside the repo and not gitignored; refusing to write recipient emails there.');
}

// Writes <name>.json + <name>.eml per draft (mode 0600). Returns [{file, kind, appId, recordId, replyToStatus}] with no addresses.
export function writeDrafts(dir, drafts, repoRoot) {
  assertPrivateDir(dir, repoRoot);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const out = [];
  for (const d of drafts) {
    const base = (d.appId || `${d.recordId}-${d.kind}`).replace(/[^A-Za-z0-9._-]/g, '_');
    fs.writeFileSync(path.join(dir, `${base}.json`), JSON.stringify({ ...d, sent: false, note: 'DRAFT. Not sent. Send only through an approval step.' }, null, 2) + '\n', { mode: 0o600 });
    fs.writeFileSync(path.join(dir, `${base}.eml`), toEml(d), { mode: 0o600 });
    out.push({ file: `${base}.eml`, kind: d.kind, appId: d.appId, recordId: d.recordId, replyToStatus: d.replyTo ? 'set' : 'hold-tbd' });
  }
  return out;
}
