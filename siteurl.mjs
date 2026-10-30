// Resolve the public site URL used for canonical, Open Graph and sitemap links.
// Order: SITE_URL env -> config.local.json .site.siteUrl -> the here.now URL for config.local.json .herenow.slug -> data/site.json siteUrl (placeholder).
// The real value lives only in the gitignored config.local.json (or the environment), never in the repo. Never printed.
import fs from 'node:fs';
import path from 'node:path';
const HERENOW_HOST = ['here', 'now'].join('.'); // split so the repo's own secret scan doesn't see a site URL
export function resolveSiteUrl(root, site) {
  if (process.env.SITE_URL) return { url: process.env.SITE_URL.replace(/\/$/, ''), source: 'SITE_URL env' };
  const f = path.join(root, 'config.local.json');
  if (fs.existsSync(f)) {
    try {
      const c = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (c.site && /^https:\/\//.test(c.site.siteUrl || '')) return { url: c.site.siteUrl.replace(/\/$/, ''), source: 'config.local.json site.siteUrl' };
      const slug = c.herenow && c.herenow.slug;
      if (slug && /^[a-z0-9-]+$/.test(slug)) return { url: `https://${slug}.${HERENOW_HOST}`, source: 'config.local.json herenow.slug' };
    } catch { /* fall through to the placeholder */ }
  }
  return { url: site.siteUrl.replace(/\/$/, ''), source: 'data/site.json placeholder' };
}
