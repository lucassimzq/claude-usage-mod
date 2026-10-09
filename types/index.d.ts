export type Limit = {
  kind: string
  pct: number
  resetsAt?: string
  /** No session has reported this window since this one started, so it may be out of date. */
  isSaved?: boolean
}

/**
 * One plan limit as the last session to hear of it saw it, kept in `$.store` under
 * `readings` so every session shows the same figures. `seenAt` is when it was heard.
 */
export type Reading = { kind: string; pct: number; resetsAt?: string; seenAt: number }

export type Snapshot = {
  ctxPct: number
  ctxTokens?: number
  ctxWindow: number
  limits: Limit[]
  usd?: number
}

/** What Clawd is doing while a turn runs: thinking (bubble), or writing and using tools (laptop). */
export type Activity = 'idle' | 'thinking' | 'typing'

/**
 * When Clawd last jumped from the band to the spinner (a turn began) and back (it ended),
 * so the redraws right after play the jump and later ones draw him settled.
 */
export type Jumps = { leftAt: number; backAt: number }

/** `prev` is what the gauges sweep from; it catches up to `cur` once the sweep ends. */
export type Gauges = { cur: Snapshot | null; prev: Snapshot | null }

/** One plan-limit window as the game last saw it: when it resets, and its highest figure so far. */
export type Window = { resetsAt?: string; peak: number }

/** Clawd's progress, kept in `$.store` under `progress` and shared by every session. */
export type Progress = {
  xp: number
  turns: number
  /** Tokens sent (cache reads and writes included) and generated, counted from each finished turn. */
  tokensIn: number
  tokensOut: number
  /** Days are local calendar dates, `YYYY-MM-DD`. */
  streak: { count: number; best: number; lastDay?: string; restDays: number }
  /** Badge id to the day it was earned. */
  badges: Record<string, string>
  /** Turns finished today, for the daily cap on turn XP. */
  today: { day: string; turns: number }
  /** Keyed by limit kind (`five_hour`, `seven_day`). */
  windows: Record<string, Window>
  /** Well-paced 5-hour windows in a row, for Perfect Pace. */
  paced: number
  /** A limit hit 100% and has since reset: the next turn earns Phoenix. */
  phoenix: boolean
  /** Shop money: 1 per 1,000 tokens Claude writes, 100 per level, 25 per badge. */
  coins: number
  /** Written tokens not yet turned into a coin. */
  coinTokens: number
  /** Shop items bought; level unlocks are owned by reaching the level. */
  owned: string[]
  /** What Clawd wears in each slot (`head`, `face`, `neck`, `back`, `shell`, `buddy`, and `scene` for the backdrop), or `none`.
   * A slot left out wears the newest level unlock for it. */
  outfit: Record<string, string>
}

/**
 * What the last change earned, while its animation plays: the XP and coins gained, and
 * how full the XP bar was before (0 after a level-up, so the whole bar flashes).
 */
export type Gain = { xp: number; coins: number; fromFrac: number }

/** `burst` is true for a moment after a level-up, while the sparkle plays; `gain` while a gain plays. */
export type Game = { progress: Progress | null; burst: boolean; gain?: Gain }

/**
 * The mod's own version against the newest release tag on GitHub. `latest` is set only
 * when it is newer than `current`; `phase` is `installing` while git fetches it and
 * `restart` once it is on disk but this session couldn't load it by itself.
 */
export type Update = { current: string; latest?: string; phase: 'idle' | 'installing' | 'restart' }

declare module 'claude-code' {
  interface PluginState {
    'usage-hud': { gauges: Gauges; isHidden: boolean; activity: Activity; jumps: Jumps; game: Game; update: Update }
  }
}
