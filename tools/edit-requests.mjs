// JC-8: "Request an edit" for app pages, and the check that accepts an edit only from the email on file.
//
// Page side (build.mjs): a mailto to config submissions.frontOfficeEmail that quotes the app's JCA ID.
// While the address is "TBD" (or not a valid address) no link is rendered; the page shows the app ID and a short
// "coming soon" note instead (plain text is more accessible than a fake disabled link, which can't be focused or explained).
//
// Processing side (verifyEditRequest): a later, human-approved inbox step passes in one parsed email; this module
// never reads an inbox, sends mail, or logs. Results carry the app ID and a reason code, never an email address.
import fs from 'node:fs';
import path from 'node:path';
import { COLLECTION } from './submission-schema.mjs';
import { hiddenInstructionHits } from './scans.mjs';

export const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
export const APP_ID_RE = /\bJCA-\d{4}\b/gi;

// The front-office address is PUBLIC by design (it is the mailto target). Order: FRONT_OFFICE_EMAIL env ->
// config.local.json submissions.frontOfficeEmail -> config.example.json -> "TBD".
export function resolveFrontOfficeEmail(root) {
  const read = (f) => { try { return JSON.parse(fs.readFileSync(path.join(root, f), 'utf8')); } catch { return {}; } };
  const v = process.env.FRONT_OFFICE_EMAIL || read('config.local.json').submissions?.frontOfficeEmail || read('config.example.json').submissions?.frontOfficeEmail || 'TBD';
  return String(v).trim();
}
export const frontOfficeReady = (email) => EMAIL_RE.test(String(email || ''));

export function editMail(app, email) {
  const subject = `Edit request: ${app.appId} (${app.name})`;
  const body = [
    `App ID: ${app.appId}`,
    `App: ${app.name}`,
    '',
    'What should change? (say which part: summary, About, What\'s new, version, links, screenshots...)',
    '',
    '',
    'New text or link:',
    '',
    '',
    'Please send this from the email address on file for this app and keep the app ID in the subject.',
    'Edit requests from any other address are not accepted.',
  ].join('\n');
  return { subject, body, href: `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}` };
}

// HTML panel for an app page. esc = the build's HTML escaper.
export function editRequestPanel(app, email, esc) {
  const id = `<span class="app-id">${esc(app.appId)}</span>`;
  const inner = frontOfficeReady(email)
    ? `<p>App ID: ${id}. <a class="edit-link" href="${esc(editMail(app, email).href)}">Request an edit<span class="visually-hidden"> to the ${esc(app.name)} page</span></a> (opens your email app).</p><p class="hint">Send it from the email address on file for this app; requests from other addresses aren't accepted.</p>`
    : `<p>App ID: ${id}. Edit requests by email are coming soon.</p>`;
  return `<section class="panel edit-request" aria-labelledby="edit-title" data-section="edit"><h2 id="edit-title">Request an edit</h2>${inner}</section>`;
}

// ---------- processing side
const addrOf = (from) => {
  const s = String(from || '').trim();
  const m = s.match(/<([^<>\s]+)>\s*$/);
  return (m ? m[1] : s).trim().toLowerCase();
};

// Sender authentication (P2-4a): only a DMARC pass ALIGNED with the From domain counts (SPF of the envelope alone does not).
// The inbox step must fill msg.auth = { dmarc: 'pass' | ..., aligned: true | false } from Authentication-Results.
export const senderAuthenticated = (msg) => msg?.auth?.dmarc === 'pass' && msg?.auth?.aligned === true;

/**
 * Decide whether one edit-request email is accepted.
 *   msg: { subject, body, from, auth: { dmarc, aligned } }
 *   emailOnFile: async (appId) => string | null    (use makeEmailOnFile: verified + ownership-proved apps only)
 * Returns { accepted, appId, reason, ban? }. reason: ok | no-app-id | several-app-ids | quarantine | unknown-app |
 *   sender-not-authenticated | sender-mismatch. `quarantine` (hidden instructions in the mail) means: ban the sender,
 *   pause the batch, alert the owner; never act on the text (P2-4b).
 * An accepted edit is still only a draft PR whose new values go through validateEdit() and the ownership check; only the owner merges.
 */
export async function verifyEditRequest(msg, { emailOnFile }) {
  const text = `${msg.subject || ''}\n${msg.body || ''}`;
  const uniq = [...new Set((text.match(APP_ID_RE) || []).map((x) => x.toUpperCase()))];
  if (hiddenInstructionHits(msg.subject).length || hiddenInstructionHits(msg.body).length) return { accepted: false, appId: uniq.length === 1 ? uniq[0] : null, reason: 'quarantine', ban: true };
  if (!uniq.length) return { accepted: false, appId: null, reason: 'no-app-id' };
  if (uniq.length > 1) return { accepted: false, appId: null, reason: 'several-app-ids' };
  const appId = uniq[0];
  if (!(msg.subject || '').toUpperCase().includes(appId)) return { accepted: false, appId, reason: 'no-app-id' }; // ID must be in the subject
  if (!senderAuthenticated(msg)) return { accepted: false, appId, reason: 'sender-not-authenticated' };
  let onFile = null;
  try { onFile = await emailOnFile(appId); } catch { onFile = null; }
  if (!onFile) return { accepted: false, appId, reason: 'unknown-app' };
  const sender = addrOf(msg.from);
  const ok = EMAIL_RE.test(sender) && sender === addrOf(onFile);
  return { accepted: ok, appId, reason: ok ? 'ok' : 'sender-mismatch' };
}

/**
 * P1-1 email verification: the reply to the confirmation mail. Same checks as an edit request, but against the RAW
 * address on file (not yet verified). On success the caller stores markEmailVerified(state, appId): a flag keyed by app ID.
 */
export async function verifyContactReply(msg, { rawEmailOnFile }) {
  const r = await verifyEditRequest(msg, { emailOnFile: rawEmailOnFile });
  return { verified: r.accepted, appId: r.appId, reason: r.reason, ...(r.ban ? { ban: true } : {}) };
}
export const markEmailVerified = (state, appId, now = new Date()) => ({ ...state, verified: { ...(state.verified || {}), [appId]: { emailVerified: true, at: now.toISOString() } } });
export const markOwnershipPassed = (state, appId, now = new Date()) => ({ ...state, ownership: { ...(state.ownership || {}), [appId]: { passed: true, at: now.toISOString() } } });

/**
 * Build the private email-on-file lookup.
 *  - Reserved IDs (the store owner's own apps): config.local.json submissions.reservedContacts (gitignored); owner-set, so trusted.
 *  - Submitted apps: only when state.verified[appId].emailVerified AND state.ownership[appId].passed (P1-1 / P2-2),
 *    unless requireVerified is false (used only by verifyContactReply). The address is read from the owner-only record.
 */
export function makeEmailOnFile({ reservedContacts = {}, state = {}, slug, apiKey, fetchImpl = globalThis.fetch, requireVerified = true }) {
  return async (appId) => {
    if (appId in reservedContacts) return EMAIL_RE.test(String(reservedContacts[appId]).trim()) ? String(reservedContacts[appId]).trim() : null; // placeholders count as no email on file
    if (requireVerified && !(state.verified?.[appId]?.emailVerified === true && state.ownership?.[appId]?.passed === true)) return null;
    const rec = state.records?.[appId];
    if (!rec || !slug || !apiKey) return null;
    const res = await fetchImpl(`https://here.now/api/v1/publishes/${encodeURIComponent(slug)}/data/${COLLECTION}/${encodeURIComponent(rec)}`, { headers: { authorization: `Bearer ${apiKey}` } });
    if (!res.ok) return null;
    const j = await res.json();
    const d = j.record?.data || j.record || {};
    return d.contact_email || null;
  };
}
