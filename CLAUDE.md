# claude-usage-mod

A Claude Code mod (a plugin of function hooks, plugin name `usage-hud`) that draws the context window, the 5-hour session limit and the weekly limit as a band above the prompt, beside a pixel Clawd whose mood follows the highest of the three.

## Layout

- `.claude-plugin/plugin.json`: the manifest; `types` points at the state contract.
- `hooks/hooks.json`: lists the one hooks module.
- `hooks/register.tsx`: the whole mod.
- `types/index.d.ts`: the contract for the values the mod keeps in `$.state` (`gauges`, `isHidden`).
- `scripts/render-docs.ts`: renders `docs/banner.svg` and `docs/states/*.svg` for the README.
- `.claude-plugin/types/`: type files the engine writes for editors; ignored by its own `.gitignore`.

## How it works

- `session.start` registers `/usage-hud`, reads `$.session.usage()` once, and starts a 60-second timer that redraws so reset countdowns and pace marks stay current.
- `session.measure` pushes new figures after each turn and whenever a limit moves a point.
- Both feed `take()`, which writes `gauges` (`{ cur, prev }`) and toasts when a limit crosses 50, 80 or 95%. `prev` is what new bar cells flash from; a timer sets it equal to `cur` after the flash so later redraws don't replay it.
- The `AbovePrompt` render hook draws the band: on desktop, one SVG plus a native `↻` Button; in the terminal, `Text` bars.

## Things that are easy to get wrong

- **Plan limits come only with API responses.** A new session has none until Claude's first reply. `withSaved()` keeps the last limits in `$.store` (key `limits`) and stands them in, drawn at half opacity; a saved window whose reset time has passed shows as 0%.
- **Cloud session credits can't be read** by plugins, so they're not shown.
- **The desktop SVG is drawn as an image, not `isInteractive`.** The interactive frame paints a white background and a fixed size. An image can't take a press, which is why `↻` is a separate Button beside it, and why there are no hover tooltips.
- **The first frame must be right on its own.** SMIL may not run in image mode on every surface, so nothing essential is hidden at t=0: lit cells are drawn lit and the reveal is a white flash on top. Very short animations (1ms) and `<set>` didn't fire in testing; use `<animate>` with `calcMode="discrete"`.
- **Width:** the desktop reports the band in code-font cells; `PX_PER_COLUMN` (7.8) turns that into pixels. Adjust it if the band ends short of the edge or overflows.
- **Helpers that take `$` must be top-level function declarations.** `claude plugin validate` follows `$` only into those (`take`, `withSaved`, `refresh`).
- **Calm by design:** the user asked for flat 2D cells, muted colors (`TONES`) and very little motion. Clawd mostly holds still, with one short beat every few seconds; keep new animation in that spirit.

## Mood thresholds

`moodOf` and `tone` share the same breakpoints: under 50 happy/green, 50 anxious/amber, 80 frantic/red, 95 panic, 100 dead. `noteOf` writes the speech-bubble text from the same numbers.

## Checking a change

Validate with the engine the app runs (the `claude` on PATH may be older):

```bash
"$HOME/Library/Application Support/Claude/claude-code/<version>/<build>/claude.app/Contents/MacOS/claude" plugin validate .
```

After changing anything in the `#region drawing` block of `hooks/register.tsx`, regenerate the README images:

```bash
node scripts/render-docs.ts
```

The drawing region must stay pure (no `$`, no JSX), because the script loads it as a plain module.
