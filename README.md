# claude-usage-mod

A Claude Code mod that keeps your usage in view above the prompt: a pixel Clawd whose mood follows how close you are to your limits, and three flat 8-bit bars for the context window, the 5-hour session limit and the weekly limit.

```
[Clawd]  ctx ▮▮▮▯▯▯▯▯ 18%   5h ▮▮▮▮▯▯▯▯ 27%   7d ▮▮▮▮▮▮▮▮▮ 92%   $3.17
```

## Clawd's moods

The mood follows the highest of the three numbers.

| Usage | Mood | Clawd |
| --- | --- | --- |
| under 50% | happy | `^ ^` eyes, blush, an occasional hop and heart |
| 50% and up | anxious | blinking, a slow sweat drop |
| 80% and up | frantic | worried eyes, two sweat drops, `!` |
| 95% and up | panic | wide eyes, red flash, `!!` |
| 100% | dead | grey, X eyes, a small ghost floats up |

While Claude is working, Clawd's legs walk.

From 50% up, a small speech bubble beside Clawd names whichever figure is highest, like "You're almost reaching your weekly limit"; once a limit is used up it says when it resets. Below 50% the bubble goes away and the bars take the room back.

## The bars

- **`ctx`**: how full the context window is.
- **`5h`** and **`7d`**: the session and weekly plan limits. The small arrow above each one marks how far through that window you are, so a bar that runs past its arrow is using the limit faster than the clock.
- Cells are green under 50%, amber from 50% and red from 80%.
- The session's cost sits at the right end.

You also get a toast when a limit passes 50%, 80% or 95%. The `↻` button at the right end re-reads the figures on demand (press `r` while the band has focus in the terminal), and `/usage-hud` hides or shows the band.

On the desktop Code tab it draws as pixel art; in the terminal it falls back to text bars with a face like `(°□°;)`.

## Install

It is a plugin of function hooks, so it needs a Claude Code build that has them (2.1.286 or later).

Clone it:

```bash
git clone https://github.com/lucassimzq/claude-usage-mod.git ~/claude-usage-mod
```

Then load it for one session:

```bash
claude --plugin-dir ~/claude-usage-mod
```

Or load it in every session, including the desktop app, by adding it to the `env` block of `~/.claude/settings.json`:

```json
{
  "env": {
    "CLAUDE_CODE_PLUGIN_DIRS": "~/claude-usage-mod"
  }
}
```

## Notes

- Cloud session credits are not shown: plugins can't read that figure.
- Plan limits only appear on a subscription, after the first response of the session reports them.
- The desktop band is sized from the prompt's width in code-font cells, at about 7.8px per cell. If it ends short of the edge or overflows, change `PX_PER_COLUMN` in [`hooks/register.tsx`](hooks/register.tsx).
