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
  /** Today's counters: the daily cap on turn XP, and what the quests measure. */
  today: Today
  /** Web searches and fetches, lifetime, for Scholar. */
  searches: number
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
  /** What Clawd wears in each slot (`head`, `face`, `neck`, `back`, `shell`, `buddy`), or `none`.
   * A slot left out wears the newest level unlock for it. */
  outfit: Record<string, string>
  /** The week under way, from its first change; absent until the game has seen one. */
  week?: Week
  /** The last finished week, for the recap and the share card. */
  recap?: Recap
  /** The `start` of the last recap the person has closed, so the band stops offering it. */
  recapSeen?: string
  /** Quests done, `day:id` (daily) or `w<monday>:id` (weekly) to the day they were done. */
  quests: Record<string, string>
}

/** Today's counters, local date `YYYY-MM-DD`. */
export type Today = {
  day: string
  turns: number
  tokensOut: number
  toolCalls: number
  /** Distinct tools used today, by name. */
  tools: string[]
  searches: number
  /** Context windows cleared today while under 60%. */
  clears: number
  /** 5-hour windows that ended today having peaked at 40–70%. */
  steady: number
}

/**
 * The calendar week under way (Monday to Sunday, local). `xp`, `coins`, `turns` and
 * `tokensOut` are the totals when it began, so the week's own figures are differences.
 */
export type Week = {
  /** The week's Monday, `YYYY-MM-DD`. */
  start: string
  xp: number
  coins: number
  turns: number
  tokensOut: number
  /** Coins spent in the shop this week. */
  spent: number
  /** 5-hour windows scored this week, and how many were well paced. */
  scored: number
  paced: number
  /** The longest the streak got this week. */
  streak: number
  /** Days with a turn this week. */
  days: number
}

/** A finished week, as the recap and the share card show it. */
export type Recap = {
  start: string
  turns: number
  tokensOut: number
  xp: number
  levelFrom: number
  levelTo: number
  coinsEarned: number
  coinsSpent: number
  scored: number
  paced: number
  streak: number
  days: number
  /** Badge ids earned that week. */
  badges: string[]
}

/** `burst` is true for a moment after a level-up, while the sparkle plays. */
export type Game = { progress: Progress | null; burst: boolean }

/**
 * The mod's own version against the newest release tag on GitHub. `latest` is set only
 * when it is newer than `current`; `phase` is `installing` while git fetches it and
 * `restart` once it is on disk but this session couldn't load it by itself.
 */
export type Update = { current: string; latest?: string; phase: 'idle' | 'installing' | 'restart' }

declare module 'claude-code' {
  interface PluginState {
    'usage-hud': { gauges: Gauges; isHidden: boolean; activity: Activity; game: Game; update: Update }
  }
}
