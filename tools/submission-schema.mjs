// JC-28: one source of truth for the developer submission form (JC-7 spec, section 1).
// Used by build.mjs (form page + .herenow/data.json manifest), the daily batch and the tests.
// Every field name is a here.now Site Data identifier: ^[a-z][a-z0-9_]*$ (max 50 fields per collection).

export const COLLECTION = 'submissions';
export const FORM_VERSION = 1;
// Per-IP write cap enforced by here.now at the edge (plus its fixed 1,000 creates/hour site cap).
export const RATE_LIMIT = '3/hour/ip';
export const RECORD_MAX_BYTES = 16 * 1024; // here.now record body cap

export const PLATFORMS = [['android', 'Android'], ['web', 'Web'], ['ios', 'iPhone (PWA or App Store)']];
export const CATEGORIES = [
  ['BusinessApplication', 'Productivity and business'], ['DesignApplication', 'Design and creativity'],
  ['EducationalApplication', 'Education'], ['EntertainmentApplication', 'Entertainment'],
  ['FinanceApplication', 'Finance'], ['GameApplication', 'Games'], ['HealthApplication', 'Health and fitness'],
  ['LifestyleApplication', 'Lifestyle and home'], ['MultimediaApplication', 'Photo, video and music'],
  ['SocialNetworkingApplication', 'Social'], ['SportsApplication', 'Sports'], ['TravelApplication', 'Travel'],
  ['UtilitiesApplication', 'Utilities'],
];
export const LICENSES = [
  ['', 'No license yet'], ['MIT', 'MIT'], ['Apache-2.0', 'Apache 2.0'], ['GPL-3.0-only', 'GPL 3.0'],
  ['AGPL-3.0-only', 'AGPL 3.0'], ['MPL-2.0', 'Mozilla Public License 2.0'], ['BSD-3-Clause', 'BSD 3-Clause'],
  ['Unlicense', 'The Unlicense'], ['other', 'Other (say which in Technical notes)'],
];

// kind: text | email | url | textarea | select | checkbox | platforms | honeypot
// section: dev | app | media | links | agree
const F = (name, label, o = {}) => ({ name, label, kind: 'text', required: false, maxLength: 200, ...o });
export const FIELDS = [
  F('dev_name', 'Developer name or brand', { section: 'dev', required: true, maxLength: 60, help: 'Shown publicly. Use a brand or handle, not a personal or family name.' }),
  F('contact_email', 'Contact email', { section: 'dev', kind: 'email', required: true, maxLength: 254, private: true, autocomplete: 'email', help: 'Private. Never shown on the store or in any repo; used only for the confirmation thread and edit requests.' }),
  F('github_handle', 'GitHub handle', { section: 'dev', required: true, maxLength: 39, pattern: '^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$', help: 'Shown as the author line. Must own the source repo below.' }),

  F('app_name', 'App name', { section: 'app', required: true, maxLength: 40, minLength: 2 }),
  F('summary', 'One-line summary', { section: 'app', required: true, maxLength: 120, help: 'Up to 120 characters.' }),
  F('category', 'Category', { section: 'app', kind: 'select', required: true, options: CATEGORIES, maxLength: 40 }),
  F('about', 'About', { section: 'app', kind: 'textarea', required: true, maxLength: 1500, help: '1 to 3 short paragraphs in plain language. Leave a blank line between paragraphs.' }),
  F('platforms', 'Platforms', { section: 'app', kind: 'platforms', required: true, maxLength: 40 }),
  F('note_android', 'Android note (optional)', { section: 'app', maxLength: 160 }),
  F('note_web', 'Web note (optional)', { section: 'app', maxLength: 160 }),
  F('note_ios', 'iPhone note (optional)', { section: 'app', maxLength: 160, help: 'For example: Add to Home Screen in Safari.' }),
  F('version', 'Current version', { section: 'app', required: true, maxLength: 20, pattern: '^v?\\d+(\\.\\d+){0,3}$', help: 'Numbers only, like 1.2.0.' }),
  F('whats_new', "What's new in this version", { section: 'app', kind: 'textarea', required: true, maxLength: 600, help: '1 to 5 bullets, one per line.' }),
  F('built_with', 'Built with', { section: 'app', required: true, maxLength: 80, help: 'Stack and any AI model or service used.' }),
  F('how_it_works', 'How it works and what data it uses', { section: 'app', kind: 'textarea', required: true, maxLength: 400, help: '1 to 3 lines. Say what data leaves the device, if any.' }),
  F('under_construction', 'This app is not fully ready yet (shows "Under construction")', { section: 'app', kind: 'checkbox' }),

  F('icon_url', 'Icon URL', { section: 'media', kind: 'url', required: true, maxLength: 300, help: 'Square PNG, WebP or JPEG, at least 512 px, from your public repo (https). SVG is not accepted.' }),
  F('icon_alt', 'Icon alt text', { section: 'media', required: true, maxLength: 120 }),
  ...[1, 2, 3, 4, 5, 6].flatMap((n) => [
    F(`shot${n}_url`, `Screenshot ${n} URL${n > 2 ? ' (optional)' : ''}`, { section: 'media', kind: 'url', required: n <= 2, maxLength: 300 }),
    F(`shot${n}_alt`, `Screenshot ${n} alt text${n > 2 ? ' (optional)' : ''}`, { section: 'media', required: n <= 2, maxLength: 160, minLength: n <= 2 ? 20 : 0, pairsWith: `shot${n}_url` }),
  ]),
  F('screenshots_note', 'Note about the screenshots (optional)', { section: 'media', maxLength: 200, help: 'Use sample data only, never real accounts or personal data.' }),

  F('repo_url', 'Public source repo URL', { section: 'links', kind: 'url', required: true, maxLength: 200, pattern: '^https://github\\.com/[A-Za-z0-9-]+/[A-Za-z0-9._-]+/?$', help: 'https://github.com/your-handle/your-app' }),
  F('license', 'License', { section: 'links', kind: 'select', options: LICENSES, maxLength: 40 }),
  F('download_page_url', 'Download page URL', { section: 'links', kind: 'url', maxLength: 300, help: 'Your own release page (GitHub Releases or your site). Not a direct .apk file link.' }),
  F('download_size', 'Download size (optional)', { section: 'links', maxLength: 20, help: 'For example: 48 MB.' }),
  F('open_web_url', 'Open website URL (optional)', { section: 'links', kind: 'url', maxLength: 300, help: 'Only for a full, working web version.' }),
  F('ios_app_store_url', 'iOS App Store URL (optional)', { section: 'links', kind: 'url', maxLength: 300, pattern: '^https://apps\\.apple\\.com/.+' }),

  F('agree_owner', 'I own this app or have the right to list it.', { section: 'agree', kind: 'checkbox', required: true }),
  F('agree_clean', 'There are no secrets, private links or personal data in the app or this listing.', { section: 'agree', kind: 'checkbox', required: true }),
  F('agree_disclaimer', "It's OK for the store to show its disclaimer on my app's page.", { section: 'agree', kind: 'checkbox', required: true }),

  // Honeypot: hidden from people and assistive tech. Real users leave it empty; the form and the batch drop any record that fills it.
  F('hp_website', 'Leave this field empty', { section: 'hp', kind: 'honeypot', maxLength: 200 }),
];
export const HONEYPOT = 'hp_website';
export const PUBLIC_FIELDS = FIELDS.filter((f) => !f.private && f.kind !== 'honeypot').map((f) => f.name);

// here.now Site Data manifest for .herenow/data.json. Owner-only read: records hold contact emails.
export function manifest() {
  const fields = {};
  for (const f of FIELDS) {
    if (f.kind === 'checkbox') fields[f.name] = { type: 'boolean', ...(f.required ? { required: true } : { default: false }) };
    else if (f.kind === 'email') fields[f.name] = { type: 'email', required: true, maxLength: f.maxLength, trim: true };
    else if (f.kind === 'url') fields[f.name] = { type: 'url', ...(f.required ? { required: true } : {}), maxLength: f.maxLength, allowedProtocols: ['https'] };
    else fields[f.name] = { type: 'string', ...(f.required ? { required: true } : {}), maxLength: f.maxLength, trim: true };
  }
  fields.form_version = { type: 'integer', minimum: 1, maximum: 99, default: FORM_VERSION };
  return {
    collections: {
      [COLLECTION]: {
        fields,
        access: { read: 'owner', insert: 'public', update: 'owner', delete: 'owner' },
        rateLimit: RATE_LIMIT,
      },
    },
  };
}

// P1-2 emergency manifest: same fields, public insert OFF. Keeps existing records ({ "collections": {} } would drop the
// collection). Committed as tools/manifest-disabled.json. Publishing it is Review & Release's job and needs the owner's OK
// (or the owner switch submissions.emergencyManifestPreapproved). The batch and its routine never publish.
export function disabledManifest() {
  const m = manifest();
  m.collections[COLLECTION].access = { read: 'owner', insert: 'none', update: 'owner', delete: 'owner' };
  return m;
}
