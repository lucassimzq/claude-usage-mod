# The claude-usage-mod website

A one-page showcase for the mod, in the look of [lucascodes.dev](https://lucascodes.dev): a white sheet, greys
without chroma, one orange for whatever is happening, and plates whose stages hold live figures. Every crab, band
and outfit on it is drawn by the mod's own code, so the page always looks like the real thing.

- The hero: the crab in a slowly turning ring of words, a headline whose last phrase swaps, and the real band.
- A Claude Code window that runs the mod's drawing and game code: send prompts, open the `/usage-hud` menu, move
  the figures, and drag the window's edge to watch the band give things up as it narrows.
- Isometric line figures (after [hairline](https://github.com/lucasmarkes/hairline), like the portfolio's) that
  answer the pointer: the mood terminal, the level road, sessions sharing a reading, and a clone fast-forwarding.
- The five moods, XP and coin tables, the badges, the shop with a try-on drawer, the 15-second reel and install.

## Files

- `site/`: the page itself, plain static files with no build step. Deploy the folder as is (Vercel: root
  `website/site`, no framework, no build command).
  - `index.html`: markup and CSS. `site.js`: the demo's state, the figures' kit and every section.
  - `hud.js` is generated: `node website/build/hud.mjs [commit]` copies `#region drawing` and `#region game` out of
    `hooks/register.tsx` at that commit (v1.0.0 by default), strips the TypeScript with Node's own stripper
    (Node 22.13 or later) and exposes them as `window.HUD`. Regenerate it after a release changes the drawing.
  - `reel.mp4` is the showreel; `reel.webm` is an AV1 copy for browsers without H.264. `reel-poster.jpg` is its still.
- `test/`: Playwright checks in headless Chromium.

## Type and colour

Geist for text, Instrument Serif italic for the one orange word in each heading, and Geist Mono for labels,
read-outs and code, all from Google Fonts. Colours are the portfolio's tokens (`--accent` `#ff6a0a` and its two
darker steps for text). The page is light only, like the portfolio and like the band, whose ink is drawn for a light
app. The band's own text and the crab's colours are the mod's and stay as they are. The page never uses the mascot's
name: it says "the crab".

## Checking a change

```bash
cd website/test
node server.mjs &                  # serves site/ on http://localhost:8765
node shoot.mjs desk 1440 900       # a screenshot of each section into shots/ (also: mob 390 844 mobile)
node interact.mjs                  # prompts, slash menu, sliders, resize, figures, shop, reel, copy
node video.mjs                     # the reel loads and plays
node reduced.mjs                   # prefers-reduced-motion: every section shown and still
node names.mjs                     # the mascot's name never shows
```

They need Playwright (a local or global npm install) and its Chromium.

`node server.mjs --artifact` serves the page inside a second document skeleton, the way the claude.ai artifact host
wraps a page, to check that `site/index.html` can be published there as is.
