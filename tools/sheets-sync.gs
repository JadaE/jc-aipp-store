/** @OnlyCurrentDoc */
/**
 * JC AiPP Store: copy form submissions from here.now Site Data into this Google Sheet.
 * Paste into the Sheet's Extensions > Apps Script. Runs as the Sheet owner; nothing here is public.
 * Script properties (Project Settings): HERENOW_API_KEY, SITE_SLUG. Never put them in this file.
 * Run setup() once: it adds the header row and a 15-minute trigger. Rows are added by record ID, never twice.
 * Keep this Sheet private: no editors, no link sharing, and never deploy this script as a web app.
 * Keep FIELDS in sync with tools/submission-schema.mjs (a test checks this).
 */
var FIELDS = ["dev_name","contact_email","github_handle","app_name","summary","category","about","platforms","note_android","note_web","note_ios","version","whats_new","built_with","how_it_works","under_construction","icon_url","icon_alt","shot1_url","shot1_alt","shot2_url","shot2_alt","shot3_url","shot3_alt","shot4_url","shot4_alt","shot5_url","shot5_alt","shot6_url","shot6_alt","screenshots_note","repo_url","license","download_page_url","download_size","open_web_url","ios_app_store_url","agree_owner","agree_clean","agree_disclaimer"];
var HONEYPOT = 'hp_website';
var MAX_PAGES = 50, MAX_CELL = 5000, SHEET = 'Submissions';

function setup() {
  var sh = sheet_();
  if (sh.getLastRow() === 0) sh.appendRow(['record_id', 'created_at'].concat(FIELDS));
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'sync') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('sync').timeBased().everyMinutes(15).create();
  sync();
}

function sync() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return;
  try {
    var props = PropertiesService.getScriptProperties();
    var key = props.getProperty('HERENOW_API_KEY'), slug = props.getProperty('SITE_SLUG');
    if (!key || !slug) throw new Error('Set HERENOW_API_KEY and SITE_SLUG in Project Settings > Script properties.');
    var sh = sheet_();
    var seen = {};
    if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().forEach(function (r) { seen[String(r[0])] = true; });
    var rows = newRows_(fetchAll_(key, slug), seen);
    if (rows.length) {
      var range = sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length);
      range.setNumberFormat('@'); // plain text: nothing is ever evaluated as a formula, and IDs keep leading zeros
      range.setValues(rows);
    }
  } finally { lock.releaseLock(); }
}

function fetchAll_(key, slug) {
  var out = [], cursor = '';
  for (var page = 0; page < MAX_PAGES; page++) {
    var url = 'https://here.now/api/v1/publishes/' + encodeURIComponent(slug) + '/data/submissions?limit=100' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : '');
    var res = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + key }, muteHttpExceptions: true, followRedirects: false });
    if (res.getResponseCode() !== 200) throw new Error('here.now list failed: HTTP ' + res.getResponseCode());
    var j = JSON.parse(res.getContentText());
    out = out.concat(j.records || []);
    if (!j.nextCursor) return out;
    cursor = j.nextCursor;
  }
  throw new Error('More than ' + MAX_PAGES + ' pages of submissions; stopped (possible flood).');
}

// Pure: records -> new rows (skips seen IDs and honeypot hits). Exported for tests.
function newRows_(records, seen) {
  var rows = [];
  records.forEach(function (r) {
    if (!r || typeof r.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(r.id) || seen[r.id]) return;
    var d = (r.data && typeof r.data === 'object') ? r.data : {};
    if (d[HONEYPOT]) return;
    seen[r.id] = true;
    rows.push([cell_(r.id), cell_(r.created_at)].concat(FIELDS.map(function (f) { return cell_(d[f]); })));
  });
  return rows;
}

// Plain text only (belt and braces with the '@' format): prefix anything that starts with whitespace, an
// invisible or control char, or a formula lead (= + - @, fullwidth too), and cap the length.
var RISKY_LEAD = /^(?:[\s\u0000-\u001f\u007f-\u00a0\u1680\u180e\u2000-\u200f\u2028-\u202f\u205f\u2060-\u206f\u3000\ufeff]|[=+\-@\uff1d\uff0b\uff0d\uff20])/;
function cell_(v) {
  if (v === undefined || v === null) return '';
  var s = typeof v === 'string' ? v : JSON.stringify(v);
  s = s.slice(0, MAX_CELL);
  return RISKY_LEAD.test(s) ? "'" + s : s;
}

function sheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(SHEET) || ss.insertSheet(SHEET);
}
