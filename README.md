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
Replace `static/assets/logo.svg` (dark theme) and `static/assets/logo-light.svg` (light theme) with the final artwork and
update `logo.width`/`logo.height` in `data/site.json`. Set `logo.includesWordmark` to `true` if the artwork contains the
"JC AiPP Store" text; "Lite" is always rendered separately.

## Release notes
See `CHANGELOG.md`.
