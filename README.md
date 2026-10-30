# JC AiPP Store Lite

A small static app store for open-source apps.

- `data/apps.json` – the single source of truth for every app (add new apps here).
- `data/site.json` – site-wide settings (title, canonical base URL placeholder).
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
