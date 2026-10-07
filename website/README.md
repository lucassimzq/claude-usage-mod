# The usage-hud website

A one-page showcase for the mod. Every crab, band, outfit and backdrop on it is drawn by the mod's own code, so
the page always looks like the real thing.

- A three.js voxel crab in the hero rides the scroll down into the band and flattens into his sprite.
- A live Claude Code window runs the mod's drawing and game code: send prompts, open the `/usage-hud` menu,
  drag the window to watch the band fit any width.
- The five moods scrub with the scroll, levels play as a side-scroller, and the shop has a WebGL fitting room
  where each backdrop becomes a floating voxel island.
- Sync and update demos, the 15-second reel, install steps, and a pixel wordmark footer.

## Files

- `site/`: the page itself, plain static files with no build step.
  - `index.html`: markup and CSS. `site.js`: every 2D section. `voxel.js`: the three.js hero crab, his jump
    into the band and the fitting room (three.js loads from jsdelivr).
  - `hud.js` is generated: `node website/build/hud.mjs [commit]` copies `#region drawing` and `#region game` out of
    `hooks/register.tsx` at that commit (v1.0.0 by default), strips the TypeScript with Node's own stripper
    (Node 22.13 or later) and exposes them as `window.HUD`. Regenerate it after a release changes the drawing.
  - `reel.mp4` and `reel-teaser.mp4` are the showreel; `reel.webm` and `reel-teaser.webm` are AV1 copies for
    browsers without H.264, picked with `canPlayType`. `reel-poster.jpg` is its still.
- `test/`: Playwright checks in headless Chromium with software WebGL.

## Type

Gloock for headings (one weight, so keep `font-weight: 400` and `font-synthesis: none`), Schibsted Grotesk for
body, Silkscreen for labels (a pixel face on the crab's 1/8 em grid, crisp at 12px on 2x screens), and Martian
Mono narrowed to 87.5% for code, all from Google Fonts. The band's own text is drawn by the mod and stays as is.
The page never uses the mascot's name: it says "the crab".

## Checking a change

```bash
cd website/test
node server.mjs &                  # serves site/ on http://localhost:8765
node shoot.mjs desk 1440 900       # screenshots down the page into shots/ (also: mob 390 844 mobile)
node flight.mjs                    # the hero crab's scroll jump into the band
node fit.mjs                       # the fitting room and every backdrop island
node interact.mjs                  # prompts, slash menu, shop, sync, update, reel, copy buttons
node video.mjs                     # the reel's teaser and full player load and play
node reduced.mjs                   # prefers-reduced-motion
node names.mjs                     # the mascot's name never shows
node heroes.mjs                    # the headline stays on two lines at desktop widths
node crop.mjs 1440 2               # type close-ups at 2x
```

They need Playwright (a local or global npm install) and its Chromium. Without network access to jsdelivr, point
`THREE_JS` at a local copy of `three@0.170.0/build/three.module.min.js`.

`node server.mjs --artifact` serves the page inside a second document skeleton, the way the claude.ai artifact host
wraps a page, to check that `site/index.html` can be published there as is.
