// JC-9: confirmation email DRAFTS for the submissions batch. Drafts only: this module builds text and writes local files.
// It never sends mail, calls a mail API, or creates mailbox drafts. A person (or the parent bot, through an approval card)
// sends a draft later. The recipient address appears ONLY inside the draft files, which live in a private folder
// outside the repo (or a gitignored one); never in the PR, public data, summaries or logs.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import { EMAIL_RE, frontOfficeReady } from './edit-requests.mjs';

const STORE = 'JC AiPP Store';
const oneLine = (s) => String(s).replace(/[\r\n]+/g, ' ').trim();
export const APP_ID_FORMAT = /^JCA-\d{4}$/;

// Same line whether or not the front-office address is set; while it is TBD the draft is marked hold (no Reply-To).
const REPLY_NOTE = 'Replies to this email thread are how changes and status updates are handled.';

/**
 * Build one draft. Security Lead P1-1: the recipient address is UNVERIFIED, so a draft holds only fixed store text and the
 * JCA ID: no submitted name, app name, summary or links (otherwise the store could relay phishing text to anyone).
 * Only "accepted" gets a draft; rejected/blocked/quarantined records get none.
 * Returns { kind, recordId, appId, to, replyTo, replyToStatus, subject, body } or { skipped: reason }.
 */
export function buildDraft(kind, { record, appId = null, frontOffice }) {
  if (kind !== 'accepted') return { skipped: 'not-sendable-unverified', recordId: record?.id, kind };
  if (!APP_ID_FORMAT.test(String(appId))) return { skipped: 'bad-app-id', recordId: record?.id, kind };
  const f = (record && typeof record.data === 'object' && record.data) ? record.data : (record || {});
  const to = oneLine(f.contact_email || '').toLowerCase();
  if (!EMAIL_RE.test(to)) return { skipped: 'no-valid-recipient', recordId: record?.id, kind };
  const ready = frontOfficeReady(frontOffice);
  const body = [
    'Hi,', '',
    `Thanks for submitting an app to ${STORE} Lite. Your app ID is ${appId}.`, '',
    'Next steps:',
    `1. Confirm this email address: reply to this email from this same address and keep ${appId} in the subject. Until you do, we can't accept edit requests for this app.`,
    `2. Add a file named jc-aipp-store.txt to the root of your repo containing your app ID: ${appId}`,
    '3. A person then reviews your listing. Nothing goes live until it is approved.', '',
    REPLY_NOTE,
    `Please keep ${appId} in the subject and write from this address (the email on file); edits from other addresses aren't accepted.`, '',
    'If you did not submit an app, you can ignore this email.', '',
    STORE,
  ].join('\n');
  return {
    kind, recordId: record?.id ?? null, appId, to,
    replyTo: ready ? frontOffice : null,
    replyToStatus: ready ? 'set' : 'hold: frontOfficeEmail is TBD; set it before sending so replies reach the front office',
    subject: `${STORE}: submission ${appId}`, body,
  };
}

const encWord = (s) => (/^[\x20-\x7E]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`);
export function toEml(d) {
  const h = [`To: ${oneLine(d.to)}`];
  if (d.replyTo) h.push(`Reply-To: ${oneLine(d.replyTo)}`);
  h.push(`Subject: ${encWord(oneLine(d.subject))}`, 'X-JC-Draft: true (not sent; send only after approval)', `X-JC-Draft-Kind: ${d.kind}`);
  if (d.appId) h.push(`X-JC-App-ID: ${d.appId}`);
  if (!d.replyTo) h.push('X-JC-Draft-Status: hold-front-office-email-tbd');
  if (d.sendable === false) h.push('X-JC-Draft-Sendable: no (held; see the .json)');
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

// Writes <name>.json + <name>.eml per draft (mode 0600). P1-1 caps: at most cfg.maxSendableDraftsPerDay sendable drafts per
// day and 1 per recipient per cfg.perRecipientDays days, tracked in a ledger of recipient HASHES (state.draftLedger).
// A draft is sendable only if the owner switch sendDraftsApproved is ON, Reply-To is set and it is under both caps.
// Even then every send is a separate approval card; nothing here sends.
export function writeDrafts(dir, drafts, repoRoot, { state = {}, now = new Date(), cfg = {} } = {}) {
  assertPrivateDir(dir, repoRoot);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const perDay = cfg.maxSendableDraftsPerDay ?? 10, perRecipientDays = cfg.perRecipientDays ?? 30;
  const ledger = [...(state.draftLedger || [])].filter((e) => now - Date.parse(e.at) < perRecipientDays * 864e5);
  const today = now.toISOString().slice(0, 10);
  const files = [];
  for (const d of drafts) {
    const h = crypto.createHash('sha256').update(d.to).digest('hex');
    const hold = [];
    if (cfg.sendDraftsApproved !== true) hold.push('owner switch sendDraftsApproved is OFF');
    if (!d.replyTo) hold.push('frontOfficeEmail is TBD');
    if (ledger.filter((e) => e.at.slice(0, 10) === today && e.sendable).length >= perDay) hold.push(`daily cap of ${perDay} sendable drafts reached`);
    if (ledger.some((e) => e.h === h)) hold.push(`recipient already had a draft in the last ${perRecipientDays} days`);
    const sendable = hold.length === 0;
    ledger.push({ h, at: now.toISOString(), appId: d.appId, sendable });
    const base = String(d.appId).replace(/[^A-Za-z0-9._-]/g, '_');
    const meta = { ...d, sent: false, sendable, hold, approval: 'Send only through a per-draft approval card from the store owner. No bulk approve.' };
    fs.writeFileSync(path.join(dir, `${base}.json`), JSON.stringify(meta, null, 2) + '\n', { mode: 0o600 });
    fs.writeFileSync(path.join(dir, `${base}.eml`), toEml({ ...d, sendable }), { mode: 0o600 });
    files.push({ file: `${base}.eml`, kind: d.kind, appId: d.appId, sendable, hold });
  }
  return { files, ledger };
}
