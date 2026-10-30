// Render preview screenshots of dist/ with headless Chrome into ../aipp-store-previews/.
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const out = process.env.PREVIEW_DIR || path.resolve(root, '../aipp-store-previews');
fs.mkdirSync(out, { recursive: true });
const chrome = process.env.CHROME || '/usr/bin/google-chrome';
const b = await chromium.launch({ executablePath: chrome, args: ['--no-sandbox'] });
const D = { width: 1440, height: 900 }, M = { width: 390, height: 844 };
const shots = [
  ['home-dark-desktop.png', 'index.html', D, 1, 'dark'],
  ['home-dark-mobile.png', 'index.html', M, 2, 'dark'],
  ['home-light-desktop.png', 'index.html', D, 1, 'light'],
  ['home-light-mobile.png', 'index.html', M, 2, 'light'],
  ['app-galaxy-gridiron-dark-desktop.png', 'apps/galaxy-gridiron/index.html', D, 1, 'dark'],
  ['app-galaxy-gridiron-light-mobile.png', 'apps/galaxy-gridiron/index.html', M, 2, 'light'],
];
for (const [name, p, viewport, dpr, theme] of shots) {
  const page = await b.newPage({ viewport, deviceScaleFactor: dpr, reducedMotion: 'reduce' });
  await page.addInitScript((t) => { try { localStorage.setItem('aipp-theme', t); } catch {} }, theme);
  await page.goto(pathToFileURL(path.join(root, 'dist', p)).href, { waitUntil: 'load' });
  await page.screenshot({ path: path.join(out, name), fullPage: true });
  console.log(path.join(out, name));
}
await b.close();
