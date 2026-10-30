// Build dist/ from data/apps.json + data/site.json + static/. No dependencies.
import fs from 'node:fs';
import path from 'node:path';
import { resolveSiteUrl } from './siteurl.mjs';

const root = path.dirname(new URL(import.meta.url).pathname);
const out = path.join(root, 'dist');
const site = JSON.parse(fs.readFileSync(path.join(root, 'data/site.json'), 'utf8'));
const { apps } = JSON.parse(fs.readFileSync(path.join(root, 'data/apps.json'), 'utf8'));

const PLATFORMS = { android: 'Android', ios: 'iOS', windows: 'Windows', macos: 'macOS', web: 'Web' };
const FILTERS = ['all', 'android', 'ios', 'windows', 'macos', 'web'];
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const { url: base, source: siteUrlSource } = resolveSiteUrl(root, site);
const repoUrl = (a) => `https://github.com/${site.githubOwner}/${a.repo}`;
const known = (v) => v && v !== 'Unknown';

// Header brand: swappable logo (dark + light variant) and a separate "Lite" label.
function logo(rel) {
  const L = site.logo;
  const word = site.name.replace(/\s*Lite$/, '');
  const alt = L.includesWordmark ? esc(L.alt) : '';
  const img = (src, cls) => `<img class="logo ${cls}" src="${rel}${src}" alt="${alt}" width="${L.width}" height="${L.height}">`;
  return `${img(L.dark, 'logo-dark')}${img(L.light, 'logo-light')}${L.includesWordmark ? '' : `<span class="brand-word">${esc(word)}</span>`}<span class="brand-lite">Lite</span>`;
}

function page({ title, description, rel, canonicalPath, body, jsonLd, ogImage = 'og-image.png', scripts = '' }) {
  const canonical = `${base}/${canonicalPath}`;
  return `<!DOCTYPE html>
<html lang="${site.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<script>try{if(localStorage.getItem("aipp-theme")==="light")document.documentElement.setAttribute("data-theme","light")}catch(e){}</script>
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(canonical)}">
<meta name="theme-color" content="#0a0e24">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(site.name)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:image" content="${esc(`${base}/${ogImage}`)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${esc(`${base}/${ogImage}`)}">
<link rel="icon" href="${rel}favicon.svg" type="image/svg+xml">
<link rel="icon" href="${rel}favicon-32.png" sizes="32x32" type="image/png">
<link rel="apple-touch-icon" href="${rel}apple-touch-icon.png">
<link rel="stylesheet" href="${rel}css/style.css">
${jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>\n` : ''}</head>
<body>
<a class="skip-link" href="#main">Skip to content</a>
<header class="site-header"><div class="wrap">
  <a class="brand" href="${rel}index.html">${logo(rel)}</a>
  <button type="button" class="theme-toggle" data-theme-toggle aria-pressed="false" hidden><svg class="i-sun" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.5"/><path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3M4.6 4.6l2.1 2.1M17.3 17.3l2.1 2.1M4.6 19.4l2.1-2.1M17.3 6.7l2.1-2.1"/></svg><svg class="i-moon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z"/></svg><span>Light mode</span></button>
</div></header>
<main id="main" class="wrap" tabindex="-1">
${body}
</main>
<footer class="site-footer"><div class="wrap">
  <p>${esc(site.footer)} <a href="https://github.com/${site.githubOwner}">Browse the repos on GitHub</a>.</p>
  <p class="fineprint">${esc(site.name)} v${esc(site.version)}</p>
</div></footer>
<script src="${rel}js/theme.js" defer></script>
${scripts}</body>
</html>
`;
}

const badges = (a) => a.platforms.map((p) => `<span class="badge ${p}">${PLATFORMS[p]}</span>`).join('');
const iconImg = (a, rel, size, eager = false) =>
  `<img src="${rel}${a.icon.src}" alt="${esc(a.icon.alt)}" width="${size}" height="${size}"${eager ? '' : ' loading="lazy"'} decoding="async">`;

// ---- home
const cards = apps.map((a) => `  <li class="card" data-platforms="${a.platforms.join(' ')}">
    <div class="card-head">${iconImg(a, '', 64)}<h2><a href="apps/${a.id}/index.html">${esc(a.name)}</a></h2></div>
    <p>${esc(a.summary)}</p>
    <div class="meta">${badges(a)}<span class="version">${known(a.version) ? 'v' + esc(a.version) : 'Version unknown'}</span></div>
  </li>`).join('\n');

const home = page({
  title: `${site.name}: download or fork open-source apps`,
  description: site.description,
  rel: '',
  canonicalPath: '',
  jsonLd: { '@context': 'https://schema.org', '@type': 'WebSite', name: site.name, url: `${base}/`, description: site.description },
  body: `<section class="hero" aria-labelledby="hero-title">
  <h1 id="hero-title"><span>${esc(site.hero.title)}</span></h1>
  <p>${esc(site.hero.lead)}</p>
</section>
<section aria-labelledby="apps-title">
  <h2 id="apps-title" class="visually-hidden">Apps</h2>
  <div class="filters" role="group" aria-label="Filter apps by platform" data-filters hidden>
${FILTERS.map((p) => `    <button type="button" class="chip" data-platform="${p}" aria-pressed="${p === 'all'}">${p === 'all' ? 'All' : PLATFORMS[p]}</button>`).join('\n')}
  </div>
  <p class="filter-note" data-filter-note aria-live="polite"></p>
  <ul class="grid">
${cards}
  </ul>
</section>`,
  scripts: `<script src="js/filter.js" defer></script>\n`,
});

// ---- app pages
function appPage(a) {
  const rel = '../../';
  const repo = repoUrl(a);
  const dl = a.links && a.links.download;
  const shots = a.screenshots.length
    ? `<div class="shots">${a.screenshots.map((s) => `<img src="${rel}${s.src}" alt="${esc(s.alt)}" width="${s.width}" height="${s.height}" loading="lazy" decoding="async">`).join('')}</div>`
    : `<div class="shot-placeholder" role="note"><p><strong>Screenshots coming soon.</strong><br>None are published in the repo yet.</p></div>`;
  const notes = Object.entries(a.platformNotes || {}).map(([p, n]) => `<li><strong>${PLATFORMS[p]}:</strong> ${esc(n)}</li>`).join('');
  const iosNote = a.platforms.includes('ios') ? '' : a.platforms.includes('web')
    ? '<li><strong>iPhone and iPad:</strong> no native iOS app yet; use the Web version in Safari.</li>' : '';
  const ld = {
    '@context': 'https://schema.org', '@type': 'SoftwareApplication', name: a.name, description: a.summary,
    applicationCategory: a.category, operatingSystem: a.platforms.map((p) => PLATFORMS[p]).join(', '),
    url: `${base}/apps/${a.id}/`, image: `${base}/${a.icon.src}`, sameAs: [repo],
    author: { '@type': 'Person', name: site.githubOwner, url: `https://github.com/${site.githubOwner}` },
  };
  if (known(a.version)) ld.softwareVersion = a.version;
  if (dl) ld.downloadUrl = dl.url;
  if (a.links.iosAppStore) ld.installUrl = a.links.iosAppStore;
  const gh = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm0 2.122a2.25 2.25 0 1 0-1.5 0v.878A2.25 2.25 0 0 0 5.75 8.5h1.5v2.128a2.251 2.251 0 1 0 1.5 0V8.5h1.5a2.25 2.25 0 0 0 2.25-2.25v-.878a2.25 2.25 0 1 0-1.5 0v.878a.75.75 0 0 1-.75.75h-4.5A.75.75 0 0 1 5 6.25v-.878Zm3.75 7.378a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm3-8.75a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Z"/></svg>';
  return page({
    title: `${a.name} | ${site.name}`,
    description: a.summary,
    rel,
    canonicalPath: `apps/${a.id}/`,
    jsonLd: ld,
    body: `<nav class="crumbs" aria-label="Breadcrumb"><a href="${rel}index.html">All apps</a> <span aria-hidden="true">/</span> <span aria-current="page">${esc(a.name)}</span></nav>
<section class="app-hero" aria-labelledby="app-title">
  ${iconImg(a, rel, 96, true)}
  <div><h1 id="app-title">${esc(a.name)}</h1><p>${esc(a.summary)}</p></div>
</section>
<div class="actions">
  <a class="btn primary" href="${repo}/fork">${gh}Fork on GitHub</a>
  ${dl ? `<a class="btn" href="${esc(dl.url)}">${esc(dl.label)}</a>` : ''}
  <a class="btn" href="${repo}">View repo</a>
  ${a.links.iosAppStore ? `<a class="btn" href="${esc(a.links.iosAppStore)}">App Store</a>` : ''}
</div>
<div class="app-layout">
  <div>
    <section class="panel" aria-labelledby="about-title"><h2 id="about-title">About</h2>${a.description.map((p) => `<p>${esc(p)}</p>`).join('')}</section>
    <section class="panel" aria-labelledby="shots-title"><h2 id="shots-title">Screenshots</h2>${shots}</section>
    <section class="panel soon" aria-labelledby="forks-title"><h2 id="forks-title">Vetted forks</h2><p>Vetted forks coming soon. Forks that pass review will be listed here.</p></section>
  </div>
  <aside class="panel" aria-labelledby="facts-title">
    <h2 id="facts-title">Details</h2>
    <dl class="facts">
      <dt>Version</dt><dd>${known(a.version) ? esc(a.version) : 'Unknown'}</dd>
      <dt>Platforms</dt><dd><span class="meta">${badges(a)}</span></dd>
      <dt>Source</dt><dd><a href="${repo}">${site.githubOwner}/${esc(a.repo)}</a></dd>
    </dl>
    ${notes || iosNote ? `<ul class="notes">${notes}${iosNote}</ul>` : ''}
  </aside>
</div>`,
  });
}

// ---- write
fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(path.join(root, 'static'), out, { recursive: true });
fs.writeFileSync(path.join(out, 'index.html'), home);
for (const a of apps) {
  fs.mkdirSync(path.join(out, 'apps', a.id), { recursive: true });
  fs.writeFileSync(path.join(out, 'apps', a.id, 'index.html'), appPage(a));
}
const urls = ['', ...apps.map((a) => `apps/${a.id}/`)];
fs.writeFileSync(path.join(out, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${esc(`${base}/${u}`)}</loc></url>`).join('\n')}\n</urlset>\n`);
fs.writeFileSync(path.join(out, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${base}/sitemap.xml\n`);
console.log(`built ${apps.length} app pages -> ${path.relative(process.cwd(), out) || out} (site URL from ${siteUrlSource})`);
