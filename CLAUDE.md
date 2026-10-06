# claude-usage-mod

A Claude Code mod (a plugin of function hooks, plugin name `usage-hud`) that draws the context window, the 5-hour session limit and the weekly limit as a band above the prompt, beside a pixel Clawd whose mood follows the highest of the three.

## Layout

- `.claude-plugin/plugin.json`: the manifest; `types` points at the state contract.
- `hooks/hooks.json`: lists the one hooks module.
- `hooks/register.tsx`: the whole mod.
- `types/index.d.ts`: the contract for the values the mod keeps in `$.state` (`gauges`, `isHidden`, `activity`, `game`) and the saved `Progress`.
- `tests/levels.test.ts`, `tests/update.test.ts`: `claude plugin test .` runs them.
- `scripts/render-docs.ts`: renders `docs/banner.svg` and `docs/states/*.svg` for the README.
- `.claude-plugin/types/`: type files the engine writes for editors; ignored by its own `.gitignore`.

## How it works

- `session.start` registers `/usage-hud`, restores whether the band is hidden (`$.store` key `hidden`), reads `$.session.usage()` once, and starts a 60-second timer that redraws so reset countdowns and pace marks stay current.
- `session.measure` pushes new figures after each turn and whenever a limit moves a point.
- Both feed `take()`, which writes `gauges` (`{ cur, prev }`) and toasts when a limit crosses 50, 80 or 95%. `prev` is what new bar cells flash from; a timer sets it equal to `cur` after the flash so later redraws don't replay it.
- `/usage-hud shop` (and `wear`, `buy`, `remove` with no item) opens the `shop` Pane: every item in `ITEMS` by slot, from `shelfOf()`. A press runs the same `bought`/`dressed`/`undressed` change the typed command does, through `play()`, and toasts its answer. The desktop draws each item as a card with `wardrobeSvg()` (Clawd alone, no scene props, trying it on); the terminal draws Buttons. Below `SHOP_WIDE` (420px, from `bodyColumns` × `PX_PER_COLUMN`) the desktop header stacks under Clawd so a narrow sidebar doesn't squeeze the text or clip the button. `shop list` and an unplaced pane fall back to the text from `shopOf()`.
- The `AbovePrompt` render hook draws the band: on every remote surface (desktop, VS Code, mobile), one SVG plus a native `↻` Button; in the terminal, `Text` bars. claude.ai web and Project threads are not plugin surfaces, so nothing draws there.
- `turn.step`, `tool.call` and `turn.complete` (all main conversation only, never a subagent) set `activity`: `thinking` while a request is pending or thinking streams, `typing` once text or a tool call arrives, `idle` at the end. The band reads it only while `isWorking`, so a missed `turn.complete` can't leave Clawd stuck. `setActivity` writes only on a change.
- Updates: `session.start` reads the running version from `plugin.json`, and `checkForUpdate()` asks GitHub's tag list (`REPO`) for the highest `vX.Y.Z` at most every six hours, the answer shared through `$.store` (key `latest`). A newer tag sets `update.latest`, and the band shows an update Button. `installUpdate()` first checks `git rev-parse --show-prefix` is empty (the folder is the top of its own clone, so a copy inside someone's dotfiles or project repo never moves that repo), then runs `git fetch --no-tags origin tag <tag>` (that one tag only, with `GIT_TERMINAL_PROMPT=0` so it can't hang on a credential prompt) and `git merge --ff-only refs/tags/<tag>` in `$.plugin.root`. A tag that already exists locally and was moved on GitHub is refused by git, so a release tag is never moved: a mistake gets a new tag. The folder is watched (`CLAUDE_CODE_PLUGIN_DIRS`, `--plugin-dir`), so the session reloads the mod and the new `session.start` toasts once (store key `installing`, written before the merge since the reload can replace the module mid-call, and cleared if the merge fails); if the old module is still running 8 seconds later, the band says to restart.

## Releasing

The update check compares `plugin.json`'s `version` with git tags, so a release is: bump `version` in `.claude-plugin/plugin.json` and the README badge, merge to `main`, then tag that commit `vX.Y.Z` and push the tag (a GitHub release does the same). A tag must point at a commit with the matching `version`, or the update offer comes back after installing. Pre-release tags (`v1.0.0-beta`) are ignored.

## Things that are easy to get wrong

- **Plan limits come only with API responses, and each session hears only its own.** So they're shared: `withShared()` folds this session's readings into `$.store` key `readings` (`Reading[]`, each with `seenAt`) and shows the newest any session has heard. A later window beats an earlier one; within one window (reset times within 30 minutes) the higher figure wins, since usage only grows, so an idle session's old reading never pulls the others down. `sync()` re-reads the store every 10 seconds (`SYNC_MS`) and redraws when another session moved a limit; it doesn't toast, since the session that heard it already did. A reading no session has heard since this one started (`startedAt`, from `$.session.usage()`) is drawn at half opacity, and a window whose reset time has passed shows as 0%. Versions before this kept a bare list under `limits`, still read when `readings` is missing.
- **Cloud session credits can't be read** by plugins, so they're not shown.
- **The desktop SVG is drawn as an image, not `isInteractive`.** The interactive frame paints a white background and a fixed size. An image can't take a press, which is why `↻` is a separate Button beside it, and why there are no hover tooltips.
- **The first frame must be right on its own.** SMIL may not run in image mode on every surface, so nothing essential is hidden at t=0: lit cells are drawn lit and the reveal is a white flash on top. Very short animations (1ms) and `<set>` didn't fire in testing; use `<animate>` with `calcMode="discrete"`.
- **Width:** the desktop reports the band in code-font cells; `PX_PER_COLUMN` (7.8) turns that into pixels. Adjust it if the band ends short of the edge or overflows.
- **Narrow bands:** `planOf()` picks the richest layout that fits and gives things up in a fixed order (long note, cost, a little bar length, short note, more bar length, the bars, then all but the highest figure), so nothing ever overlaps. Bars stop growing at `MAX_BAR`; extra room goes between the figures. The terminal branch does the same by character count. Check any layout change across widths from about 180 to 1800px.
- **Helpers that take `$` must be top-level function declarations.** `claude plugin validate` follows `$` only into those (`take`, `withShared`, `sync`, `refresh`, `setActivity`).
- **Clawd's scenes:** each mood is a small scene with one slow-moving prop (headphones and notes, coffee and steam, a ticking clock, flames, Z's), and props on his right give way to the thought bubble while Claude thinks. Positions animated with `animateTransform` also get a matching `transform` attribute, so a still frame puts them in the right place.
- **Calm by design:** the user asked for flat 2D cells, muted colors (`TONES`) and very little motion. Clawd mostly holds still, with one short beat every few seconds; keep new animation in that spirit.

## Levels

- Progress lives in `$.store` under `progress`, which is one file under the user's Claude Code config, so every session and project shares one Clawd. `play()` reads it fresh, applies one change, saves it (only if it changed, so a no-op reading never overwrites another session's write) and mirrors it into the `game` atom, one change at a time.
- The rules are pure functions in `#region game` (`afterTurn`, `afterMeasure`, `scoreWindow`); the level math, unlocks and the cluster's drawing are in `#region drawing` so the README images can use them.
- `turn.complete` (main conversation only, and only when the turn reports `usage`: an interrupted or failed turn that never got a response earns nothing) earns turn XP, the daily bonus, streaks and time badges. `take()` passes each reading to `afterMeasure`: weekly-point XP, window peaks, and pacing scores when a window's reset time has passed. A reading whose own reset time has passed is stale and skipped, so a window is never scored twice.
- Nothing is earned for usage from before the game first saw a window.
- Reaching 100% pays out at once (`maxedOut()`), once per window: Lucas wanted hitting the limit to feel like a win, not a penalty.
- In `planOf()` the level cluster is the first thing to give way: the streak, then the rest of it. The cluster stacks `Lv` (font pixel `LV_P`), the XP bar and the coin balance (`COIN_P`, `coinsLabel()` keeps it to four characters) in the band's 24px; the terminal shows the coins as `●1.2k` after the XP bar.
- Coins: 1 per 1,000 written tokens (the remainder carries in `coinTokens`), 100 per level-up (added in `play()`), 25 per badge. Cache tokens don't count, or prices would spiral.
- `ITEMS` is the one catalog: level unlocks have no `price`. Each item has a slot; `outfitOf()` fills every slot with its newest level unlock unless `outfit` picks an owned item or `none`. Buddies sit left of Clawd and step aside for the panic flames.
- Shop commands (`bought`, `dressed`, `undressed`) run inside `play()` so a purchase can't race a turn's write.
- Backdrops are items in the `scene` slot (shown as "Backdrop"). `SCENES` holds each one as a sky, a ground and pixel-grid layers pinned to the left or right edge, so `sceneSvg()` fills both the band (landmarks in a `SCENE_W` × 24 tile behind Clawd, sky, ground and `repeat` layers across the whole width) and the shop card. Clawd covers the middle, so the landmarks sit at the edges and above his head. Repeat layers stay low and dim (below the bars or in the top few pixels) so the figures stay readable. On the band the whole scene is drawn at `SCENE_OPACITY` (0.5) so the numbers lead, and the right-hand landmarks step aside while the thought or clock bubble is up. With a backdrop and no update offer, the band SVG runs `REFRESH_W` further, under the `↻` Button laid over its right end (`position="absolute"`); the figures still keep clear of it. The app's card and its padding around the band are the host's; the mod can't paint there. They draw on remote surfaces only; the terminal band shows none.
- Gains: `play()` puts what a change earned in `game.gain` (`{ xp, coins, fromFrac }`; a gain landing while one plays adds to it) and clears it `GAIN_MS` later. The cluster swaps `Lv7` and the balance for `+35xp` and `+3` for one hop, flashes the new part of the XP bar and turns the coin on its edge; when the cluster has given way, the gain hops up on Clawd's right instead (`clawdSvg`'s `pop`), and the terminal prints it beside the face. The still frame shows the gain, and the clearing redraw brings the figures back, so it reads right even where SMIL doesn't run. `docs/gain.gif` is the preview.

## Mood thresholds

`moodOf` and `tone` share the same breakpoints: under 50 happy/green, 50 anxious/amber, 80 frantic/red, 95 panic, 100 asleep. `noteOf` writes the speech-bubble text from the same numbers.

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
