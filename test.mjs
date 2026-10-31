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
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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
  else if (!site.logo || !fs.existsSync(path.join(root, 'static', site.logo.dark)) ) fail('logo files missing');
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
  for (const k of ['id', 'name', 'repo', 'summary', 'about', 'technical', 'platforms', 'version', 'icon', 'screenshots', 'links'])
    if (a[k] === undefined || a[k] === '') fail(`${where}: missing ${k}`);
  if (!/^[a-z0-9-]+$/.test(a.id || '')) fail(`${where}: id must be kebab-case`);
  if (ids.has(a.id)) fail(`${where}: duplicate id`); ids.add(a.id);
  if (!Array.isArray(a.platforms) || !a.platforms.length || a.platforms.some((p) => !PLAT.includes(p))) fail(`${where}: bad platforms ${a.platforms}`);
  for (const k of ['about', 'technical']) if (!Array.isArray(a[k]) || !a[k].length) fail(`${where}: ${k} must be a non-empty array`);
  if ('description' in a) fail(`${where}: use about[] and technical[] instead of description`);
  const JARGON = /\b(Expo|React Native|Node\.?js|PWA|MediaStore|Cloudflare|Worker|TypeScript|Kotlin|API|OAuth|here\.now|Raspberry Pi|server|scope|dependenc)/i;
  for (const t of [a.summary, ...(a.about || []), ...Object.values(a.platformNotes || {})]) if (JARGON.test(t || '')) fail(`${where}: technical jargon "${(t.match(JARGON) || [])[0]}" in plain-language text; move it to technical[]`);
  if (a.version === 'Unknown' && !(a.todo || []).some((t) => /version/i.test(t))) fail(`${where}: Unknown version needs a TODO`);
  if (a.version !== 'Unknown' && !/^v?\d+(\.\d+)*$/.test(a.version)) fail(`${where}: version "${a.version}" is not Unknown or numeric`);
  const repoRe = new RegExp(`^https://github\\.com/${owner}/${a.repo}(/|$)`);
  if (a.links?.download && !repoRe.test(a.links.download.url)) fail(`${where}: download URL must be on its public GitHub repo (needs approval otherwise): ${a.links.download.url}`);
  if (a.links?.iosAppStore != null && !/^https:\/\/apps\.apple\.com\//.test(a.links.iosAppStore)) fail(`${where}: iosAppStore must be an apps.apple.com URL`);
  for (const img of [a.icon, ...(a.screenshots || [])]) {
    if (!img?.src || !fs.existsSync(path.join(root, 'static', img.src))) fail(`${where}: image missing: ${img?.src}`);
    if (!img?.alt) fail(`${where}: image without alt: ${img?.src}`);
  }
  // Reserved download slots: present, but null or disabled until a release reviewer approves them. Never rendered.
  for (const k of ['githubRelease', 'ownDownload']) {
    if (!(k in (a.links || {}))) fail(`${where}: links.${k} missing (use null)`);
    const v = a.links?.[k];
    if (v != null && v.enabled !== false) fail(`${where}: links.${k} must be null or {enabled:false} until approved`);
    if (k === 'githubRelease' && v?.url && !new RegExp(`^https://github\\.com/${owner}/${a.repo}/releases/`).test(v.url)) fail(`${where}: links.githubRelease must be a GitHub Releases URL of its repo`);
  }
}
if (apps.length && !failed) ok(`${apps.length} apps valid`);

// 1b. screenshots: files exist, real dimensions match, alt text and captions are present, gallery is rendered
section('screenshots');
function imgSize(file) {
  const b = fs.readFileSync(file);
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    const c = b.toString('ascii', 12, 16);
    if (c === 'VP8X') return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
    if (c === 'VP8L') { const n = b.readUInt32LE(21); return { w: 1 + (n & 0x3fff), h: 1 + ((n >> 14) & 0x3fff) }; }
    if (c === 'VP8 ') return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
  }
  if (b.readUInt32BE(0) === 0x89504e47) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  return null;
}
let shotCount = 0; const failedBefore = failed;
for (const a of apps) {
  const list = a.screenshots || [];
  if (!list.length && !a.screenshotsNote) fail(`${a.id}: no screenshots and no screenshotsNote explaining why`);
  if (list.length > 5) fail(`${a.id}: more than 5 screenshots`);
  const built = fs.existsSync(path.join(dist, 'apps', a.id, 'index.html')) ? fs.readFileSync(path.join(dist, 'apps', a.id, 'index.html'), 'utf8') : '';
  if (list.length && !/<ul class="gallery" tabindex="0" aria-label="[^"]+"/.test(built)) fail(`${a.id}: gallery not rendered accessibly`);
  for (const s of list) {
    shotCount++;
    const f = path.join(root, 'static', s.src || '');
    if (!s.src || !/\.(webp|png)$/.test(s.src) || !fs.existsSync(f)) { fail(`${a.id}: screenshot file missing or not WebP/PNG: ${s.src}`); continue; }
    if (!fs.existsSync(path.join(dist, s.src))) fail(`${a.id}: screenshot not copied to dist: ${s.src}`);
    if (fs.statSync(f).size > 150 * 1024) fail(`${a.id}: screenshot over 150 KB: ${s.src}`);
    if (!s.alt || s.alt.trim().length < 20) fail(`${a.id}: screenshot needs descriptive alt text (20+ chars): ${s.src}`);
    if ('caption' in s) fail(`${a.id}: screenshots have no captions: ${s.src}`);
    const sz = imgSize(f);
    if (!sz || sz.w !== s.width || sz.h !== s.height) fail(`${a.id}: width/height ${s.width}x${s.height} do not match file ${sz ? sz.w + 'x' + sz.h : '?'}: ${s.src}`);
    if (!built.includes(`alt="${s.alt.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')}"`)) fail(`${a.id}: built page lacks alt for ${s.src}`);
  }
  if (/releases\/download\//.test(built)) fail(`${a.id}: a release-asset download is rendered (must stay source-only)`);
}
if (failed === failedBefore) ok(`${shotCount} screenshots exist, match their sizes, and have alt text (no captions)`);

// 1c. app page layout: Download first, equal weight with Fork, no View repo button, order, About vs Technical
section('app page layout');
const layoutBefore = failed;
for (const a of apps) {
  const f = path.join(dist, 'apps', a.id, 'index.html');
  if (!fs.existsSync(f)) { fail(`${a.id}: page missing`); continue; }
  const h = fs.readFileSync(f, 'utf8');
  const actions = (h.match(/<div class="actions"[\s\S]*?<\/div>/) || [''])[0];
  const btns = [...actions.matchAll(/<a class="([^"]+)" href="([^"]+)"/g)];
  if (/View repo/i.test(h)) fail(`${a.id}: 'View repo' button must be removed`);
  if (!btns.length || !/\/archive\/|\/releases\//.test(btns[0][2])) fail(`${a.id}: Download must be the first button`);
  if (!btns[1] || !/\/fork$/.test(btns[1][2])) fail(`${a.id}: Fork must come right after Download`);
  if (btns.some((b) => b[2].endsWith('/fork') && /\bprimary\b/.test(b[1]))) fail(`${a.id}: Fork must not be the highlighted button`);
  if (/<figcaption|class="shots-hint"|class="actions-hint"|Scroll sideways|source code as a \.zip/i.test(h)) fail(`${a.id}: captions or usage how-to text must not appear`);
  if (!/class="btn action dl"/.test(actions) || !/class="btn action fork"/.test(actions)) fail(`${a.id}: Download and Fork must both be colored buttons`);
  if (!Array.isArray(a.updates) || a.updates.some((u) => !u.version || !Array.isArray(u.notes) || !u.notes.length || (u.date && !/^\d{4}-\d{2}-\d{2}$/.test(u.date)))) fail(`${a.id}: updates must be [{version, date?, notes[]}]`);
  if (!('builtWith' in a)) fail(`${a.id}: builtWith missing (use null)`);
  if (a.builtWith == null && /Built with/.test(h)) fail(`${a.id}: Built with must be hidden while null`);
  if (a.about.some((x) => /^New in/i.test(x)) || /New in v/.test((h.match(/data-section="about">[\s\S]*?<\/section>/) || [''])[0])) fail(`${a.id}: release notes belong in Updates, not About`);
  const pos = ['id="shots-title"', 'id="about-title"', 'id="updates-title"', 'id="facts-title"', 'id="tech-title"'].map((k) => h.indexOf(k));
  if (pos.some((p) => p < 0) || pos.some((p, i) => i && p < pos[i - 1])) fail(`${a.id}: order must be Screenshots, About, Updates, Details, then Technical details last`);
  const about = (h.match(/data-section="about">[\s\S]*?<\/section>/) || [''])[0];
  const tech = (h.match(/data-section="technical">[\s\S]*?<\/section>/) || [''])[0];
  const aside = (h.match(/<aside[\s\S]*?<\/aside>/) || [''])[0];
  if (!tech || !aside.includes(tech) || !aside.trimEnd().replace(/<\/aside>$/, '').trimEnd().endsWith('</section>')) fail(`${a.id}: Technical details must be the last part of Details`);
  for (const t of a.technical) if (about.includes(esc(t).slice(0, 40))) fail(`${a.id}: technical text appears in About`);
  for (const t of a.about) if (tech.includes(esc(t).slice(0, 40))) fail(`${a.id}: About text appears in Technical details`);
}
if (failed === layoutBefore) ok('Download first, both buttons colored, Fork not highlighted, no View repo, no captions or how-to text, Screenshots > About > Updates > Details > Technical')
// footer line appears exactly once per page and is not repeated elsewhere; one logo mark
const FOOT = `${esc(site.footer)} <a href="https://github.com/${owner}">Browse the repos on GitHub</a>.`;
const footBefore = failed;
for (const f of ['index.html', ...apps.map((a) => `apps/${a.id}/index.html`)]) {
  const h = fs.readFileSync(path.join(dist, f), 'utf8');
  if (h.split(FOOT).length !== 2) fail(`${f}: footer line must appear exactly once`);
  const rest = h.replace(FOOT, '');
  for (const ph of ['the easy way', 'a developer', 'AI agent', 'fork any of them', 'Browse the repos']) if (rest.includes(ph)) fail(`${f}: footer wording "${ph}" repeated outside the footer`);
  if ((h.match(/<img class="logo [^"]*logo-dark/g) || []).length !== 1 || (h.match(/<img class="logo [^"]*logo-light/g) || []).length > 1 || (h.match(/<img class="logo /g) || []).length > 2) fail(`${f}: header must show exactly one logo mark per theme`);
  if (!/css\/style\.css\?v=[0-9a-f]{10}"/.test(h)) fail(`${f}: stylesheet URL must be cache-busted`);
}
if (failed === footBefore) ok('footer line exactly once per page and not repeated; one logo mark; cache-busted assets');

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
  for (const dev of ['iPhone 13', 'Pixel 7']) {
    const mctx = await browser.newContext({ ...pw.devices[dev] });
    const mp = await mctx.newPage();
    await mp.goto(pathToFileURL(path.join(dist, 'apps', apps[0].id, 'index.html')).href);
    const th = () => mp.evaluate(() => [document.documentElement.getAttribute('data-theme') || 'dark', getComputedStyle(document.body).color, document.querySelector('[data-theme-toggle]').getAttribute('aria-label')]);
    const m0 = await th(); await mp.tap('[data-theme-toggle]'); const m1 = await th(); await mp.tap('[data-theme-toggle]'); const m2 = await th();
    const size = await mp.$eval('[data-theme-toggle]', (e) => { const r = e.getBoundingClientRect(); return [r.width, r.height, e.textContent.trim()]; });
    if (m0[0] !== 'dark' || m1[0] !== 'light' || m2[0] !== 'dark' || m0[1] === m1[1]) fail(`${dev}: tapping the toggle should switch dark -> light -> dark and change colors (got ${m0[0]}, ${m1[0]}, ${m2[0]})`);
    else if (!m0[2] || size[2] || size[0] > 48 || size[0] < 24) fail(`${dev}: toggle must be a small icon-only button with an aria-label (got ${size})`);
    else ok(`${dev} emulation: real taps switch dark -> light -> dark; small icon-only toggle with aria-label`);
    await mctx.close();
  }
  await browser.close();
}

console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
