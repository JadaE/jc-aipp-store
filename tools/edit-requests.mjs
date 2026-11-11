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

/**
 * Decide whether one edit-request email is accepted.
 *   msg: { subject, body, from, senderAuthenticated }   senderAuthenticated = the inbox step's SPF/DKIM/DMARC pass for From
 *   emailOnFile: async (appId) => string | null          looks up the private contact email (never logged)
 * Returns { accepted, appId, reason }. reason: ok | no-app-id | several-app-ids | unknown-app | sender-not-authenticated | sender-mismatch
 */
export async function verifyEditRequest(msg, { emailOnFile }) {
  const ids = [...new Set(`${msg.subject || ''}\n${msg.body || ''}`.match(APP_ID_RE) || [])].map((x) => x.toUpperCase());
  const uniq = [...new Set(ids)];
  if (!uniq.length) return { accepted: false, appId: null, reason: 'no-app-id' };
  if (uniq.length > 1) return { accepted: false, appId: null, reason: 'several-app-ids' };
  const appId = uniq[0];
  if (!(msg.subject || '').toUpperCase().includes(appId)) return { accepted: false, appId, reason: 'no-app-id' }; // ID must be in the subject
  if (msg.senderAuthenticated !== true) return { accepted: false, appId, reason: 'sender-not-authenticated' };
  let onFile = null;
  try { onFile = await emailOnFile(appId); } catch { onFile = null; }
  if (!onFile) return { accepted: false, appId, reason: 'unknown-app' };
  const sender = addrOf(msg.from);
  const ok = EMAIL_RE.test(sender) && sender === addrOf(onFile);
  return { accepted: ok, appId, reason: ok ? 'ok' : 'sender-mismatch' };
}

/**
 * Build the private email-on-file lookup.
 *  - Reserved IDs (the store owner's own apps): config.local.json submissions.reservedContacts { "JCA-0001": "..." } (gitignored).
 *  - Submitted apps: batch state file maps appId -> Site Data record ID; the email is read from that record with the owner API.
 */
export function makeEmailOnFile({ reservedContacts = {}, state = {}, slug, apiKey, fetchImpl = globalThis.fetch }) {
  return async (appId) => {
    if (appId in reservedContacts) return EMAIL_RE.test(String(reservedContacts[appId]).trim()) ? String(reservedContacts[appId]).trim() : null; // placeholders count as no email on file
    const rec = state.records?.[appId];
    if (!rec || !slug || !apiKey) return null;
    const res = await fetchImpl(`https://here.now/api/v1/publishes/${encodeURIComponent(slug)}/data/${COLLECTION}/${encodeURIComponent(rec)}`, { headers: { authorization: `Bearer ${apiKey}` } });
    if (!res.ok) return null;
    const j = await res.json();
    const d = j.record?.data || j.record || {};
    return d.contact_email || null;
  };
}
