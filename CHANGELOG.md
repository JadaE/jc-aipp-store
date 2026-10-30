# Changelog

## v0.0.4
- Fixed the theme switch on phones. Browsers kept old cached styles from v0.0.1 next to the new pages, which also caused the doubled logo. Styles and scripts now load with a version stamp, so this can't happen again.
- The theme switch is now a small sun/moon icon.
- One logo mark in the header.
- A shorter, warmer welcome on the home page; the footer line is the only place that explains downloading and forking.
- Download and Fork are both colored buttons of equal size, with readable text in both themes.
- Removed usage tips and the captions under screenshots; screenshots scroll sideways.
- New Updates section on each app page with what's new per version (Galaxy Gridiron v0.0.11 and v0.0.10, Swipe Clean v0.0.6 and v0.0.5, Kanban Board v0.02). Galaxy Gridiron now lists v0.0.11.
- Hero line: "Apps for everyday things, all in one place. Have a look around." The meta description matches.
- New social card image with the store name and the hero line.
- "Built with" detail: Grok Bot from Cursor for Swipe Clean, Kanban Board and Cat Health Dashboard (Galaxy Gridiron pending, hidden).
- Updates filled from the projects' release notes: Swipe Clean v0.0.6 and v0.0.5, Kanban Board v0.02 and v0.01, Cat Health Dashboard v0.0.2 and v0.0.1.
- Cat Health Dashboard is now listed as v0.0.2, with the tagged source download.
- New Swipe Clean screenshots of the Android app (placeholder images only).
- Cat Health Dashboard screenshots retaken for a single owner (no "logged by" names).

## v0.0.3
- App pages: Download comes first, and Download and Fork now look the same (Fork is no longer highlighted). The Download label says plainly that you get the source code as a .zip, and a short hint under the buttons explains what Download and Fork give you.
- The "View repo" button is gone; the repo link stays under Details > Source.
- New order: buttons, then Screenshots, then About, then Details.
- Each app now has a plain-language About (what it does and why you'd want it) and separate Technical details (stack, hosting, requirements), shown last in the Details box. Home-page blurbs and platform notes are simpler too.
- Tests check the button order and style, that the View repo button is gone, the section order, and that technical words stay out of the plain-language text.

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
