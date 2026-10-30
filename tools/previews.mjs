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
const shots = [
  ['home-desktop.png', 'index.html', { width: 1440, height: 900 }, 1],
  ['home-mobile.png', 'index.html', { width: 390, height: 844 }, 2],
  ['app-galaxy-gridiron-desktop.png', 'apps/galaxy-gridiron/index.html', { width: 1440, height: 900 }, 1],
  ['app-galaxy-gridiron-mobile.png', 'apps/galaxy-gridiron/index.html', { width: 390, height: 844 }, 2],
];
for (const [name, p, viewport, dpr] of shots) {
  const page = await b.newPage({ viewport, deviceScaleFactor: dpr, reducedMotion: 'reduce' });
  await page.goto(pathToFileURL(path.join(root, 'dist', p)).href, { waitUntil: 'load' });
  await page.screenshot({ path: path.join(out, name), fullPage: true });
  console.log(path.join(out, name));
}
await b.close();
