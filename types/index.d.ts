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

declare module 'claude-code' {
  interface PluginState {
    'usage-hud': { gauges: Gauges; isHidden: boolean; activity: Activity }
  }
}
