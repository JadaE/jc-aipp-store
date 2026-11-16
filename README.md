# JC AiPP Store Lite

A small static app store for open-source apps.

- `data/apps.json` – the single source of truth for every app (add new apps here).
- `data/site.json` – site-wide settings: name, version, hero and footer copy, logo. `siteUrl` there is a placeholder; the real URL for canonical/OG/sitemap is read at build time from `config.local.json` (`site.siteUrl`, else `herenow.slug`) or `SITE_URL`.
- `static/` – CSS, JS, favicon and optimized app images, copied as-is into the build.
- `build.mjs` – generates `dist/` (home page, one page per app, sitemap, robots).
- `test.mjs` – data validation, link/image checks, secret scan, HTML + accessibility checks.
- `publish.sh` – publishes `dist/` to here.now (needs a release reviewer's approval first).

## Build and test
```bash
npm install        # optional: html-validate, axe-core, playwright-core for the HTML/a11y checks
npm run build      # -> dist/
npm test
```

## Config
Copy `config.example.json` to `config.local.json` (gitignored) and fill in your own values,
or set `HERENOW_API_KEY` in the environment. Never commit real keys or site URLs.

## Themes
Dark is the default. The header toggle switches to light mode and stores the choice in `localStorage` (`aipp-theme`);
a tiny inline script in `<head>` applies it before paint. Colors live in CSS variables at the top of `static/css/style.css`.

## Logo
One placeholder mark, `static/assets/logo.svg`, is used in both themes. Replace it with the final artwork and update
`logo.width`/`logo.height` in `data/site.json`; set `logo.includesWordmark` to `true` if it contains the store name.
CSS and JS URLs carry a content hash (`?v=`), so browsers never mix new pages with old cached styles.

## App text
Each app in `data/apps.json` has `about` (plain language for non-technical people: what it does and why you'd want it)
and `technical` (stack, hosting, requirements). Release notes go in `updates` ({version, date?, notes[]}, newest first,
only from public release notes) and show in their own Updates section. `builtWith` (AI model or service) is shown in
Details when set; it is null for now. They are never mixed: About sits under the screenshots, and Technical
details is the last part of the Details box. `npm test` fails if words like Expo, Node.js or PWA show up in `summary`,
`about` or `platformNotes`.

## Screenshots
Each app has 0 to 4 screenshots in `static/assets/apps/<id>/shot-N.webp`, listed in `data/apps.json` with `src`, `alt`,
`caption`, `width` and `height`. They are rendered from a fresh clone of the app's public repo, using only fictional demo
data (for example Kida and Micah, and made-up pet names) and placeholder images: never real accounts, IDs, emails, photos
or private URLs. App pages show them in a keyboard-scrollable gallery; `npm test` checks that every file exists, its size
matches the data, and it has alt text and a caption.

## Download data model
Downloads are **source-only** for now. Each app's `links` object has:

| Field | Now | Meaning |
|---|---|---|
| `download` | GitHub source zip | The only download the site renders. Must be on `github.com/<owner>/<repo>`. |
| `githubRelease` | `null` | Reserved: a GitHub Releases asset, e.g. `{"url": "https://github.com/<owner>/<repo>/releases/download/<tag>/<file>", "label": "...", "enabled": false}`. |
| `ownDownload` | `null` | Reserved: an owner-hosted download link, e.g. `{"url": "...", "label": "...", "enabled": false}`. |
| `iosAppStore` | `null` | Reserved: an `apps.apple.com` listing. |

`githubRelease` and `ownDownload` must stay `null` or `"enabled": false` (the tests enforce this) and the build never
renders them. Turning either one on needs release-review approval (including the legal question about direct app
downloads) and a build change. Unlisted app URLs never go in this repo.

## Release notes
See `CHANGELOG.md`.

## Developer submissions (JC-28)
`/submit/` is the public submission form. Its fields come from `tools/submission-schema.mjs`, which also generates the
here.now Site Data manifest `dist/.herenow/data.json`: one `submissions` collection with **public insert only**, owner-only
read/update/delete (records hold contact emails), a `3/hour/ip` write limit and https-only URL fields. The manifest only
takes effect when a reviewed build is published. The form has a hidden honeypot field (`hp_website`) and client-side
checks; the batch checks everything again.

The daily batch, `tools/submissions-batch.mjs`, reads new records with the owner API, drops honeypot hits, anything over
`perEmailPerHour` per email and duplicates (by record ID, repo URL, or email + app name), then checks up to `batchSize`
records: required fields, link rules and reachability, secret / private-link / personal-name scans (shared with
`test.mjs` in `tools/scans.mjs`) and a hidden-instruction scan. A hidden-instruction hit quarantines the record; reports
name only the record ID and rule. Records that pass get the next free `JCA-` ID (the reserved range is skipped) and go into
one **draft** PR in the data repo. A person merging that PR is the publish step; the batch never merges, emails or edits
records.

```bash
node tools/submissions-batch.mjs --dry-run --no-network --fixtures records.json --out /tmp/batch   # test run, writes only to --out
node tools/submissions-batch.mjs                 # DEFAULT is a dry run: reads live records (read-only), opens nothing, saves no state
node tools/submissions-batch.mjs --live          # live: opens the draft PR and updates the local state file
```

Settings live under `submissions` in `config.example.json` (approver, `licenseRequired`, reserved IDs, `frontOfficeEmail`,
data repo, batch size, per-email limit). Override them in the gitignored `config.local.json`; private names and terms to
block go in `config.local.json` `submissions.privateTerms` only. The batch's state file (processed record IDs, app ID to
record ID) is kept outside the repo.

### Verifying the live collection (after an approved publish)
Public create must work and public read must not:
```bash
SITE="$SITE_URL"   # the store's public origin (from config.local.json); SLUG is its site slug
curl -s -o /dev/null -w '%{http_code}\n' "$SITE/.herenow/data/submissions"                 # expect 401/403, never 200
curl -s -o /dev/null -w '%{http_code}\n' "$SITE/.herenow/data/submissions/ANY_ID"          # expect 401/403/404, never 200
curl -s -X POST "$SITE/.herenow/data/submissions" -H "Origin: $SITE" -H 'content-type: application/json' \
  -H "Idempotency-Key: $(uuidgen)" -d @probe.json                                           # expect 201 + {record:{id}}
curl -s -o /dev/null -w '%{http_code}\n' "$SITE/.herenow/data/submissions/$PROBE_ID"         # expect 401/403/404 (not readable)
curl -s "https://here.now/api/v1/publishes/$SLUG/data/submissions?limit=5" -H "Authorization: Bearer $HERENOW_API_KEY"  # owner sees it
curl -s -X DELETE "https://here.now/api/v1/publishes/$SLUG/data/submissions/$PROBE_ID" -H "Authorization: Bearer $HERENOW_API_KEY"  # clean up
```

## Request an edit (JC-8)
Each app has a public `appId` in `data/apps.json` (the store owner's own apps use the reserved `JCA-0001` to `JCA-0005`).
App pages show a "Request an edit" panel quoting that ID. When `submissions.frontOfficeEmail` is a real address, the
panel has a mailto link whose subject and body quote the app ID with a short template (what to change, the new text, send
it from the email on file). While it is `"TBD"` (or invalid) the page shows the ID and a "coming soon" note instead of a
disabled link, since a disabled link can't be focused or explained to screen readers. The front-office address is public
by design; set it in `config.example.json` or `config.local.json` (`FRONT_OFFICE_EMAIL` overrides for a build).

Edits are accepted only from the email on file: `tools/edit-requests.mjs` `verifyEditRequest(msg, { emailOnFile })`
takes one parsed email (`subject`, `body`, `from`, `senderAuthenticated` = the inbox's SPF/DKIM/DMARC pass for From) and
returns `{ accepted, appId, reason }` (`ok`, `no-app-id`, `several-app-ids`, `unknown-app`, `sender-not-authenticated`,
`sender-mismatch`). The app ID must be in the subject and be the only ID in the message. `makeEmailOnFile` looks the
address up privately: reserved IDs from `config.local.json` `submissions.reservedContacts`, submitted apps from their
owner-only Site Data record (app ID to record ID comes from the batch state file). Addresses never go into results,
logs, public data or the repo. There is no inbox reading or sending here; a later, human-approved step will call this check.

## Confirmation email drafts (JC-9)
The batch writes a confirmation email **draft** (`<name>.json` with to/subject/body plus a matching `.eml`, mode 0600)
for every accepted record (app ID, listing summary, next steps: add `jc-aipp-store.txt` with the app ID, then a human
review; replies to the thread handle changes and status), every rejected record (which fields to fix) and every record
blocked by the scans (categories only; the flagged value is never repeated). Quarantined, honeypot, rate-limited and
duplicate records get no draft. `frontOfficeEmail` is the Reply-To; while it is `"TBD"` the draft has no Reply-To and is
marked `X-JC-Draft-Status: hold-front-office-email-tbd`.

Drafts go to a private folder: `<out>/drafts` for `--dry-run`, `submissions.draftsDir/<date>` (default
`~/.aipp-store/drafts`) for live runs, or `--drafts <dir>`. The batch refuses a folder inside the repo unless it is
gitignored (`drafts/` and `batch-out/` are). Recipient addresses exist only in those files: never in the PR, listings,
summaries, state or logs. Nothing here sends mail, calls a mail API or creates mailbox drafts; a person sends each draft
later through an approval step.

## Hardening after the security review
- **Fixed-text drafts (P1-1):** confirmation drafts are written for accepted records only and hold only store text and the
  JCA ID (no submitted names, text or links). The first mail asks the developer to reply from the same address; only a
  DMARC-aligned reply from the on-file address verifies it (`verifyContactReply`, flag stored by app ID). Edit requests need a
  verified email and a passed ownership proof. Drafts are sendable only when the owner switch `sendDraftsApproved` is on, Reply-To
  is set, and they are under the caps (10 per day, 1 per recipient per 30 days, tracked by hash). Every send is its own approval.
- **Steering attempts (P1-2):** a hidden-instruction hit bans the submitter (email hash, handle, repo owner), pauses the batch
  and stops the run (no PR, no drafts). A paused batch checks nothing until the owner runs `--unpause --owner-ok`.
  `tools/manifest-disabled.json` is the emergency manifest (public insert off, records kept); Review & Release publishes it only
  with the owner's OK or the standing switch `emergencyManifestPreapproved`. Record IDs and timestamps are validated before use.
  Data-repo templates (`tools/data-repo-template/`: CODEOWNERS for the owner handle, a CI workflow) run `tools/check-listings.mjs`,
  which re-scans every listing and checks repo ownership, forks and the `jc-aipp-store.txt` proof.
- **Floods (P1-3):** the summary is capped at 8 KB (counts, reasons, 20-ID samples); more than `floodThreshold` (50) records in
  24 h or `floodTotal` (2,000) stored pauses the batch; fetching resumes from a saved cursor and aborts with `fetch-cap` instead of
  truncating. `tools/submissions-cleanup.mjs` plans retention deletes (junk after 7 days, everything after 90, drafts after 30);
  `--apply` works only with the owner switch `cleanupDeletesApproved`.
- **Link checks (P2-1):** HEAD only, manual redirects (3 hops), link rules on every hop, DNS checked against private ranges, and
  only "unreachable" is reported. **Listings (P2-2, P2-3):** duplicates of pending listings are reported, not dropped; SVG images
  are refused; download pages outside the repo's GitHub Releases and any website are flagged for manual review.
