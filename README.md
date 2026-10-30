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
