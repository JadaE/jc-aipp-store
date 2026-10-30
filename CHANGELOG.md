# Changelog

## v0.0.2
- Stars: the background starfield is now visible, still subtle, with a gentle twinkle (no motion with reduced motion on).
- Light mode: a "Light mode" toggle in the header switches to a soft dawn theme with faint stars. Dark stays the default, and your choice is remembered.
- New wording: the hero, page description and footer now say you can download apps the easy way, like any app store, or fork them on GitHub if you're tech-savvy or have an AI agent.
- Canonical, Open Graph and sitemap links now use the live site address (filled in at build time from local config, not stored in the repo).
- Header logo is ready to swap for the designer's "JC AiPP Store" logo (dark and light variants), with "Lite" kept as separate text.
- Social preview image updated to the new wording. Downloads are still source-only.
- Screenshots: every app page now has a gallery of 3 or 4 real screenshots, rendered from fresh clones of the public repos with fictional demo data and placeholder images. The gallery scrolls sideways with the keyboard, each image has alt text and a caption, and opens full size.
- Descriptions: each app's About text now summarises its latest release notes.
- Cat Health Dashboard keeps its name (it has cat-specific features like the litter box log) and notes that forks can adapt it to other animals.
- Data model: reserved `githubRelease` and `ownDownload` download slots (off for now, not shown). Downloads stay source-only.
- Tests: new screenshot check (file exists, size matches, alt text and caption present) and download-slot check.
- Publishing runs the release gate before upload.

## v0.0.1
- First release: app grid with platform filter, one page per app, Fork and source-download buttons.
