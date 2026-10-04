export type Limit = {
  kind: string
  pct: number
  resetsAt?: string
  /** Carried over from an earlier session: no response has reported this window yet. */
  isSaved?: boolean
}

export type Snapshot = {
  ctxPct: number
  ctxTokens?: number
  ctxWindow: number
  limits: Limit[]
  usd?: number
}

/** What Clawd is doing while a turn runs: thinking (bubble), or writing and using tools (laptop). */
export type Activity = 'idle' | 'thinking' | 'typing'

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
  /** The cosmetic picked with `/usage-hud wear`; absent wears the newest unlocked. */
  wear?: string
}

/** `burst` is true for a moment after a level-up, while the sparkle plays. */
export type Game = { progress: Progress | null; burst: boolean }

declare module 'claude-code' {
  interface PluginState {
    'usage-hud': { gauges: Gauges; isHidden: boolean; activity: Activity; game: Game }
  }
}
