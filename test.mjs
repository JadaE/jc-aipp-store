// Tests: data validation, internal links/images, external-link allowlist, secret scan, HTML + a11y checks.
// Run after `node build.mjs`. Optional tools (html-validate, axe-core + playwright-core + Chrome) are skipped if missing.
import fs from 'node:fs';
import path from 'node:path';
import { execSync, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolveSiteUrl } from './siteurl.mjs';

const root = path.dirname(new URL(import.meta.url).pathname);
const dist = path.join(root, 'dist');
let failed = 0;
const ok = (m) => console.log(`  ok   ${m}`);
const fail = (m) => { failed++; console.log(`  FAIL ${m}`); };
const skip = (m) => console.log(`  skip ${m}`);
const section = (m) => console.log(`\n${m}`);

const site = JSON.parse(fs.readFileSync(path.join(root, 'data/site.json'), 'utf8'));
const owner = site.githubOwner;

// 0. site.json
section('site.json');
{
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const resolved = resolveSiteUrl(root, site);
  if (!/^https:\/\/[a-z0-9.-]+$/.test(resolved.url)) fail('site URL must be an https origin with no path');
  else if (site.siteUrl !== 'https://example.invalid') fail('data/site.json siteUrl must stay a placeholder; the real URL comes from config.local.json or SITE_URL');
  else if (site.version !== pkg.version) fail(`site.json version ${site.version} != package.json ${pkg.version}`);
  else if (!site.logo || !fs.existsSync(path.join(root, 'static', site.logo.dark)) || !fs.existsSync(path.join(root, 'static', site.logo.light))) fail('logo files missing');
  else ok(`site URL (from ${resolved.source}), version ${site.version} and logo files OK`);
}

// 1. apps.json
section('apps.json');
let apps = [];
try { apps = JSON.parse(fs.readFileSync(path.join(root, 'data/apps.json'), 'utf8')).apps; ok('valid JSON'); }
catch (e) { fail(`apps.json does not parse: ${e.message}`); }
const PLAT = ['android', 'ios', 'windows', 'macos', 'web'];
const ids = new Set();
for (const a of apps) {
  const where = a.id || '(no id)';
  for (const k of ['id', 'name', 'repo', 'summary', 'description', 'platforms', 'version', 'icon', 'screenshots', 'links'])
    if (a[k] === undefined || a[k] === '') fail(`${where}: missing ${k}`);
  if (!/^[a-z0-9-]+$/.test(a.id || '')) fail(`${where}: id must be kebab-case`);
  if (ids.has(a.id)) fail(`${where}: duplicate id`); ids.add(a.id);
  if (!Array.isArray(a.platforms) || !a.platforms.length || a.platforms.some((p) => !PLAT.includes(p))) fail(`${where}: bad platforms ${a.platforms}`);
  if (!Array.isArray(a.description) || !a.description.length) fail(`${where}: description must be a non-empty array`);
  if (a.version === 'Unknown' && !(a.todo || []).some((t) => /version/i.test(t))) fail(`${where}: Unknown version needs a TODO`);
  if (a.version !== 'Unknown' && !/^v?\d+(\.\d+)*$/.test(a.version)) fail(`${where}: version "${a.version}" is not Unknown or numeric`);
  const repoRe = new RegExp(`^https://github\\.com/${owner}/${a.repo}(/|$)`);
  if (a.links?.download && !repoRe.test(a.links.download.url)) fail(`${where}: download URL must be on its public GitHub repo (needs approval otherwise): ${a.links.download.url}`);
  if (a.links?.iosAppStore != null && !/^https:\/\/apps\.apple\.com\//.test(a.links.iosAppStore)) fail(`${where}: iosAppStore must be an apps.apple.com URL`);
  for (const img of [a.icon, ...(a.screenshots || [])]) {
    if (!img?.src || !fs.existsSync(path.join(root, 'static', img.src))) fail(`${where}: image missing: ${img?.src}`);
    if (!img?.alt) fail(`${where}: image without alt: ${img?.src}`);
  }
}
if (apps.length && !failed) ok(`${apps.length} apps valid`);

// 2. links and images in the build
section('links and images');
if (!fs.existsSync(path.join(dist, 'index.html'))) { fail('dist/ missing; run node build.mjs'); }
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
const htmlFiles = fs.existsSync(dist) ? walk(dist).filter((f) => f.endsWith('.html')) : [];
const allowedExternal = [
  new RegExp(`^https://github\\.com/${owner}/?$`),
  ...apps.map((a) => new RegExp(`^https://github\\.com/${owner}/${a.repo}(/(fork|releases.*|archive/refs/.+\\.zip))?$`)),
  /^https:\/\/apps\.apple\.com\//,
];
const base = resolveSiteUrl(root, site).url;
let internal = 0, external = 0;
for (const f of htmlFiles) {
  const html = fs.readFileSync(f, 'utf8');
  for (const m of html.matchAll(/\s(?:href|src)="([^"]+)"/g)) {
    const url = m[1].replace(/&amp;/g, '&');
    if (url.startsWith('#')) { if (url.length > 1 && !html.includes(`id="${url.slice(1)}"`)) fail(`${path.relative(dist, f)}: missing anchor ${url}`); continue; }
    if (/^[a-z]+:/i.test(url)) {
      if (url.startsWith(base + '/') || url === base) continue; // canonical placeholder
      external++;
      if (!allowedExternal.some((r) => r.test(url))) fail(`${path.relative(dist, f)}: external link not allowlisted (needs approval): ${url}`);
      continue;
    }
    internal++;
    let target = path.resolve(path.dirname(f), url.split(/[?#]/)[0]);
    if (url.endsWith('/')) target = path.join(target, 'index.html');
    if (!fs.existsSync(target)) fail(`${path.relative(dist, f)}: broken link ${url}`);
  }
  if (/<img(?![^>]*\balt=)[^>]*>/.test(html)) fail(`${path.relative(dist, f)}: <img> without alt`);
}
ok(`${htmlFiles.length} pages, ${internal} internal refs, ${external} external links checked`);

// 3. secret / private URL scan
section('secret scan (tracked + unignored files and dist/)');
let files = [];
try { files = execSync('git ls-files -co --exclude-standard', { cwd: root }).toString().split('\n').filter(Boolean).map((f) => path.join(root, f)); }
catch { files = walk(root).filter((f) => !f.includes('/node_modules/') && !f.includes('/.git/')); }
files = [...new Set([...files, ...walk(dist)])].filter((f) => fs.existsSync(f) && !/\.(png|webp|jpg|jpeg|gif|ico)$/.test(f));
const patterns = [
  [/https?:\/\/[^\s"'<>)]*\.here\.now/i, 'here.now URL'],
  [/\b[a-z0-9-]+\.here\.now\b/, 'here.now host'],
  [/github_pat_[A-Za-z0-9_]{20,}|\bgh[pousr]_[A-Za-z0-9]{30,}/, 'GitHub token'],
  [/\bsk-[A-Za-z0-9_-]{20,}/, 'API secret key'],
  [/AKIA[0-9A-Z]{16}/, 'AWS key'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key'],
  [/"apiKey"\s*:\s*"(?!YOUR_)[^"]+"/, 'apiKey value'],
  [/HERENOW_API_KEY\s*=\s*["']?[A-Za-z0-9]{12,}/, 'hardcoded HERENOW_API_KEY'],
];
const localCfg = path.join(root, 'config.local.json');
const localValues = [];
if (fs.existsSync(localCfg)) {
  const collect = (v) => typeof v === 'string' ? (v.length >= 6 && localValues.push(v)) : v && typeof v === 'object' && Object.values(v).forEach(collect);
  try { collect(JSON.parse(fs.readFileSync(localCfg, 'utf8'))); } catch { fail('config.local.json does not parse'); }
}
try { if (execSync('git ls-files config.local.json', { cwd: root }).toString().trim()) fail('config.local.json is tracked by git'); } catch {}
let hits = 0;
for (const f of files) {
  if (path.basename(f) === 'config.local.json') continue;
  // The store's own public URL is expected in the built canonical/OG/sitemap tags (dist only, never tracked files).
  const raw = fs.readFileSync(f, 'utf8'); const txt = f.startsWith(dist + path.sep) ? raw.split(base).join('') : raw;
  for (const [re, name] of patterns) if (re.test(txt)) { hits++; fail(`${path.relative(root, f)}: looks like a ${name}`); }
  for (const v of localValues) if (txt.includes(v)) { hits++; fail(`${path.relative(root, f)}: contains a config.local.json value`); }
}
// Owner name must not appear in site copy, except inside the GitHub handle used in repo URLs.
const ownerName = ['J', 'a', 'd', 'a'].join('');
const handle = new RegExp(`${owner}`, 'g');
for (const f of files) {
  const txt = fs.readFileSync(f, 'utf8').replace(handle, '');
  if (new RegExp(ownerName, 'i').test(txt)) { hits++; fail(`${path.relative(root, f)}: mentions the owner's name outside ${owner} GitHub URLs`); }
}
for (const f of htmlFiles) if (/small apps|open skies/i.test(fs.readFileSync(f, 'utf8'))) { hits++; fail(`${path.relative(dist, f)}: old hero copy`); }
if (!hits) ok(`${files.length} files clean${localValues.length ? ` (also checked ${localValues.length} config.local.json values)` : ' (no config.local.json present)'}`);

// 4. HTML validation
section('HTML validation');
const hv = path.join(root, 'node_modules/.bin/html-validate');
if (fs.existsSync(hv)) {
  const r = spawnSync(hv, ['--formatter', 'text', ...htmlFiles], { cwd: root, encoding: 'utf8' });
  if (r.status === 0) ok(`html-validate: ${htmlFiles.length} pages valid`); else fail(`html-validate:\n${r.stdout}${r.stderr}`);
} else skip('html-validate not installed (npm install)');

// 5. Accessibility (axe-core in headless Chrome)
section('accessibility (axe-core, WCAG 2 A/AA)');
const chrome = process.env.CHROME || ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => fs.existsSync(p));
let pw, axePath;
try { pw = await import('playwright-core'); axePath = path.join(root, 'node_modules/axe-core/axe.min.js'); if (!fs.existsSync(axePath)) throw 0; } catch { pw = null; }
if (!pw || !chrome) skip('axe-core/playwright-core or Chrome not available');
else {
  const browser = await pw.chromium.launch({ executablePath: chrome, args: ['--no-sandbox', '--allow-file-access-from-files'] });
  for (const vp of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    for (const f of htmlFiles) {
      const page = await browser.newPage({ viewport: vp });
      await page.goto(pathToFileURL(f).href);
      await page.addScriptTag({ path: axePath });
      for (const theme of ['dark', 'light']) {
        await page.evaluate((t) => { if (t === 'light') document.documentElement.setAttribute('data-theme', 'light'); else document.documentElement.removeAttribute('data-theme'); }, theme);
        const res = await page.evaluate(async () => await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] } }));
        const v = res.violations;
        if (v.length) fail(`${path.relative(dist, f)} @${vp.width}px ${theme}: ${v.map((x) => `${x.id} (${x.nodes.length}): ${x.nodes[0].target}`).join('; ')}`);
      }
      await page.close();
    }
  }
  // keyboard + filter behaviour on the home page
  const page = await browser.newPage();
  await page.goto(pathToFileURL(path.join(dist, 'index.html')).href + '#web');
  const pressed = await page.getAttribute('button[data-platform="web"]', 'aria-pressed');
  await page.click('button[data-platform="android"]');
  const visibleAndroid = await page.$$eval('[data-platforms]', (els) => els.filter((e) => !e.hidden).map((e) => e.dataset.platforms));
  await page.click('button[data-platform="ios"]');
  const visibleIos = await page.$$eval('[data-platforms]', (els) => els.filter((e) => !e.hidden).length);
  const webCount = apps.filter((a) => a.platforms.includes('web') || a.platforms.includes('ios')).length;
  const fresh = await browser.newPage();
  await fresh.goto(pathToFileURL(path.join(dist, 'apps', apps[0].id, 'index.html')).href);
  await fresh.keyboard.press('Tab');
  const firstFocus = await fresh.evaluate(() => document.activeElement.className);
  if (pressed !== 'true') fail('hash #web did not preselect the Web filter');
  else if (!visibleAndroid.every((p) => p.includes('android'))) fail('Android filter shows non-Android apps');
  else if (visibleIos !== webCount) fail(`iOS filter should show ${webCount} web/iOS apps, showed ${visibleIos}`);
  else if (firstFocus !== 'skip-link') fail('first Tab stop is not the skip link');
  else ok(`axe clean on ${htmlFiles.length} pages x 2 viewports x 2 themes; filters, hash state and skip link work`);

  // theme toggle: dark by default even when the OS prefers light; keyboard toggles; choice persists
  const ctx = await browser.newContext({ colorScheme: 'light' });
  const tp = await ctx.newPage();
  const home = pathToFileURL(path.join(dist, 'index.html')).href;
  await tp.goto(home);
  const t0 = await tp.evaluate(() => document.documentElement.getAttribute('data-theme'));
  const btnVisible = await tp.isVisible('[data-theme-toggle]');
  await tp.focus('[data-theme-toggle]');
  await tp.keyboard.press('Enter');
  const t1 = await tp.evaluate(() => [document.documentElement.getAttribute('data-theme'), document.querySelector('[data-theme-toggle]').getAttribute('aria-pressed'), localStorage.getItem('aipp-theme')]);
  await tp.goto(pathToFileURL(path.join(dist, 'apps', apps[0].id, 'index.html')).href);
  const t2 = await tp.evaluate(() => [document.documentElement.getAttribute('data-theme'), document.querySelector('[data-theme-toggle]').getAttribute('aria-pressed')]);
  await tp.keyboard.press('Tab'); await tp.keyboard.press('Tab'); await tp.keyboard.press('Tab');
  const focused = await tp.evaluate(() => document.activeElement.hasAttribute('data-theme-toggle'));
  await tp.keyboard.press('Space');
  const t3 = await tp.evaluate(() => [document.documentElement.getAttribute('data-theme'), localStorage.getItem('aipp-theme')]);
  if (t0 !== null || !btnVisible) fail(`default theme should be dark with a visible toggle (got ${t0}, visible ${btnVisible})`);
  else if (t1.join() !== 'light,true,light') fail(`Enter on toggle should switch to light and persist (got ${t1})`);
  else if (t2.join() !== 'light,true') fail(`light choice not restored on next page (got ${t2})`);
  else if (!(focused && t3[0] === null && t3[1] === 'dark')) fail(`keyboard toggle back to dark failed (focused ${focused}, got ${t3})`);
  else ok('theme: dark by default under OS light preference; toggle works by keyboard, aria-pressed updates, choice persists across pages');
  await ctx.close();
  await browser.close();
}

console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
