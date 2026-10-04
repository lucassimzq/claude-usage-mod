<p align="center">
  <img src="docs/banner.svg" alt="claude-usage-mod: your Claude Code limits above the prompt, watched over by Clawd" width="100%">
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Claude%20Code-mod-D97757?style=for-the-badge" alt="Claude Code mod">
  <img src="https://img.shields.io/badge/version-0.1.0-6b9e7a?style=for-the-badge" alt="Version 0.1.0">
  <img src="https://img.shields.io/badge/requires-2.1.286%2B-444?style=for-the-badge" alt="Requires Claude Code 2.1.286 or later">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-c4a05a?style=for-the-badge" alt="MIT license"></a>
  <a href="https://github.com/lucassimzq"><img src="https://img.shields.io/badge/made%20by-lucassimzq-111?style=for-the-badge" alt="Made by lucassimzq"></a>
</p>

Keep your context window, 5-hour session limit and weekly limit in view above the Claude Code prompt, with no menu to open. A pixel Clawd sits beside them and gets more nervous the closer you get to a limit.

## How it looks

Clawd's mood follows whichever of the three numbers is highest.

**Under 50%: happy.** All calm, so the bars get the whole row.

<img src="docs/states/happy.svg" alt="Happy Clawd beside three green bars" width="100%">

**50% and up: anxious.** A sweat drop, and a note saying which limit is filling up.

<img src="docs/states/anxious.svg" alt="Anxious Clawd with the note: Weekly limit is over half used" width="100%">

**80% and up: frantic.**

<img src="docs/states/frantic.svg" alt="Frantic Clawd with the note: You're almost reaching your weekly limit" width="100%">

**95% and up: panic.**

<img src="docs/states/panic.svg" alt="Panicking Clawd with the note: Weekly limit nearly used up" width="100%">

**100%: done for now.** The note says when the limit resets.

<img src="docs/states/dead.svg" alt="Grey Clawd with X eyes and the note: Weekly limit reached, resets in 2d 4h" width="100%">

### Reading the band

- **`ctx`**: how full the context window is.
- **`5h`** and **`7d`**: your session and weekly plan limits. The small arrow above each bar marks how far through that window you are; a bar past its arrow is using the limit faster than the clock.
- **Colors**: green under 50%, amber from 50%, red from 80%.
- **`$`**: what this session has cost so far.
- **`↻`**: re-reads the figures right away.

You also get a short pop-up when a limit passes 50%, 80% or 95%.

## Install

Clone the repo:

```bash
git clone https://github.com/lucassimzq/claude-usage-mod.git ~/claude-usage-mod
```

To load it in every session, including the desktop app, add it to the `env` block of `~/.claude/settings.json`:

```json
{
  "env": {
    "CLAUDE_CODE_PLUGIN_DIRS": "~/claude-usage-mod"
  }
}
```

Or try it for a single terminal session:

```bash
claude --plugin-dir ~/claude-usage-mod
```

You need Claude Code 2.1.286 or later. The `5h` and `7d` bars need a Claude subscription; right after installing they appear with Claude's first reply, and from then on every restart shows the last figures straight away.

## Use

- **`/usage-hud`** hides or shows the band.
- **`↻`** refreshes the figures (`r` in the terminal while the band has focus).

The desktop Code tab draws the pixel version. The terminal shows text bars with a face like `(°□°;)`.

To update, run `git pull` in `~/claude-usage-mod`.
