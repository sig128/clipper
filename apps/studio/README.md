# Clipforge Studio (single file)

The studio you use in the browser. `artifact-body.html` is exactly what is
published as the private Clipforge artifact; `clipforge-studio.html` is the
same app as a standalone page you can open offline (plan saved in the browser,
files saved as normal downloads).

What it does: GTA sample workspace, moment scan for dropped recordings, editor
with the Hook tab (hook, commentary, loop ending, GTA preset), checks that block
risky posts, platform cuts (Shorts, TikTok past 61 s, Reels), real 1080 × 1920
export and post kits (.zip with video, caption, cover, checklist), and the Plan
(accounts × daily slots, limits, duplicate guard, auto-fill).

Tests: `sh test/make-capture.sh` (inside `test/`) builds the 3-minute test
capture, then `node test/e2e.js` runs 23 browser checks with Playwright.
